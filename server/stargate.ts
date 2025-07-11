import express, { Request, Response, NextFunction } from 'express';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket, { WebSocketServer } from 'ws';
import multer from 'multer';
import { ArgumentParser } from 'argparse';

// ES module compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { Print, ErrorInterceptor, RequestEncoder, FileManager } from './utilities';
import { EventStore } from './services/event-store';
import { TimeMapCalculator } from './services/timemap-calculator';
import { SearchIndexManager } from './services/search-index-manager';

// Global uncaught error and exception capture
ErrorInterceptor();

interface ParsedArgs {
  hostname: string;
  port: number;
}

interface Config {
  prog: {
    collab_interface_url: { route: string; response_text?: string };
    websocket_server_url: { route: string };
    websocket_fallback_failure_event_threshold?: number;
    oversize_file_in_mb?: number;
    chunk_size_bytes?: number;
    heartbeat_interval_ms?: number;
    heartbeat_timeout_ms?: number;
    req_header_max_size?: number;
    enforce_req_header?: boolean;
    file_validation?: {
      max_size_mb?: number;
      allowed_extensions?: string[];
      websocket_size_limit_mb?: number;
      http_streaming_threshold_mb?: number;
      legacy_base64_limit_mb?: number;
      max_concurrent_uploads?: number;
    };
    memory_management?: {
      max_temp_files?: number;
      cleanup_interval_ms?: number;
      max_temp_file_age_ms?: number;
    };
  };
}

interface ClientState {
  ws: WebSocket;
  wsFailures: number;
  usingHttpFallback: boolean;
  activeTransfers: Map<string, FileTransfer>;
  lastHeartbeat: number;
  hostname?: string;
}

interface FileTransfer {
  tempFilePath: string;
  tempFileId: string;
  writeStream: fs.WriteStream;
  metadata: {
    filename: string;
    totalSize?: number;
  };
  receivedChunks: number;
  totalChunks: number;
  chunksReceived: Set<number>;
}

interface ExtendedRequest extends Request {
  reqData?: { success: boolean; body: any };
}

interface ExtendedResponse extends Response {
  sendREQ?: (success: boolean, body: any) => void;
}

export class Stargate {
  private app: express.Application;
  private args: ParsedArgs;
  private config: Config;
  private sslOptions: https.ServerOptions;
  private server: https.Server;
  private wss: WebSocketServer;
  private clientStates: Map<string, ClientState>;
  private wsHeartbeatInterval: NodeJS.Timeout | null;
  private tempCleanupInterval: NodeJS.Timeout | null;
  private fileManager: FileManager;
  private upload: multer.Multer;
  private eventStore: EventStore;
  private timeMapCalculator: TimeMapCalculator;
  private searchIndexManager: SearchIndexManager;
  private clientSequences: Map<string, number> = new Map();

  constructor() {
    this.app = express();
    this.args = this.parseArguments();
    this.config = {} as Config;
    this.clientStates = new Map();
    this.wsHeartbeatInterval = null;
    this.tempCleanupInterval = null;

    // Load SSL options
    this.sslOptions = {
      key: fs.readFileSync(path.resolve(__dirname, '../server.key')),
      cert: fs.readFileSync(path.resolve(__dirname, '../server.cert')),
    };

    // Create HTTPS server before setupRoutes
    this.server = https.createServer(this.sslOptions, this.app);
    this.wss = new WebSocketServer({ noServer: true });

    // Load configuration and set up middleware and routes
    this.loadConfig();

    // Initialize file manager with storage directory
    this.fileManager = new FileManager(
      path.join(__dirname, '../storage'),
      this.config
    );

    // Initialize event store
    this.eventStore = new EventStore();

    // Initialize time map calculator
    this.timeMapCalculator = new TimeMapCalculator(this.eventStore);

    // Initialize search index manager
    this.searchIndexManager = new SearchIndexManager(this.eventStore);

    // Set up multer for streaming file uploads after FileManager is ready
    this.setupMulter();

    this.setupMiddleware();
    this.setupRoutes();
    this.initializeWebSocketHandlers();

    Print('INFO', 'Stargate instantiated');
  }

  // Parse command-line arguments
  private parseArguments(): ParsedArgs {
    const parser = new ArgumentParser({
      description: 'Collaborative Register WebSocket Server',
    });
    parser.add_argument('--hostname', { help: 'Hostname for the server', default: '0.0.0.0' });
    parser.add_argument('--port', { help: 'Port for the server', type: 'int', default: 5900 });
    return parser.parse_args();
  }

  // Load configuration from config.json
  private loadConfig(): void {
    try {
      const configPath = path.resolve(__dirname, '../config/config.json');
      const configData = fs.readFileSync(configPath, 'utf8');
      this.config = JSON.parse(configData);
      Print('INFO', 'Configuration loaded successfully');
    } catch (error) {
      Print('ERROR', `Failed to load config: ${(error as Error).message}`);
      process.exit(1);
    }
  }

