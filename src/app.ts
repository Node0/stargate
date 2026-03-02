import { RegisterState } from '../shared/types';
import { BrowserPrint } from './browser-logger';
import { WebSocketService } from './services/websocket.service';
import { SearchService } from './services/search.service';
import { AppStateService } from './services/app-state.service';
import { AdminService } from './services/admin.service';
import { MessageBusService } from './services/message-bus.service';
import { resolve } from 'aurelia';

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
}

export class App {
  private webSocketService: WebSocketService = resolve(WebSocketService);
  private searchService: SearchService = resolve(SearchService);
  private appStateService: AppStateService = resolve(AppStateService);
  private adminService: AdminService = resolve(AdminService);
  private messageBus: MessageBusService = resolve(MessageBusService);

  // Toast notifications
  toasts: Toast[] = [];
  private toastCounter = 0;

  // Admin password modal
  showAdminPasswordModal = false;
  adminPassword = '';
  adminPasswordError = '';

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

    // Subscribe to toast notifications
    this.messageBus.subscribe('ui:show_toast', (data: { message: string; type: string }) => {
      this.showToast(data.message, data.type as Toast['type']);
    });

    // Subscribe to admin password prompt
    this.messageBus.subscribe('admin:password_required', () => {
      BrowserPrint('INFO', 'Admin password prompt received');
      this.showAdminPasswordModal = true;
      this.adminPassword = '';
      this.adminPasswordError = '';
    });

    // Initialize admin service after subscriptions are set up
    this.adminService.initialize();
  }

  detached(): void {
    BrowserPrint('INFO', 'App component detached');
  }

  // Toast methods
  showToast(message: string, type: Toast['type'] = 'info'): void {
    const id = ++this.toastCounter;
    this.toasts.push({ id, message, type });

    // Auto-remove after 4 seconds
    setTimeout(() => {
      this.removeToast(id);
    }, 4000);
  }

  removeToast(id: number): void {
    const index = this.toasts.findIndex(t => t.id === id);
    if (index !== -1) {
      this.toasts.splice(index, 1);
    }
  }

  // Admin password modal methods
  async submitAdminPassword(): Promise<void> {
    if (!this.adminPassword) {
      this.adminPasswordError = 'Password is required';
      return;
    }

    this.adminPasswordError = '';
    const success = await this.adminService.verifyPassword(this.adminPassword);

    if (success) {
      this.showAdminPasswordModal = false;
      this.adminPassword = '';
    } else {
      this.adminPasswordError = 'Invalid password';
    }
  }

  cancelAdminPassword(): void {
    this.showAdminPasswordModal = false;
    this.adminPassword = '';
    this.adminPasswordError = '';
    // Remove admin=true from URL
    const url = new URL(window.location.href);
    url.searchParams.delete('admin');
    window.history.replaceState({}, '', url.toString());
  }
}