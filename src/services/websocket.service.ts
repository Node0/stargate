import { IEventAggregator, EventAggregator, resolve } from 'aurelia';
import { IWebSocketService } from './contracts';
import { BrowserPrint } from '../browser-logger';

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

export class WebSocketService implements IWebSocketService {
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  
  isConnected = false;
  private readonly wsRoute = '/_data_stream/app_logging_data';
  
  constructor(
    private ea: IEventAggregator = resolve(IEventAggregator)
  ) {
    this.connect();
  }
  
  private connect(): void {
    try {
      // Connect to WebSocket on the same host (single port architecture)
      this.ws = new WebSocket(`wss://${location.host}${this.wsRoute}`);
      
      this.ws.onopen = () => {
        this.isConnected = true;
        BrowserPrint('SUCCESS', 'WebSocket connected');
        this.ea.publish('ws:connected');
        
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
      };
      
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.ea.publish('ws:message', data);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };
      
      this.ws.onclose = () => {
        this.isConnected = false;
        console.log('WebSocket disconnected, attempting to reconnect...');
        this.ea.publish('ws:disconnected');
        
        // Attempt to reconnect after 3 seconds
        this.reconnectTimer = window.setTimeout(() => {
          this.connect();
        }, 3000);
      };
      
      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.ea.publish('ws:error', error);
      };
      
    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
      // Retry connection after 5 seconds
      this.reconnectTimer = window.setTimeout(() => {
        this.connect();
      }, 5000);
    }
  }
  
  send<T>(data: T): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      console.warn('WebSocket not connected, cannot send message');
    }
  }
  
  onMessage<T>(callback: (data: T) => void): () => void {
    const handler = (data: T) => {
      callback(data);
    };
    const subscription = this.ea.subscribe('ws:message', handler);
    return () => subscription.dispose();
  }
  
  sendTextChange(registerId: number, content: string): void {
    const message: TextChangeMessage = {
      type: 'text_change',
      registerId,
      content,
      timestamp: Date.now()
    };
    this.send(message);
    BrowserPrint('DEBUG', `Text change sent for register ${registerId}: ${content.length} chars`);
  }
  
  onTextChange(callback: (message: TextChangeMessage) => void): () => void {
    const handler = (data: WebSocketMessage) => {
      if (data.type === 'text_change') {
        callback(data);
      }
    };
    const subscription = this.ea.subscribe('ws:message', handler);
    return () => subscription.dispose();
  }
  
  dispose(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.isConnected = false;
  }
}