  // Set up multer for streaming file uploads
  private setupMulter(): void {
    const storage = multer.diskStorage({
      destination: (req, file, cb) => {
        cb(null, path.join(__dirname, '../storage'));
      },
      filename: (req, file, cb) => {
        const tempName = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}_${file.originalname}`;
        cb(null, tempName);
      }
    });

    const maxSizeMB = this.config.prog.file_validation?.max_size_mb || 5000;
    const maxSizeBytes = maxSizeMB * 1024 * 1024;

    this.upload = multer({
      storage,
      limits: {
        fileSize: maxSizeBytes,
        files: this.config.prog.file_validation?.max_concurrent_uploads || 5
      }
    });

    Print('DEBUG', `Multer streaming upload configured with ${maxSizeMB}MB limit`);
  }

  // Set up middleware including REQ header pattern
  private setupMiddleware(): void {
    // Request logging middleware
    this.app.use((req: ExtendedRequest, res: ExtendedResponse, next: NextFunction) => {
      Print('DEBUG', `Incoming ${req.method} request to ${req.url} from ${req.ip}`);
      Print('DEBUG', `Request headers: ${JSON.stringify(req.headers, null, 2)}`);

      // Log response - skip for file downloads to avoid interfering with binary data
      if (!req.url.startsWith('/api/download/')) {
        const originalSend = res.send;
        res.send = function (data: any) {
          Print('DEBUG', `Response sent for ${req.method} ${req.url}: status ${res.statusCode}`);
          return originalSend.call(this, data);
        };
      }

      const originalRedirect = res.redirect;
      res.redirect = function (location: string) {
        Print('DEBUG', `Redirect sent for ${req.method} ${req.url} -> ${location}`);
        return originalRedirect.call(this, location);
      };

      next();
    });

    // Keep JSON parsing for non-file requests with smaller limit
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // REQ header middleware
    this.app.use((req: ExtendedRequest, res: ExtendedResponse, next: NextFunction) => {
      if (req.headers.req) {
        try {
          const decoded = RequestEncoder.decode(req.headers.req as string);
          req.reqData = decoded;
        } catch (e) {
          req.reqData = { success: false, body: { error: 'Invalid REQ header' } };
        }
      }

      // Add response helper
      res.sendREQ = (success: boolean, body: any) => {
        res.setHeader('REQ', RequestEncoder.encode(success, body));
        res.json({ status: success ? 'Success' : 'Error', details: 'See REQ header' });
      };

      next();
    });

    Print('INFO', 'REQ header middleware initialized');
  }

  // Set up routes using configuration
  private setupRoutes(): void {
    Print('DEBUG', 'Setting up routes...');

    // Serve static Aurelia 2.0 built files
    this.app.use(express.static(path.join(__dirname, '../dist')));
    Print('DEBUG', `Static files served from: ${path.join(__dirname, '../dist')}`);

    // Serve the initial WebSocket availability check route with processed template
    const availabilityUrlRoute = this.config.prog.collab_interface_url.route;
    Print('DEBUG', `Registering main interface route: ${availabilityUrlRoute}`);
    this.app.get(availabilityUrlRoute, this.handleIndexRoute.bind(this));

    // Add root route redirect to main interface
    Print('DEBUG', 'Registering root route redirect to main interface');
    this.app.get('/', (req: Request, res: Response) => {
      Print('INFO', `Root route accessed, redirecting to ${availabilityUrlRoute}`);
      res.redirect(availabilityUrlRoute);
    });

    // HTTP API endpoints for file operations (fallback for when WebSocket fails)
    Print('DEBUG', 'Registering API endpoints: /api/upload, /api/files, /api/download/:filename, /api/delete/:filename');
    this.app.post('/api/upload', this.upload.single('file'), this.handleHttpUploadMulter.bind(this));
    this.app.post('/api/upload-legacy', this.handleHttpUpload.bind(this));
    this.app.get('/api/files', this.handleFileListRequest.bind(this));
    this.app.get('/_cat/files', this.handleFileListRequest.bind(this));
    this.app.get('/api/download/:filename', this.handleFileDownload.bind(this));
    this.app.delete('/api/delete/:filename', this.handleFileDelete.bind(this));

    // Handle WebSocket upgrade requests selectively based on the configured endpoint
    this.server.on('upgrade', (req, socket, head) => {
      const wsUrlRoute = this.config.prog.websocket_server_url.route;

      if (req.url === wsUrlRoute) {
        Print('INFO', `Received WebSocket upgrade request at ${req.url}`);
        this.handleNewWebsocketConnection(req, socket, head);
      } else {
        Print('WARNING', `Unexpected WebSocket upgrade request at ${req.url} - Closing socket`);
        socket.destroy();
      }
    });
  }

  // Serve processed template with WebSocket route injection
  private handleIndexRoute(req: Request, res: Response): void {
    Print('DEBUG', `handleIndexRoute called for ${req.url}`);
    const templatePath = path.join(__dirname, '../templates', 'index.template.html');
    Print('DEBUG', `Template path: ${templatePath}`);

    fs.readFile(templatePath, 'utf8', (err, template) => {
      if (err) {
        Print('ERROR', `Failed to load template: ${err.message}`);
        Print('DEBUG', `Template path does not exist: ${templatePath}`);
        res.status(500).send('Server error');
        return;
      }

      Print('DEBUG', `Template loaded successfully, length: ${template.length} characters`);

      // Inject the WebSocket upgrade route from config.json
      const websocketUpgradeRoute = this.config.prog.websocket_server_url.route;
      Print('DEBUG', `WebSocket route from config: ${websocketUpgradeRoute}`);

      const processedHtml = template.replace('[[WEBSOCKET_UPGRADE_ROUTE]]', websocketUpgradeRoute);
      Print('DEBUG', `Template processed, WebSocket route injected`);

      res.setHeader('Content-Type', 'text/html');
      res.send(processedHtml);
      Print('INFO', `Served processed template with WebSocket route injected at ${req.url}`);
    });
  }

  // WebSocket upgrade and handling method for specific route
  private handleNewWebsocketConnection(req: any, socket: any, head: any): void {
    this.wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      Print('INFO', 'WebSocket connection established for app logging data stream');
      this.wss.emit('connection', ws, req);
    });
  }

  // Initialize enhanced WebSocket handlers with reliability features
  private initializeWebSocketHandlers(): void {
    this.wss.on('connection', (ws: WebSocket, request: any) => {
      const clientId = this.generateClientId();
      this.clientStates.set(clientId, {
        ws,
        wsFailures: 0,
        usingHttpFallback: false,
        activeTransfers: new Map(),
        lastHeartbeat: Date.now()
      });

      Print('INFO', `Client ${clientId} connected to WebSocket`);

      // Send initial file list and config to new client
      this.sendInitialDataToClient(ws);

      ws.on('message', (message: WebSocket.Data) => this.handleWebSocketMessage(clientId, message));
      ws.on('pong', () => this.handleHeartbeat(clientId));
      ws.on('close', () => this.handleClientDisconnect(clientId));
      ws.on('error', (error: Error) => this.handleWebSocketError(clientId, error));
    });

    // Start heartbeat monitoring
    this.startHeartbeatMonitoring();

    // Start temp file cleanup service
    this.startTempFileCleanup();
  }

  // Generate unique client ID
  private generateClientId(): string {
    return 'client_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  // Get next sequence number for a client
  private getNextSequence(clientId: string): number {
    const current = this.clientSequences.get(clientId) || 0;
    const next = current + 1;
    this.clientSequences.set(clientId, next);
    return next;
  }

  // Handle timemap requests
  private async handleTimeMapRequest(clientId: string, message: any): Promise<void> {
    const { action, req } = message;
    
    try {
      // Decode request data if present
      let requestData: any = {};
      if (req) {
        const { success, body } = RequestEncoder.decode(req);
        if (!success) {
          this.sendToClient(clientId, { 
            type: 'timemap_response', 
            action, 
            error: 'Invalid request encoding' 
          });
          return;
        }
        requestData = body;
      }
      
      Print('DEBUG', `Processing timemap action: ${action}`);
      
      switch (action) {
        case 'get_map':
          const mapData = await this.timeMapCalculator.calculateTimeMap();
          const serializedMapData = this.timeMapCalculator.serializeTimeMapData(mapData);
          
          this.sendToClient(clientId, {
            type: 'timemap_response',
            action: 'map_data',
            data: serializedMapData
          });
          
          Print('DEBUG', `Sent TimeMap data to ${clientId}: ${mapData.totalEvents} events`);
          break;
          
        case 'get_day':
          if (!requestData.date) {
            this.sendToClient(clientId, { 
              type: 'timemap_response', 
              action, 
              error: 'Date parameter required' 
            });
            return;
          }
          
          const dayEvents = await this.timeMapCalculator.getEventsForDay(requestData.date);
          const serializedDayEvents = this.timeMapCalculator.serializeDayEvents(dayEvents);
          
          this.sendToClient(clientId, {
            type: 'timemap_response',
            action: 'day_events',
            data: serializedDayEvents
          });
          
          Print('DEBUG', `Sent day events to ${clientId}: ${dayEvents.events.length} events for ${requestData.date}`);
          break;
          
        case 'get_month':
          if (!requestData.year || !requestData.month) {
            this.sendToClient(clientId, { 
              type: 'timemap_response', 
              action, 
              error: 'Year and month parameters required' 
            });
            return;
          }
          
          const monthEvents = await this.timeMapCalculator.getEventsForMonth(requestData.year, requestData.month);
          
          this.sendToClient(clientId, {
            type: 'timemap_response',
            action: 'month_events',
            data: { events: monthEvents }
          });
          
          Print('DEBUG', `Sent month events to ${clientId}: ${monthEvents.length} events for ${requestData.year}-${requestData.month}`);
          break;
          
        case 'get_year':
          if (!requestData.year) {
            this.sendToClient(clientId, { 
              type: 'timemap_response', 
              action, 
              error: 'Year parameter required' 
            });
            return;
          }
          
          const yearEvents = await this.timeMapCalculator.getEventsForYear(requestData.year);
          
          this.sendToClient(clientId, {
            type: 'timemap_response',
            action: 'year_events',
            data: { events: yearEvents }
          });
          
          Print('DEBUG', `Sent year events to ${clientId}: ${yearEvents.length} events for ${requestData.year}`);
          break;
          
        default:
          this.sendToClient(clientId, { 
            type: 'timemap_response', 
            action, 
            error: `Unknown action: ${action}` 
          });
          Print('WARNING', `Unknown timemap action: ${action} from ${clientId}`);
      }
    } catch (error) {
      Print('ERROR', `TimeMap request failed: ${(error as Error).message}`);
      this.sendToClient(clientId, { 
        type: 'timemap_response', 
        action, 
        error: (error as Error).message 
      });
    }
  }

  // Handle search requests
  private async handleSearchRequest(clientId: string, message: any): Promise<void> {
    const { action, req } = message;
    
    try {
      // Decode request data if present
      let requestData: any = {};
      if (req) {
        const { success, body } = RequestEncoder.decode(req);
        if (!success) {
          this.sendToClient(clientId, { 
            type: 'search_response', 
            action, 
            error: 'Invalid request encoding' 
          });
          return;
        }
        requestData = body;
      }
      
      Print('DEBUG', `Processing search action: ${action}`);
      
      switch (action) {
        case 'get_bundle':
          const bundle = await this.searchIndexManager.getSmartBundle();
          
          this.sendToClient(clientId, {
            type: 'search_response',
            action: 'bundle',
            data: bundle
          });
          
          Print('DEBUG', `Sent search bundle to ${clientId}: ${bundle.totalDocuments} documents`);
          break;
          
        case 'search':
          if (!requestData.query) {
            this.sendToClient(clientId, { 
              type: 'search_response', 
              action, 
              error: 'Query parameter required' 
            });
            return;
          }
          
          const searchResults = this.searchIndexManager.search(requestData.query, {
            limit: requestData.limit || 20,
            timeRange: requestData.timeRange,
            type: requestData.type
          });
          
          this.sendToClient(clientId, {
            type: 'search_response',
            action: 'results',
            data: { 
              query: requestData.query, 
              results: searchResults,
              total: searchResults.length
            }
          });
          
          Print('DEBUG', `Sent search results to ${clientId}: ${searchResults.length} results for "${requestData.query}"`);
          break;
          
        case 'suggest':
          if (!requestData.prefix) {
            this.sendToClient(clientId, { 
              type: 'search_response', 
              action, 
              error: 'Prefix parameter required' 
            });
            return;
          }
          
          const suggestions = this.searchIndexManager.getSuggestions(
            requestData.prefix, 
            requestData.limit || 10
          );
          
          this.sendToClient(clientId, {
            type: 'search_response',
            action: 'suggestions',
            data: { 
              prefix: requestData.prefix, 
              suggestions 
            }
          });
          
          Print('DEBUG', `Sent suggestions to ${clientId}: ${suggestions.length} suggestions for "${requestData.prefix}"`);
          break;
          
        case 'stats':
          const stats = this.searchIndexManager.getIndexStats();
          
          this.sendToClient(clientId, {
            type: 'search_response',
            action: 'stats',
            data: stats
          });
          
          Print('DEBUG', `Sent search stats to ${clientId}: ${stats.documentCount} documents, version ${stats.indexVersion}`);
          break;
          
        default:
          this.sendToClient(clientId, { 
            type: 'search_response', 
            action, 
            error: `Unknown action: ${action}` 
          });
          Print('WARNING', `Unknown search action: ${action} from ${clientId}`);
      }
    } catch (error) {
      Print('ERROR', `Search request failed: ${(error as Error).message}`);
      this.sendToClient(clientId, { 
        type: 'search_response', 
        action, 
        error: (error as Error).message 
      });
    }
  }

  // Handle browser console log messages
  private handleBrowserLog(clientId: string, logData: any): void {
    try {
      const { logType, message, timestamp, functionName, url, userAgent } = logData;
      
      // Format log message for server console
      const formattedMessage = `[BROWSER] ${logType}: ${timestamp} - ${functionName} - ${message}`;
      const urlInfo = `URL: ${url}`;
      
      // Print to server console with appropriate level
      switch (logType) {
        case 'ERROR':
        case 'CRITICAL':
        case 'EXCEPTION':
        case 'FAILURE':
          Print('ERROR', formattedMessage);
          Print('DEBUG', urlInfo);
          break;
        case 'WARNING':
          Print('WARNING', formattedMessage);
          break;
        case 'SUCCESS':
        case 'COMPLETED':
          Print('SUCCESS', formattedMessage);
          break;
        case 'DEBUG':
        case 'TRACE':
          Print('DEBUG', formattedMessage);
          break;
        default:
          Print('INFO', formattedMessage);
      }
      
      // Write to browser console log file
      this.writeBrowserLogToFile(logData, clientId);
      
    } catch (error) {
      Print('ERROR', `Failed to handle browser log: ${(error as Error).message}`);
    }
  }

  // Write browser log to file
  private writeBrowserLogToFile(logData: any, clientId: string): void {
    try {
      const fs = require('fs');
      const path = require('path');
      
      const logDir = path.join(__dirname, '../logs');
      const logFile = path.join(logDir, 'browser_console.log');
      
      // Ensure logs directory exists
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      
      // Format log entry
      const { logType, message, timestamp, functionName, url, userAgent } = logData;
      const logEntry = {
        timestamp,
        clientId,
        logType,
        functionName,
        message,
        url,
        userAgent: userAgent.substring(0, 100) // Truncate user agent
      };
      
      // Append to log file as JSON lines
      const logLine = JSON.stringify(logEntry) + '\n';
      fs.appendFileSync(logFile, logLine);
      
    } catch (error) {
      Print('ERROR', `Failed to write browser log to file: ${(error as Error).message}`);
    }
  }

  // Send message to specific client
  private sendToClient(clientId: string, message: any): void {
    const client = this.clientStates.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(message));
      Print('TRACE', `Sent message to ${clientId}: ${message.type}`);
    } else {
      Print('WARNING', `Cannot send message to ${clientId}: client not connected`);
    }
  }

  // Handle WebSocket messages with enhanced reliability
  private handleWebSocketMessage(clientId: string, message: WebSocket.Data): void {
    Print('DEBUG', `Received WebSocket message from ${clientId}`);
    Print('TRACE', `WebSocket message content: ${message}`);

    try {
      const data = JSON.parse(message.toString());
      Print('TRACE', `Parsed message data: ${JSON.stringify(data)}`);

      // Handle different message types
      if (data.type === 'file_chunk' && data.req) {
        Print('DEBUG', `Handling file chunk message from ${clientId}`);
        const { success, body } = RequestEncoder.decode(data.req);
        if (success) {
          this.handleFileChunk(clientId, body);
        } else {
          Print('ERROR', `Invalid REQ header in file chunk from ${clientId}`);
        }
      } else if (data.type === 'timemap_request') {
        Print('DEBUG', `Handling timemap request from ${clientId}`);
        this.handleTimeMapRequest(clientId, data);
      } else if (data.type === 'search_request') {
        Print('DEBUG', `Handling search request from ${clientId}`);
        this.handleSearchRequest(clientId, data);
      } else if (data.type === 'browser_log') {
        this.handleBrowserLog(clientId, data);
      } else {
        // Default behavior: broadcast to all clients (for text collaboration)
        Print('DEBUG', `Broadcasting text collaboration message from ${clientId} to ${this.wss.clients.size} clients`);
        Print('TRACE', `Text message content: index=${data.index}, content length=${data.content ? data.content.length : 'undefined'}`);

        // Record text change events to EventStore
        if (data.type === 'text_change' && data.index !== undefined && data.content !== undefined) {
          const sequenceNum = this.getNextSequence(clientId);
          this.eventStore.recordEvent({
            event_type: 'text_change',
            entity_id: `register${data.index + 1}`,
            payload: { content: data.content },
            client_id: clientId,
            sequence_num: sequenceNum
          }).then(event => {
            // Update search index and broadcast delta
            const indexDelta = this.searchIndexManager.handleIndexDelta(event);
            this.broadcastIndexDelta(indexDelta);
            
            Print('DEBUG', `Recorded text_change event for register${data.index + 1} (seq: ${sequenceNum})`);
          }).catch(error => {
            Print('ERROR', `Failed to record text_change event: ${error.message}`);
          });
        }

        const jsonMessage = JSON.stringify(data);
        let broadcastCount = 0;

        // Send to all connected WebSocket clients
        this.wss.clients.forEach((client: WebSocket) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(jsonMessage);
            broadcastCount++;
            Print('TRACE', `Sent message to client (state: ${client.readyState})`);
          } else {
            Print('TRACE', `Skipping client with state: ${client.readyState}`);
          }
        });

        Print('INFO', `Broadcasted message from ${clientId} to ${broadcastCount} clients`);
      }
    } catch (error) {
      Print('ERROR', `Failed to parse WebSocket message from ${clientId}: ${(error as Error).message}`);
      this.handleWebSocketError(clientId, error as Error);
    }
  }

  // Handle heartbeat pong responses
  private handleHeartbeat(clientId: string): void {
    const client = this.clientStates.get(clientId);
    if (client) {
      client.lastHeartbeat = Date.now();
      Print('DEBUG', `Heartbeat received from ${clientId}`);
    }
  }

  // Handle client disconnection
  private async handleClientDisconnect(clientId: string): Promise<void> {
    Print('INFO', `Client ${clientId} disconnected from WebSocket`);

    const client = this.clientStates.get(clientId);
    if (client && client.activeTransfers) {
      // Clean up any active file transfers
      for (const [fileId, transfer] of client.activeTransfers) {
        Print('DEBUG', `Cleaning up interrupted transfer for ${fileId}`);

        if (transfer.writeStream) {
          transfer.writeStream.destroy();
        }

        if (transfer.tempFilePath) {
          try {
            await fs.promises.unlink(transfer.tempFilePath);
            Print('DEBUG', `Cleaned up temp file: ${transfer.tempFilePath}`);
          } catch (error) {
            Print('DEBUG', `Failed to clean up temp file: ${(error as Error).message}`);
          }
        }
      }
    }

    this.clientStates.delete(clientId);
  }

  // Handle WebSocket errors
  private handleWebSocketError(clientId: string, error: Error): void {
    const client = this.clientStates.get(clientId);
    if (client) {
      client.wsFailures++;
      Print('ERROR', `WebSocket error for ${clientId} (failure #${client.wsFailures}): ${error.message}`);

      // If failures exceed threshold, could trigger fallback logic here
      if (client.wsFailures >= (this.config.prog.websocket_fallback_failure_event_threshold || 3)) {
        Print('WARNING', `Client ${clientId} has exceeded WebSocket failure threshold`);
        client.usingHttpFallback = true;
      }
    }
  }

  // Start heartbeat monitoring
  private startHeartbeatMonitoring(): void {
    const heartbeatInterval = this.config.prog.heartbeat_interval_ms || 30000;
    const heartbeatTimeout = this.config.prog.heartbeat_timeout_ms || 60000;

    this.wsHeartbeatInterval = setInterval(() => {
      this.clientStates.forEach((state, clientId) => {
        if (Date.now() - state.lastHeartbeat > heartbeatTimeout) {
          Print('WARNING', `Client ${clientId} heartbeat timeout, terminating connection`);
          state.ws.terminate();
          this.handleClientDisconnect(clientId);
        } else if (state.ws.readyState === WebSocket.OPEN) {
          state.ws.ping();
        }
      });
    }, heartbeatInterval);

    Print('INFO', `Heartbeat monitoring started (interval: ${heartbeatInterval}ms, timeout: ${heartbeatTimeout}ms)`);
  }

  // Start temp file cleanup service
  private startTempFileCleanup(): void {
    const cleanupInterval = this.config.prog.memory_management?.cleanup_interval_ms || 300000; // 5 minutes
    const maxFileAge = this.config.prog.memory_management?.max_temp_file_age_ms || 3600000; // 1 hour

    this.tempCleanupInterval = setInterval(async () => {
      try {
        const storageDir = path.join(__dirname, '../storage');
        const files = await fs.promises.readdir(storageDir);

        for (const file of files) {
          if (file.startsWith('temp_')) {
            const filePath = path.join(storageDir, file);
            const stats = await fs.promises.stat(filePath);
            const fileAge = Date.now() - stats.mtime.getTime();

            if (fileAge > maxFileAge) {
              try {
                await fs.promises.unlink(filePath);
                Print('DEBUG', `Cleaned up old temp file: ${file} (age: ${Math.round(fileAge / 60000)}min)`);
              } catch (error) {
                Print('DEBUG', `Failed to clean temp file ${file}: ${(error as Error).message}`);
              }
            }
          }
        }
      } catch (error) {
        Print('DEBUG', `Temp file cleanup error: ${(error as Error).message}`);
      }
    }, cleanupInterval);

    Print('INFO', `Temp file cleanup started (interval: ${cleanupInterval}ms, max age: ${maxFileAge}ms)`);
  }

  // Handle file chunk uploads via WebSocket with streaming write
  private async handleFileChunk(clientId: string, chunkData: any): Promise<void> {
    Print('DEBUG', `handleFileChunk called for client ${clientId}`);
    Print('DEBUG', `Chunk data keys: ${Object.keys(chunkData).join(', ')}`);

    const client = this.clientStates.get(clientId);
    if (!client) {
      Print('ERROR', `Client ${clientId} not found in clientStates`);
      return;
    }

    const { fileId, chunkIndex, totalChunks, data, metadata } = chunkData;
    Print('DEBUG', `File upload: ${metadata.filename}, chunk ${chunkIndex + 1}/${totalChunks}, data length: ${data ? data.length : 'undefined'}`);

    if (!client.activeTransfers.has(fileId)) {
      Print('DEBUG', `Starting new streaming file transfer for ${fileId}`);

      // Create a temporary file for streaming write
      const tempFileId = `temp_${fileId}_${Date.now()}`;
      const tempFilePath = path.join(__dirname, '../storage', tempFileId);

      client.activeTransfers.set(fileId, {
        tempFilePath,
        tempFileId,
        writeStream: fs.createWriteStream(tempFilePath),
        metadata,
        receivedChunks: 0,
        totalChunks,
        chunksReceived: new Set()
      });
    }

    const transfer = client.activeTransfers.get(fileId)!;

    // Check for duplicate chunks
    if (transfer.chunksReceived.has(chunkIndex)) {
      Print('DEBUG', `Duplicate chunk ${chunkIndex} ignored for ${metadata.filename}`);
      return;
    }

    try {
      // Decode and write chunk directly to stream - no memory buffering
      const chunkBuffer = Buffer.from(data, 'base64');

      // Write chunk to stream
      await new Promise<void>((resolve, reject) => {
        transfer.writeStream.write(chunkBuffer, (error?: Error | null) => {
          if (error) reject(error);
          else resolve();
        });
      });

      transfer.chunksReceived.add(chunkIndex);
      transfer.receivedChunks++;

      Print('DEBUG', `Chunk ${chunkIndex} streamed to disk, total received: ${transfer.receivedChunks}/${totalChunks}`);
    } catch (error) {
      Print('ERROR', `Failed to stream chunk ${chunkIndex}: ${(error as Error).message}`);

      // Clean up on error
      transfer.writeStream.destroy();
      try {
        await fs.promises.unlink(transfer.tempFilePath);
      } catch (cleanupError) {
        Print('DEBUG', `Temp file cleanup failed: ${(cleanupError as Error).message}`);
      }
      client.activeTransfers.delete(fileId);
      return;
    }

    Print('INFO', `Received chunk ${chunkIndex + 1}/${totalChunks} for file ${metadata.filename} from ${clientId}`);

    if (transfer.receivedChunks === totalChunks) {
      Print('DEBUG', `All chunks received for ${metadata.filename}, finalizing file`);

      // Close the write stream
      await new Promise<void>((resolve) => {
        transfer.writeStream.end(resolve);
      });

      try {
        // Use streaming file upload method
        const fileInfo = await this.fileManager.handleFileUploadStreaming(transfer.tempFilePath, {
          filename: metadata.filename,
          hostname: client.hostname || 'unknown',
          size: metadata.totalSize || 0
        });

        Print('DEBUG', `File saved successfully: ${JSON.stringify(fileInfo)}`);

        // Record file upload event
        const sequenceNum = this.getNextSequence(clientId);
        const uploadEvent = await this.eventStore.recordEvent({
          event_type: 'file_upload',
          entity_id: fileInfo.storedName,
          payload: { 
            filename: fileInfo.displayName,
            storedName: fileInfo.storedName,
            size: fileInfo.size,
            hash: fileInfo.hash
          },
          client_id: clientId,
          sequence_num: sequenceNum
        });
        
        // Update search index and broadcast delta
        const indexDelta = this.searchIndexManager.handleIndexDelta(uploadEvent);
        this.broadcastIndexDelta(indexDelta);
        
        Print('DEBUG', `Recorded file_upload event for ${fileInfo.displayName} (seq: ${sequenceNum})`);

        // Broadcast update to all clients
        this.broadcastFileListUpdate();
        client.activeTransfers.delete(fileId);

        Print('INFO', `Streaming file upload completed: ${metadata.filename}`);
      } catch (error) {
        Print('ERROR', `Streaming file upload failed: ${(error as Error).message}`);
        Print('DEBUG', `Error stack: ${(error as Error).stack}`);

        // Clean up temp file on error
        try {
          await fs.promises.unlink(transfer.tempFilePath);
        } catch (cleanupError) {
          Print('DEBUG', `Temp file cleanup failed: ${(cleanupError as Error).message}`);
        }
        client.activeTransfers.delete(fileId);
      }
    }
  }

  // Broadcast file list updates to all connected clients
  private broadcastFileListUpdate(): void {
    const fileList = this.fileManager.getFileList();
    const message = JSON.stringify({
      type: 'file_list_update',
      files: fileList
    });

    this.wss.clients.forEach((client: WebSocket) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });

    Print('INFO', `Broadcasted file list update to ${this.wss.clients.size} clients`);
  }

  // Broadcast search index delta to all connected clients
  private broadcastIndexDelta(delta: any): void {
    const message = JSON.stringify({
      type: 'index_delta',
      delta
    });

    this.wss.clients.forEach((client: WebSocket) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });

    Print('DEBUG', `Broadcasted index delta to ${this.wss.clients.size} clients: v${delta.fromVersion} -> v${delta.toVersion}`);
  }

