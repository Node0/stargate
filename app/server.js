const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const multer = require('multer');
const { ArgumentParser } = require('argparse');
const { Print, ErrorInterceptor, RequestEncoder, FileManager } = require('./utilities');

// Global uncaught error and exception capture.
ErrorInterceptor();

class Stargate
{
  constructor()
  {
    this.app = express();
    this.args = this.parseArguments();
    this.config = {};

    // Load SSL options
    this.sslOptions = {
      key: fs.readFileSync(path.resolve(__dirname, 'server.key')),
      cert: fs.readFileSync(path.resolve(__dirname, 'server.cert')),
    };

    // Create HTTPS server before setupRoutes
    this.server = https.createServer(this.sslOptions, this.app);
    this.wss = new WebSocket.Server({ noServer: true }); // Initialize WebSocket server without direct binding

    // Client state tracking for enhanced reliability
    this.clientStates = new Map();
    this.wsHeartbeatInterval = null;

    // Load configuration and set up middleware and routes
    this.loadConfig();
    
    // Initialize file manager with storage directory
    this.fileManager = new FileManager(
      path.join(__dirname, 'storage'),
      this.config
    );
    
    // Set up multer for streaming file uploads after FileManager is ready
    this.setupMulter();
    
    this.setupMiddleware();
    this.setupRoutes();
    this.initializeWebSocketHandlers();

    Print('INFO', 'Stargate instantiated');
  }

  // Parse command-line arguments
  parseArguments()
  {
    const parser = new ArgumentParser({
      description: 'Collaborative Register WebSocket Server',
    });
    parser.add_argument('--hostname', { help: 'Hostname for the server', default: '0.0.0.0' });
    parser.add_argument('--port', { help: 'Port for the server', type: 'int', default: 5900 });
    return parser.parse_args();
  }

  // Load configuration from config.json
  loadConfig()
  {
    try
    {
      const configPath = path.resolve(__dirname, '../app/conf/config.json');
      const configData = fs.readFileSync(configPath, 'utf8');
      this.config = JSON.parse(configData);
      Print('INFO', 'Configuration loaded successfully');
    }
    catch (error)
    {
      Print('ERROR', `Failed to load config: ${error.message}`);
      process.exit(1);
    }
  }

