import { RegisterState } from '../shared/types';
import { BrowserPrint } from './browser-logger';
import { WebSocketService } from './services/websocket.service';
import { resolve } from 'aurelia';

export class App {
  registers: RegisterState[] = [
    { id: 1, content: '' },
    { id: 2, content: '' },
    { id: 3, content: '' }
  ];

  private webSocketService: WebSocketService = resolve(WebSocketService);

  constructor() {
    BrowserPrint('INFO', 'App component constructor called');
  }

  attached(): void {
    BrowserPrint('SUCCESS', 'App component attached - Stargate Workspace UI initialized');
    BrowserPrint('STATE', `Initialized with ${this.registers.length} text registers`);
    
    // Initialize WebSocket connection status logging
    if (this.webSocketService.isConnected) {
      BrowserPrint('SUCCESS', 'WebSocket connection active');
    } else {
      BrowserPrint('WARNING', 'WebSocket not yet connected');
    }
  }

  detached(): void {
    BrowserPrint('INFO', 'App component detached');
  }
}