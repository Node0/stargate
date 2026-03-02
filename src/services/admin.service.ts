import { singleton, inject } from 'aurelia';
import { MessageBusService } from './message-bus.service';
import { BrowserPrint } from '../browser-logger';

export interface AdminState {
  isAdminMode: boolean;
  isAuthenticated: boolean;
  isConfigured: boolean;
}

@singleton
@inject(MessageBusService)
export class AdminService {
  private state: AdminState = {
    isAdminMode: false,
    isAuthenticated: false,
    isConfigured: false
  };

  private subscribers: Set<(state: AdminState) => void> = new Set();
  private initialized: boolean = false;

  constructor(private messageBus: MessageBusService) {
    BrowserPrint('INFO', 'AdminService initialized');
  }

  // Initialize admin mode check - should be called after message bus subscriptions are set up
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    await this.checkAdminMode();
  }

  // Check if page was served via the admin mode URL
  async checkAdminMode(): Promise<void> {
    const isAdminUrl = !!(window as any).__STARGATE_ADMIN_MODE;

    BrowserPrint('DEBUG', `Admin mode flag: ${isAdminUrl}`);

    if (isAdminUrl) {
      BrowserPrint('INFO', 'Admin mode requested via admin URL');
      this.state.isAdminMode = true;

      // Check if admin is configured on server and if session is valid
      await this.checkServerAdminStatus();

      BrowserPrint('DEBUG', `After server check - configured: ${this.state.isConfigured}, authenticated: ${this.state.isAuthenticated}`);

      if (this.state.isConfigured && !this.state.isAuthenticated) {
        // Need to prompt for password
        BrowserPrint('INFO', 'Admin configured but not authenticated, prompting for password');
        this.promptForPassword();
      } else if (!this.state.isConfigured) {
        BrowserPrint('WARNING', 'Admin mode requested but server does not have admin password configured');
        this.messageBus.publish('ui:show_toast', {
          message: 'Admin mode not configured on server',
          type: 'warning'
        });
      } else {
        BrowserPrint('INFO', 'Admin already authenticated via cookie');
      }
    } else {
      BrowserPrint('DEBUG', 'Admin mode not requested (not served via admin URL)');
    }
  }

  // Check server admin configuration and session status
  async checkServerAdminStatus(): Promise<void> {
    try {
      const response = await fetch('/api/admin/check', {
        credentials: 'include' // Include cookies
      });

      if (response.ok) {
        const data = await response.json();
        this.state.isConfigured = data.configured;
        this.state.isAuthenticated = data.authenticated;

        BrowserPrint('INFO', `Admin status: configured=${data.configured}, authenticated=${data.authenticated}`);
        this.notifySubscribers();
      }
    } catch (error) {
      BrowserPrint('ERROR', `Failed to check admin status: ${(error as Error).message}`);
    }
  }

  // Prompt for admin password
  private promptForPassword(): void {
    BrowserPrint('INFO', 'Prompting for admin password');
    this.messageBus.publish('admin:password_required', true);
  }

  // Verify admin password
  async verifyPassword(password: string): Promise<boolean> {
    try {
      const response = await fetch('/api/admin/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ password })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          this.state.isAuthenticated = true;
          this.notifySubscribers();

          this.messageBus.publish('ui:show_toast', {
            message: 'Admin access granted (1 hour)',
            type: 'success'
          });

          BrowserPrint('SUCCESS', 'Admin authentication successful');
          return true;
        }
      } else {
        const errorData = await response.json();
        this.messageBus.publish('ui:show_toast', {
          message: errorData.error || 'Authentication failed',
          type: 'error'
        });
        BrowserPrint('WARNING', 'Admin authentication failed');
      }

      return false;
    } catch (error) {
      BrowserPrint('ERROR', `Admin verification failed: ${(error as Error).message}`);
      this.messageBus.publish('ui:show_toast', {
        message: 'Authentication error',
        type: 'error'
      });
      return false;
    }
  }

  // Archive a file
  async archiveFile(filename: string): Promise<boolean> {
    if (!this.state.isAuthenticated) {
      BrowserPrint('WARNING', 'Archive attempted without admin authentication');
      return false;
    }

    try {
      const response = await fetch(`/api/admin/archive/${encodeURIComponent(filename)}`, {
        method: 'POST',
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          this.messageBus.publish('ui:show_toast', {
            message: 'File archived successfully',
            type: 'success'
          });
          BrowserPrint('SUCCESS', `File archived: ${filename}`);
          return true;
        }
      } else {
        const errorData = await response.json();
        this.messageBus.publish('ui:show_toast', {
          message: errorData.error || 'Archive failed',
          type: 'error'
        });
      }

      return false;
    } catch (error) {
      BrowserPrint('ERROR', `File archive failed: ${(error as Error).message}`);
      return false;
    }
  }

  // Delete a file permanently
  async deleteFilePermanently(filename: string): Promise<boolean> {
    if (!this.state.isAuthenticated) {
      BrowserPrint('WARNING', 'Delete attempted without admin authentication');
      return false;
    }

    try {
      const response = await fetch(`/api/admin/delete/${encodeURIComponent(filename)}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          this.messageBus.publish('ui:show_toast', {
            message: 'File permanently deleted',
            type: 'success'
          });
          BrowserPrint('SUCCESS', `File deleted: ${filename}`);
          return true;
        }
      } else {
        const errorData = await response.json();
        this.messageBus.publish('ui:show_toast', {
          message: errorData.error || 'Delete failed',
          type: 'error'
        });
      }

      return false;
    } catch (error) {
      BrowserPrint('ERROR', `File delete failed: ${(error as Error).message}`);
      return false;
    }
  }

  // Subscribe to state changes
  subscribe(callback: (state: AdminState) => void): () => void {
    this.subscribers.add(callback);
    // Call immediately with current state
    callback(this.state);
    return () => this.subscribers.delete(callback);
  }

  // Notify all subscribers of state change
  private notifySubscribers(): void {
    for (const callback of this.subscribers) {
      callback(this.state);
    }
  }

  // Getters for state
  get isAdminMode(): boolean {
    return this.state.isAdminMode;
  }

  get isAuthenticated(): boolean {
    return this.state.isAuthenticated;
  }

  get isConfigured(): boolean {
    return this.state.isConfigured;
  }

  getState(): AdminState {
    return { ...this.state };
  }
}