  // Send initial data to a newly connected client
  private sendInitialDataToClient(ws: WebSocket): void {
    try {
      // Send current file list
      const fileList = this.fileManager.getFileList();
      const fileListMessage = JSON.stringify({
        type: 'file_list_update',
        files: fileList
      });
      ws.send(fileListMessage);

      // Send current configuration
      const configMessage = JSON.stringify({
        type: 'config_update',
        config: {
          oversize_file_in_mb: this.config.prog.oversize_file_in_mb || 100
        }
      });
      ws.send(configMessage);

      Print('INFO', `Sent initial data to new client: ${fileList.length} files`);
    } catch (error) {
      Print('ERROR', `Failed to send initial data to client: ${(error as Error).message}`);
    }
  }

  // New streaming HTTP upload endpoint using multer
  private async handleHttpUploadMulter(req: Request, res: Response): Promise<void> {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No file provided' });
        return;
      }

      Print('DEBUG', `Multer file upload: ${req.file.originalname}, temp file: ${req.file.filename}`);

      const tempFilePath = req.file.path;

      const fileInfo = await this.fileManager.handleFileUploadStreaming(tempFilePath, {
        filename: req.file.originalname,
        hostname: req.ip || 'unknown',
        size: req.file.size
      });

      // Record file upload event (HTTP upload gets client ID from IP)
      const clientId = `http_${req.ip || 'unknown'}_${Date.now()}`;
      const sequenceNum = this.getNextSequence(clientId);
      const uploadEvent = await this.eventStore.recordEvent({
        event_type: 'file_upload',
        entity_id: fileInfo.storedName,
        payload: { 
          filename: fileInfo.displayName,
          storedName: fileInfo.storedName,
          size: fileInfo.size,
          hash: fileInfo.hash
        },
        client_id: clientId,
        sequence_num: sequenceNum
      });
      
