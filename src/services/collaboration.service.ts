import { BrowserPrint } from '../browser-logger';
import { WebSocketService } from './websocket.service';
import { MessageBusService } from './message-bus.service';
import { singleton } from 'aurelia';

export interface TextChangeMessage {
  type: 'text_change';
  index: number;
  content: string;
  timestamp?: number;
}

export interface FileInfo {
  hash: string;
  displayName: string;
  size: number;
  timestamp: number;
  uploaderHostname: string;
  storedName?: string;
}

@singleton
export class CollaborationService {
  private wsUnsubscribe?: () => void;
  private connectionUnsubscribe?: () => void;
  
  constructor(
    private websocket: WebSocketService,
    private messageBus: MessageBusService
  ) {
    this.initialize();
  }
  
  private initialize(): void {
    // Subscribe to WebSocket messages
    this.wsUnsubscribe = this.websocket.onMessage((msg) => this.handleMessage(msg));
    
    // Subscribe to connection changes
    this.connectionUnsubscribe = this.websocket.onConnectionChange((connected) => {
      this.messageBus.publish('connection:status', connected);
      BrowserPrint('STATE', `Collaboration service connection: ${connected ? 'online' : 'offline'}`);
    });
    
    // Connect WebSocket
    this.websocket.connect();
  }
  
  private handleMessage(msg: any): void {
    BrowserPrint('DEBUG', `Handling collaboration message: ${msg.type}`);
    
    switch (msg.type) {
      case 'text_change':
        // Convert index to register ID (1-based)
        const registerId = msg.index + 1;
        this.messageBus.publish(`register:${registerId}`, msg.content);
        break;
        
      case 'file_list_update':
        this.messageBus.publish('files:update', msg.files);
        break;
        
      case 'config_update':
        this.messageBus.publish('config:update', msg.config);
        break;
        
      case 'timemap_response':
        this.messageBus.publish('timemap:response', msg);
        break;
        
      case 'search_response':
        this.messageBus.publish('search:response', msg);
        break;
        
      case 'index_delta':
        this.messageBus.publish('index_delta', msg.delta);
        break;
        
      default:
        BrowserPrint('DEBUG', `Unknown message type: ${msg.type}`);
    }
  }
  
  // Public API for components
  
  syncRegister(id: number, content: string): void {
    const message: TextChangeMessage = {
      type: 'text_change',
      index: id - 1, // Convert to 0-based index
      content
    };
    
    if (!this.websocket.send(message)) {
      BrowserPrint('WARNING', `Failed to sync register ${id} - will retry on reconnection`);
    }
  }
  
  subscribeToRegister(id: number, callback: (content: string) => void): () => void {
    return this.messageBus.subscribe(`register:${id}`, callback).unsubscribe;
  }
  
  subscribeToFileUpdates(callback: (files: FileInfo[]) => void): () => void {
    return this.messageBus.subscribe('files:update', callback).unsubscribe;
  }
  
  subscribeToConnection(callback: (connected: boolean) => void): () => void {
    return this.messageBus.subscribe('connection:status', callback).unsubscribe;
  }
  
  // File operations (chunk handling)
  sendFileChunk(fileId: string, chunkData: any): boolean {
    return this.websocket.sendFileChunk(fileId, chunkData);
  }
  
  // Send raw message
  sendMessage(message: any): boolean {
    return this.websocket.send(message);
  }
  
  // Connection management
  isConnected(): boolean {
    return this.websocket.isConnected();
  }
  
  // Connection test
  async testConnection(): Promise<boolean> {
    return this.websocket.ping();
  }
  
  // Get active message bus channels for debugging
  getActiveChannels(): string[] {
    return this.messageBus.getActiveChannels();
  }
  
  // Cleanup
  dispose(): void {
    BrowserPrint('INFO', 'Disposing CollaborationService');
    this.wsUnsubscribe?.();
    this.connectionUnsubscribe?.();
    this.websocket.disconnect();
    this.messageBus.dispose();
  }
}