import { BrowserPrint } from '../browser-logger';
import { singleton } from 'aurelia';

export interface WebSocketConfig {
  url?: string;
  reconnectDelay?: number;
  maxReconnectAttempts?: number;
}

export interface TextChangeMessage {
  type: 'text_change';
  registerId: number;
  content: string;
  timestamp: number;
}

export interface FileListUpdateMessage {
  type: 'file_list_update';
  files: any[];
}

export type WebSocketMessage = TextChangeMessage | FileListUpdateMessage;

@singleton
export class WebSocketService {
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private reconnectAttempts: number = 0;
  private messageHandlers: Array<(data: any) => void> = [];
  private connectionHandlers: Array<(connected: boolean) => void> = [];
  private config: Required<WebSocketConfig>;
  
  constructor(config?: WebSocketConfig) {
    this.config = {
      url: config?.url || `wss://${location.host}/_data_stream/app_logging_data`,
      reconnectDelay: config?.reconnectDelay || 5000,
      maxReconnectAttempts: config?.maxReconnectAttempts || 10
    };
  }
  
  connect(): void {
    BrowserPrint('INFO', `Connecting to WebSocket: ${this.config.url}`);
    
    try {
      this.ws = new WebSocket(this.config.url);
      
      this.ws.onopen = () => {
        BrowserPrint('SUCCESS', 'WebSocket connected');
        this.reconnectAttempts = 0;
        
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        
        this.notifyConnectionHandlers(true);
      };
      
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          BrowserPrint('TRACE', `WebSocket message received: ${data.type || 'unknown'}`);
          this.messageHandlers.forEach(handler => handler(data));
        } catch (e) {
          BrowserPrint('ERROR', `Failed to parse WebSocket message: ${e.message}`);
        }
      };
      
      this.ws.onclose = (event) => {
        BrowserPrint('WARNING', `WebSocket disconnected: ${event.code} - ${event.reason}`);
        this.notifyConnectionHandlers(false);
        this.scheduleReconnect();
      };
      
      this.ws.onerror = (error) => {
        BrowserPrint('ERROR', `WebSocket error: ${error}`);
      };
    } catch (error) {
      BrowserPrint('ERROR', `Failed to create WebSocket: ${error.message}`);
      this.scheduleReconnect();
    }
  }
  
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      BrowserPrint('ERROR', 'Max reconnection attempts reached');
      return;
    }
    
    if (!this.reconnectTimer) {
      this.reconnectAttempts++;
      const delay = this.config.reconnectDelay * Math.min(this.reconnectAttempts, 3);
      
      BrowserPrint('INFO', `Scheduling reconnection attempt ${this.reconnectAttempts} in ${delay}ms`);
      
      this.reconnectTimer = window.setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, delay);
    }
  }
  
  send(data: any): boolean {
    if (this.isConnected()) {
      try {
        this.ws!.send(JSON.stringify(data));
        BrowserPrint('TRACE', `WebSocket message sent: ${data.type || 'unknown'}`);
        return true;
      } catch (error) {
        BrowserPrint('ERROR', `Failed to send WebSocket message: ${error.message}`);
        return false;
      }
    } else {
      BrowserPrint('WARNING', 'WebSocket not connected, message queued');
      return false;
    }
  }
  
  onMessage(handler: (data: any) => void): () => void {
    this.messageHandlers.push(handler);
    return () => {
      const index = this.messageHandlers.indexOf(handler);
      if (index > -1) {
        this.messageHandlers.splice(index, 1);
      }
    };
  }
  
  onConnectionChange(handler: (connected: boolean) => void): () => void {
    this.connectionHandlers.push(handler);
    // Immediately notify of current state
    handler(this.isConnected());
    
    return () => {
      const index = this.connectionHandlers.indexOf(handler);
      if (index > -1) {
        this.connectionHandlers.splice(index, 1);
      }
    };
  }
  
  private notifyConnectionHandlers(connected: boolean): void {
    this.connectionHandlers.forEach(handler => handler(connected));
  }
  
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
  
  disconnect(): void {
    BrowserPrint('INFO', 'Disconnecting WebSocket');
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.messageHandlers = [];
    this.connectionHandlers = [];
  }
  
  // File chunk support for large data transfers
  sendFileChunk(fileId: string, chunkData: any): boolean {
    return this.send({
      type: 'file_chunk',
      req: btoa(JSON.stringify({ success: true, body: chunkData }))
    });
  }
  
  // Echo test for connection validation
  async ping(): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.isConnected()) {
        resolve(false);
        return;
      }
      
      const timeout = setTimeout(() => {
        BrowserPrint('WARNING', 'Ping timeout');
        resolve(false);
      }, 5000);
      
      const unsubscribe = this.onMessage((data: any) => {
        if (data.type === 'pong') {
          clearTimeout(timeout);
          unsubscribe();
          BrowserPrint('DEBUG', 'Pong received');
          resolve(true);
        }
      });
      
      this.send({ type: 'ping', timestamp: Date.now() });
    });
  }
}