      // Update search index and broadcast delta
      const indexDelta = this.searchIndexManager.handleIndexDelta(uploadEvent);
      this.broadcastIndexDelta(indexDelta);
      
      Print('DEBUG', `Recorded file_upload event for ${fileInfo.displayName} via HTTP (seq: ${sequenceNum})`);

      this.broadcastFileListUpdate();
      res.json({ success: true, fileInfo });

      Print('INFO', `Streaming HTTP file upload completed: ${req.file.originalname}`);
    } catch (error) {
      Print('ERROR', `Streaming HTTP file upload failed: ${(error as Error).message}`);

      if (req.file && req.file.path) {
        try { 
          await fs.promises.unlink(req.file.path); 
        } catch (e) { 
          // Ignore cleanup errors
        }
      }

      res.status(500).json({ error: (error as Error).message });
    }
  }

  // Legacy HTTP fallback endpoint for file upload (base64)
  private async handleHttpUpload(req: ExtendedRequest, res: ExtendedResponse): Promise<void> {
    if (!req.reqData || !req.reqData.success) {
      res.sendREQ!(false, { error: 'Invalid request - REQ header required' });
      return;
    }

    const { filename, data } = req.reqData.body;

    if (!filename || !data) {
      res.sendREQ!(false, { error: 'Missing filename or data' });
      return;
    }

    try {
      const fileBuffer = Buffer.from(data, 'base64');

      const fileInfo = await this.fileManager.handleFileUpload(fileBuffer, {
        filename,
        hostname: req.ip || 'unknown'
      });

      // Record file upload event (legacy HTTP upload gets client ID from IP)
      const clientId = `http_legacy_${req.ip || 'unknown'}_${Date.now()}`;
      const sequenceNum = this.getNextSequence(clientId);
      const uploadEvent = await this.eventStore.recordEvent({
        event_type: 'file_upload',
        entity_id: fileInfo.storedName,
        payload: { 
          filename: fileInfo.displayName,
          storedName: fileInfo.storedName,
          size: fileInfo.size,
          hash: fileInfo.hash
        },
        client_id: clientId,
        sequence_num: sequenceNum
      });
      
      // Update search index and broadcast delta
      const indexDelta = this.searchIndexManager.handleIndexDelta(uploadEvent);
      this.broadcastIndexDelta(indexDelta);
      
      Print('DEBUG', `Recorded file_upload event for ${fileInfo.displayName} via legacy HTTP (seq: ${sequenceNum})`);

      this.broadcastFileListUpdate();
      res.sendREQ!(true, { fileInfo });

      Print('INFO', `Legacy HTTP file upload completed: ${filename}`);
    } catch (error) {
      Print('ERROR', `Legacy HTTP file upload failed: ${(error as Error).message}`);
      res.sendREQ!(false, { error: (error as Error).message });
    }
  }

  // HTTP endpoint for file list
  private handleFileListRequest(req: ExtendedRequest, res: ExtendedResponse): void {
    try {
      const fileList = this.fileManager.getFileList();
      res.sendREQ!(true, { files: fileList });
    } catch (error) {
      Print('ERROR', `File list request failed: ${(error as Error).message}`);
      res.sendREQ!(false, { error: (error as Error).message });
    }
  }

  // HTTP endpoint for file download
  private async handleFileDownload(req: Request, res: Response): Promise<void> {
    const { filename } = req.params;

    if (!filename) {
      res.status(400).json({ error: 'Filename required' });
      return;
    }

    try {
      if (!this.fileManager.fileExists(filename)) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      const fileData = await this.fileManager.getFileData(filename);
      const filePath = path.join(this.fileManager['storageDir'], filename);

      // Get file extension and set appropriate MIME type
      const ext = path.extname(filename).toLowerCase();
      let contentType = 'application/octet-stream';

      // Handle .tar.gz special case
      if (filename.toLowerCase().endsWith('.tar.gz')) {
        contentType = 'application/gzip';
      } else {
        const mimeTypes: Record<string, string> = {
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.gif': 'image/gif',
          '.heic': 'image/heic',
          '.webp': 'image/webp',
          '.jp2': 'image/jp2',
          '.jpx': 'image/jp2',
          '.j2k': 'image/jp2',
          '.tiff': 'image/tiff',
          '.tif': 'image/tiff',
          '.psd': 'image/vnd.adobe.photoshop',
          '.pdf': 'application/pdf',
          '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          '.py': 'text/x-python',
          '.js': 'application/javascript',
          '.rs': 'text/x-rust',
          '.php': 'application/x-httpd-php',
          '.html': 'text/html',
          '.css': 'text/css',
          '.sh': 'application/x-sh',
          '.txt': 'text/plain',
          '.json': 'application/json',
          '.safetensors': 'application/octet-stream',
          '.pt': 'application/octet-stream',
          '.pth': 'application/octet-stream',
          '.mp4': 'video/mp4',
          '.mov': 'video/quicktime',
          '.mkv': 'video/x-matroska',
          '.mp3': 'audio/mpeg',
          '.aac': 'audio/aac',
          '.zip': 'application/zip',
          '.dmg': 'application/x-apple-diskimage',
          '.iso': 'application/x-iso9660-image',
          '.pkg': 'application/x-newton-compatible-pkg',
          '.bin': 'application/octet-stream'
        };

        contentType = mimeTypes[ext] || contentType;
      }

      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', fileData.length);
      res.send(fileData);

      Print('INFO', `File download completed: ${filename} (${contentType})`);
    } catch (error) {
      Print('ERROR', `File download failed: ${(error as Error).message}`);
      res.status(500).json({ error: (error as Error).message });
    }
  }

  // HTTP endpoint for file deletion
  private async handleFileDelete(req: ExtendedRequest, res: ExtendedResponse): Promise<void> {
    const { filename } = req.params;
    
    try {
      const deleted = await this.fileManager.deleteFile(filename);
      if (deleted) {
        // Record file deletion event
        const clientId = `http_delete_${req.ip || 'unknown'}_${Date.now()}`;
        const sequenceNum = this.getNextSequence(clientId);
        this.eventStore.recordEvent({
          event_type: 'file_delete',
          entity_id: filename,
          payload: { 
            filename: filename
          },
          client_id: clientId,
          sequence_num: sequenceNum
        });
        Print('DEBUG', `Recorded file_delete event for ${filename} via HTTP (seq: ${sequenceNum})`);

        this.broadcastFileListUpdate();
        res.sendREQ!(true, { message: 'File deleted successfully' });
      } else {
        res.status(404);
        res.sendREQ!(false, { error: 'File not found' });
      }
    } catch (error) {
      Print('ERROR', `File deletion failed: ${(error as Error).message}`);
      res.status(500);
      res.sendREQ!(false, { error: (error as Error).message });
    }
  }

  // Start the HTTPS and WebSocket server
  start(): void {
    Print('DEBUG', `Starting server on ${this.args.hostname}:${this.args.port}`);
    Print('DEBUG', `Available routes:`);
    Print('DEBUG', `  GET / -> redirect to ${this.config.prog.collab_interface_url.route}`);
    Print('DEBUG', `  GET ${this.config.prog.collab_interface_url.route} -> main interface`);
    Print('DEBUG', `  POST /api/upload -> file upload`);
    Print('DEBUG', `  GET /api/files -> file list`);
    Print('DEBUG', `  GET /api/download/:filename -> file download`);
    Print('DEBUG', `  WebSocket upgrade at ${this.config.prog.websocket_server_url.route}`);

    this.server.listen(this.args.port, this.args.hostname, () => {
      Print('INFO', `Server running at https://${this.args.hostname}:${this.args.port}`);
      Print('INFO', `Main interface available at: https://${this.args.hostname}:${this.args.port}${this.config.prog.collab_interface_url.route}`);
      Print('INFO', `Root redirect available at: https://${this.args.hostname}:${this.args.port}/`);
    });
  }
}