  // Set up multer for streaming file uploads
  setupMulter()
  {
    const storage = multer.diskStorage({
      destination: (req, file, cb) => {
        cb(null, path.join(__dirname, 'storage'));
      },
      filename: (req, file, cb) => {
        // Create temporary filename, will be processed by FileManager after upload
        const tempName = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}_${file.originalname}`;
        cb(null, tempName);
      }
    });
    
    // Use configuration-based file size limits
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
  setupMiddleware()
  {
    // Request logging middleware
    this.app.use((req, res, next) => {
      Print('DEBUG', `Incoming ${req.method} request to ${req.url} from ${req.ip}`);
      Print('DEBUG', `Request headers: ${JSON.stringify(req.headers, null, 2)}`);
      
      // Log response
      const originalSend = res.send;
      res.send = function(data) {
        Print('DEBUG', `Response sent for ${req.method} ${req.url}: status ${res.statusCode}`);
        return originalSend.call(this, data);
      };
      
      const originalRedirect = res.redirect;
      res.redirect = function(location) {
        Print('DEBUG', `Redirect sent for ${req.method} ${req.url} -> ${location}`);
        return originalRedirect.call(this, location);
      };
      
      next();
    });

    // Keep JSON parsing for non-file requests with smaller limit
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // REQ header middleware
    this.app.use((req, res, next) =>
    {
      if (req.headers.req)
      {
        try
        {
          const decoded = RequestEncoder.decode(req.headers.req);
          req.reqData = decoded;
        }
        catch (e)
        {
          req.reqData = { success: false, body: { error: 'Invalid REQ header' } };
        }
      }

      // Add response helper
      res.sendREQ = (success, body) =>
      {
        res.setHeader('REQ', RequestEncoder.encode(success, body));
        res.json({ status: success ? 'Success' : 'Error', details: 'See REQ header' });
      };

      next();
    });

    Print('INFO', 'REQ header middleware initialized');
  }

  // Set up routes using configuration
  setupRoutes()
  {
    Print('DEBUG', 'Setting up routes...');
    
    // Serve static files except index.html (which is now a template)
    this.app.use(express.static(path.join(__dirname, 'public')));
    Print('DEBUG', `Static files served from: ${path.join(__dirname, 'public')}`);

    // Serve the initial WebSocket availability check route with processed template
    const availabilityUrlRoute = this.config.prog.collab_interface_url.route;
    Print('DEBUG', `Registering main interface route: ${availabilityUrlRoute}`);
    this.app.get(availabilityUrlRoute, this.handleIndexRoute.bind(this));

    // Add root route redirect to main interface
    Print('DEBUG', 'Registering root route redirect to main interface');
    this.app.get('/', (req, res) => {
      Print('INFO', `Root route accessed, redirecting to ${availabilityUrlRoute}`);
      res.redirect(availabilityUrlRoute);
    });

    // HTTP API endpoints for file operations (fallback for when WebSocket fails)
    Print('DEBUG', 'Registering API endpoints: /api/upload, /api/files, /api/download/:filename');
    this.app.post('/api/upload', this.upload.single('file'), this.handleHttpUploadMulter.bind(this));
    this.app.post('/api/upload-legacy', this.handleHttpUpload.bind(this)); // Keep legacy base64 endpoint
    this.app.get('/api/files', this.handleFileListRequest.bind(this));
    this.app.get('/api/download/:filename', this.handleFileDownload.bind(this));

    // Handle WebSocket upgrade requests selectively based on the configured endpoint
    this.server.on('upgrade', (req, socket, head) =>
    {
      const wsUrlRoute = this.config.prog.websocket_server_url.route;

      if (req.url === wsUrlRoute)
      {
        Print('INFO', `Received WebSocket upgrade request at ${req.url}`);
        this.handleNewWebsocketConnection(req, socket, head);
      } else
      {
        Print('WARNING', `Unexpected WebSocket upgrade request at ${req.url} - Closing socket`);
        socket.destroy(); // Reject if the request does not match any valid WebSocket route
      }
    });
  }

  // Serve processed template with WebSocket route injection
  handleIndexRoute(req, res)
  {
    Print('DEBUG', `handleIndexRoute called for ${req.url}`);
    const templatePath = path.join(__dirname, 'templates', 'index.template.html');
    Print('DEBUG', `Template path: ${templatePath}`);

    fs.readFile(templatePath, 'utf8', (err, template) =>
    {
      if (err)
      {
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
  handleNewWebsocketConnection(req, socket, head)
  {
    this.wss.handleUpgrade(req, socket, head, (ws) =>
    {
      Print('INFO', 'WebSocket connection established for app logging data stream');
      this.wss.emit('connection', ws, req);
    });
  }

  // Initialize enhanced WebSocket handlers with reliability features
  initializeWebSocketHandlers()
  {
    this.wss.on('connection', (ws, request) =>
    {
      const clientId = this.generateClientId();
      this.clientStates.set(clientId, {
        ws,
        wsFailures: 0,
        usingHttpFallback: false,
        activeTransfers: new Map(),
        lastHeartbeat: Date.now()
      });

      Print('INFO', `Client ${clientId} connected to WebSocket`);

      ws.on('message', (message) => this.handleWebSocketMessage(clientId, message));
      ws.on('pong', () => this.handleHeartbeat(clientId));
      ws.on('close', () => this.handleClientDisconnect(clientId));
      ws.on('error', (error) => this.handleWebSocketError(clientId, error));
    });

    // Start heartbeat monitoring
    this.startHeartbeatMonitoring();
    
    // Start temp file cleanup service
    this.startTempFileCleanup();
  }

  // Generate unique client ID
  generateClientId()
  {
    return 'client_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  // Handle WebSocket messages with enhanced reliability
  handleWebSocketMessage(clientId, message)
  {
    Print('DEBUG', `Received WebSocket message from ${clientId}`);
    Print('TRACE', `WebSocket message content: ${message}`);
    
    try
    {
      const data = JSON.parse(message);
      Print('TRACE', `Parsed message data: ${JSON.stringify(data)}`);
      
      // Handle different message types
      if (data.type === 'file_chunk' && data.req)
      {
        Print('DEBUG', `Handling file chunk message from ${clientId}`);
        // Handle file chunk uploads with REQ header pattern
        const { success, body } = RequestEncoder.decode(data.req);
        if (success)
        {
          this.handleFileChunk(clientId, body);
        }
        else
        {
          Print('ERROR', `Invalid REQ header in file chunk from ${clientId}`);
        }
      }
      else
      {
        // Default behavior: broadcast to all clients (for text collaboration)
        Print('DEBUG', `Broadcasting text collaboration message from ${clientId} to ${this.wss.clients.size} clients`);
        Print('TRACE', `Text message content: index=${data.index}, content length=${data.content ? data.content.length : 'undefined'}`);
        
        const jsonMessage = JSON.stringify(data);
        let broadcastCount = 0;
        
        // Send to all connected WebSocket clients
        this.wss.clients.forEach((client) =>
        {
          if (client.readyState === WebSocket.OPEN)
          {
            client.send(jsonMessage);
            broadcastCount++;
            Print('TRACE', `Sent message to client (state: ${client.readyState})`);
          }
          else
          {
            Print('TRACE', `Skipping client with state: ${client.readyState}`);
          }
        });
        
        Print('INFO', `Broadcasted message from ${clientId} to ${broadcastCount} clients`);
      }
    }
    catch (error)
    {
      Print('ERROR', `Failed to parse WebSocket message from ${clientId}: ${error.message}`);
      this.handleWebSocketError(clientId, error);
    }
  }

  // Handle heartbeat pong responses
  handleHeartbeat(clientId)
  {
    const client = this.clientStates.get(clientId);
    if (client)
    {
      client.lastHeartbeat = Date.now();
      Print('DEBUG', `Heartbeat received from ${clientId}`);
    }
  }

  // Handle client disconnection
  async handleClientDisconnect(clientId)
  {
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
            Print('DEBUG', `Failed to clean up temp file: ${error.message}`);
          }
        }
      }
    }
    
    this.clientStates.delete(clientId);
  }

  // Handle WebSocket errors
  handleWebSocketError(clientId, error)
  {
    const client = this.clientStates.get(clientId);
    if (client)
    {
      client.wsFailures++;
      Print('ERROR', `WebSocket error for ${clientId} (failure #${client.wsFailures}): ${error.message}`);
      
      // If failures exceed threshold, could trigger fallback logic here
      if (client.wsFailures >= (this.config.prog.websocket_fallback_failure_event_threshold || 3))
      {
        Print('WARNING', `Client ${clientId} has exceeded WebSocket failure threshold`);
        client.usingHttpFallback = true;
      }
    }
  }

  // Start heartbeat monitoring
  startHeartbeatMonitoring()
  {
    const heartbeatInterval = this.config.prog.heartbeat_interval_ms || 30000;
    const heartbeatTimeout = this.config.prog.heartbeat_timeout_ms || 60000;

    this.wsHeartbeatInterval = setInterval(() =>
    {
      this.clientStates.forEach((state, clientId) =>
      {
        if (Date.now() - state.lastHeartbeat > heartbeatTimeout)
        {
          Print('WARNING', `Client ${clientId} heartbeat timeout, terminating connection`);
          state.ws.terminate();
          this.handleClientDisconnect(clientId);
        }
        else if (state.ws.readyState === WebSocket.OPEN)
        {
          state.ws.ping();
        }
      });
    }, heartbeatInterval);

    Print('INFO', `Heartbeat monitoring started (interval: ${heartbeatInterval}ms, timeout: ${heartbeatTimeout}ms)`);
  }

  // Start temp file cleanup service
  startTempFileCleanup()
  {
    const cleanupInterval = this.config.prog.memory_management?.cleanup_interval_ms || 300000; // 5 minutes
    const maxFileAge = this.config.prog.memory_management?.max_temp_file_age_ms || 3600000; // 1 hour
    
    this.tempCleanupInterval = setInterval(async () => {
      try {
        const storageDir = path.join(__dirname, 'storage');
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
                Print('DEBUG', `Failed to clean temp file ${file}: ${error.message}`);
              }
            }
          }
        }
      } catch (error) {
        Print('DEBUG', `Temp file cleanup error: ${error.message}`);
      }
    }, cleanupInterval);

    Print('INFO', `Temp file cleanup started (interval: ${cleanupInterval}ms, max age: ${maxFileAge}ms)`);
  }

  // Handle file chunk uploads via WebSocket with streaming write
  async handleFileChunk(clientId, chunkData)
  {
    Print('DEBUG', `handleFileChunk called for client ${clientId}`);
    Print('DEBUG', `Chunk data keys: ${Object.keys(chunkData).join(', ')}`);
    
    const client = this.clientStates.get(clientId);
    if (!client) {
      Print('ERROR', `Client ${clientId} not found in clientStates`);
      return;
    }

    const { fileId, chunkIndex, totalChunks, data, metadata } = chunkData;
    Print('DEBUG', `File upload: ${metadata.filename}, chunk ${chunkIndex + 1}/${totalChunks}, data length: ${data ? data.length : 'undefined'}`);

    if (!client.activeTransfers.has(fileId))
    {
      Print('DEBUG', `Starting new streaming file transfer for ${fileId}`);
      
      // Create a temporary file for streaming write
      const tempFileId = `temp_${fileId}_${Date.now()}`;
      const tempFilePath = path.join(__dirname, 'storage', tempFileId);
      
      client.activeTransfers.set(fileId, {
        tempFilePath,
        tempFileId,
        writeStream: fs.createWriteStream(tempFilePath),
        metadata,
        receivedChunks: 0,
        totalChunks,
        chunksReceived: new Set() // Track which chunks we've received
      });
    }

    const transfer = client.activeTransfers.get(fileId);
    
    // Check for duplicate chunks
    if (transfer.chunksReceived.has(chunkIndex)) {
      Print('DEBUG', `Duplicate chunk ${chunkIndex} ignored for ${metadata.filename}`);
      return;
    }
    
    try {
      // Decode and write chunk directly to stream - no memory buffering
      const chunkBuffer = Buffer.from(data, 'base64');
      
      // Write chunk to stream
      await new Promise((resolve, reject) => {
        transfer.writeStream.write(chunkBuffer, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      
      transfer.chunksReceived.add(chunkIndex);
      transfer.receivedChunks++;
      
      Print('DEBUG', `Chunk ${chunkIndex} streamed to disk, total received: ${transfer.receivedChunks}/${totalChunks}`);
    } catch (error) {
      Print('ERROR', `Failed to stream chunk ${chunkIndex}: ${error.message}`);
      
      // Clean up on error
      transfer.writeStream.destroy();
      try {
        await fs.promises.unlink(transfer.tempFilePath);
      } catch (cleanupError) {
        Print('DEBUG', `Temp file cleanup failed: ${cleanupError.message}`);
      }
      client.activeTransfers.delete(fileId);
      return;
    }

    Print('INFO', `Received chunk ${chunkIndex + 1}/${totalChunks} for file ${metadata.filename} from ${clientId}`);

    if (transfer.receivedChunks === totalChunks)
    {
      Print('DEBUG', `All chunks received for ${metadata.filename}, finalizing file`);
      
      // Close the write stream
      await new Promise((resolve) => {
        transfer.writeStream.end(resolve);
      });
      
      try
      {
        // Use streaming file upload method
        const fileInfo = await this.fileManager.handleFileUploadStreaming(transfer.tempFilePath, {
          filename: metadata.filename,
          hostname: client.hostname || 'unknown',
          size: metadata.totalSize || 0
        });

        Print('DEBUG', `File saved successfully: ${JSON.stringify(fileInfo)}`);

        // Broadcast update to all clients
        this.broadcastFileListUpdate();
        client.activeTransfers.delete(fileId);

        Print('INFO', `Streaming file upload completed: ${metadata.filename}`);
      }
      catch (error)
      {
        Print('ERROR', `Streaming file upload failed: ${error.message}`);
        Print('DEBUG', `Error stack: ${error.stack}`);
        
        // Clean up temp file on error
        try {
          await fs.promises.unlink(transfer.tempFilePath);
        } catch (cleanupError) {
          Print('DEBUG', `Temp file cleanup failed: ${cleanupError.message}`);
        }
        client.activeTransfers.delete(fileId);
      }
    }
  }

  // Broadcast file list updates to all connected clients
  broadcastFileListUpdate()
  {
    const fileList = this.fileManager.getFileList();
    const message = JSON.stringify({
      type: 'file_list_update',
      files: fileList
    });

    this.wss.clients.forEach(client =>
    {
      if (client.readyState === WebSocket.OPEN)
      {
        client.send(message);
      }
    });

    Print('INFO', `Broadcasted file list update to ${this.wss.clients.size} clients`);
  }

  // New streaming HTTP upload endpoint using multer
  async handleHttpUploadMulter(req, res)
  {
    try
    {
      if (!req.file)
      {
        return res.status(400).json({ error: 'No file provided' });
      }

      Print('DEBUG', `Multer file upload: ${req.file.originalname}, temp file: ${req.file.filename}`);
      
      // Process file without loading into memory - use streaming approach
      const tempFilePath = req.file.path;
      
      const fileInfo = await this.fileManager.handleFileUploadStreaming(tempFilePath, {
        filename: req.file.originalname,
        hostname: req.ip || 'unknown',
        size: req.file.size
      });

      // Temp file is cleaned up by FileManager after streaming

      this.broadcastFileListUpdate();
      res.json({ success: true, fileInfo });
      
      Print('INFO', `Streaming HTTP file upload completed: ${req.file.originalname}`);
    }
    catch (error)
    {
      Print('ERROR', `Streaming HTTP file upload failed: ${error.message}`);
      
      // Clean up temp file on error
      if (req.file && req.file.path)
      {
        try { await fs.promises.unlink(req.file.path); } catch (e) {}
      }
      
      res.status(500).json({ error: error.message });
    }
  }

  // Legacy HTTP fallback endpoint for file upload (base64)
  async handleHttpUpload(req, res)
  {
    if (!req.reqData || !req.reqData.success)
    {
      return res.sendREQ(false, { error: 'Invalid request - REQ header required' });
    }

    const { filename, data } = req.reqData.body;
    
    if (!filename || !data)
    {
      return res.sendREQ(false, { error: 'Missing filename or data' });
    }

    try
    {
      const fileBuffer = Buffer.from(data, 'base64');
      
      const fileInfo = await this.fileManager.handleFileUpload(fileBuffer, {
        filename,
        hostname: req.ip || 'unknown'
      });

      this.broadcastFileListUpdate();
      res.sendREQ(true, { fileInfo });
      
      Print('INFO', `Legacy HTTP file upload completed: ${filename}`);
    }
    catch (error)
    {
      Print('ERROR', `Legacy HTTP file upload failed: ${error.message}`);
      res.sendREQ(false, { error: error.message });
    }
  }

  // HTTP endpoint for file list
  handleFileListRequest(req, res)
  {
    try
    {
      const fileList = this.fileManager.getFileList();
      res.sendREQ(true, { files: fileList });
    }
    catch (error)
    {
      Print('ERROR', `File list request failed: ${error.message}`);
      res.sendREQ(false, { error: error.message });
    }
  }

  // HTTP endpoint for file download
  async handleFileDownload(req, res)
  {
    const { filename } = req.params;
    
    if (!filename)
    {
      return res.sendREQ(false, { error: 'Filename required' });
    }

    try
    {
      if (!this.fileManager.fileExists(filename))
      {
        return res.status(404).sendREQ(false, { error: 'File not found' });
      }

      const fileData = await this.fileManager.getFileData(filename);
      
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.send(fileData);
      
      Print('INFO', `File download completed: ${filename}`);
    }
    catch (error)
    {
      Print('ERROR', `File download failed: ${error.message}`);
      res.sendREQ(false, { error: error.message });
    }
  }

  // Start the HTTPS and WebSocket server
  start()
  {
    Print('DEBUG', `Starting server on ${this.args.hostname}:${this.args.port}`);
    Print('DEBUG', `Available routes:`);
    Print('DEBUG', `  GET / -> redirect to ${this.config.prog.collab_interface_url.route}`);
    Print('DEBUG', `  GET ${this.config.prog.collab_interface_url.route} -> main interface`);
    Print('DEBUG', `  POST /api/upload -> file upload`);
    Print('DEBUG', `  GET /api/files -> file list`);
    Print('DEBUG', `  GET /api/download/:filename -> file download`);
    Print('DEBUG', `  WebSocket upgrade at ${this.config.prog.websocket_server_url.route}`);
    
    this.server.listen(this.args.port, this.args.hostname, () =>
    {
      Print('INFO', `Server running at https://${this.args.hostname}:${this.args.port}`);
      Print('INFO', `Main interface available at: https://${this.args.hostname}:${this.args.port}${this.config.prog.collab_interface_url.route}`);
      Print('INFO', `Root redirect available at: https://${this.args.hostname}:${this.args.port}/`);
    });
  }
}

// Export Stargate for testing or external usage
module.exports = Stargate;

// Instantiate and start the server if executed directly
if (require.main === module)
{
  const stargateServer = new Stargate();
  stargateServer.start();
}
