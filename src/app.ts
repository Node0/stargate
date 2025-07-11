import { RegisterState } from '../shared/types';
import { BrowserPrint } from './browser-logger';
import { WebSocketService } from './services/websocket.service';
import { SearchService } from './services/search.service';
import { AppStateService } from './services/app-state.service';
import { resolve } from 'aurelia';

export class App {
  private webSocketService: WebSocketService = resolve(WebSocketService);
  private searchService: SearchService = resolve(SearchService);
  private appStateService: AppStateService = resolve(AppStateService);

  // Use AppStateService registers instead of local array
  get registers(): RegisterState[] {
    return this.appStateService.registers;
  }

  constructor() {
    BrowserPrint('INFO', 'App component constructor called');
  }

  attached(): void {
    BrowserPrint('SUCCESS', 'App component attached - Stargate Workspace UI initialized');
    BrowserPrint('STATE', `Initialized with ${this.registers.length} text registers`);
    BrowserPrint('INFO', 'TimeMap and search functionality enabled');
    
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