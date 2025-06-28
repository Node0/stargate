import { BrowserPrint } from '../browser-logger';
import { WebSocketService } from '../services/websocket.service';
import { resolve } from 'aurelia';

export class TextRegister {
  static readonly bindables = ['registerId', 'content'];
  registerId: number = 1;
  content: string = '';
  
  private webSocketService: WebSocketService = resolve(WebSocketService);
  private subscription: (() => void) | null = null;
  private isUpdatingFromWebSocket = false;
  
  attached(): void {
    BrowserPrint('INFO', `Text register ${this.registerId} attached`);
    
    // Subscribe to incoming text changes from other clients
    this.subscription = this.webSocketService.onTextChange((message) => {
      if (message.registerId === this.registerId) {
        this.isUpdatingFromWebSocket = true;
        this.content = message.content;
        this.isUpdatingFromWebSocket = false;
        BrowserPrint('DEBUG', `Register ${this.registerId} updated from WebSocket: ${message.content.length} chars`);
      }
    });
  }
  
  detached(): void {
    BrowserPrint('INFO', `Text register ${this.registerId} detached`);
    if (this.subscription) {
      this.subscription();
      this.subscription = null;
    }
  }
  
  contentChanged(newValue: string, oldValue: string): void {
    // Don't send if this is the initial binding or if we're updating from WebSocket
    if (oldValue === undefined || this.isUpdatingFromWebSocket) return;
    
    BrowserPrint('DEBUG', `Register ${this.registerId} content changed: ${newValue.length} chars`);
    this.webSocketService.sendTextChange(this.registerId, newValue);
  }
}