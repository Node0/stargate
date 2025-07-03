import { BrowserPrint } from '../browser-logger';
import { CollaborationService } from '../services/collaboration.service';
import { inject } from 'aurelia';

@inject(CollaborationService)
export class TextRegister {
  static readonly bindables = ['registerId', 'content'];
  registerId: number = 1;
  content: string = '';
  
  private unsubscribe?: () => void;
  private isUpdatingFromRemote: boolean = false;
  
  // Use constructor injection instead of resolve()
  constructor(private collaboration: CollaborationService) {}
  
  attached(): void {
    BrowserPrint('INFO', `Text register ${this.registerId} attached`);
    
    // Service is already injected and available
    this.unsubscribe = this.collaboration.subscribeToRegister(
      this.registerId,
      (remoteContent) => {
        if (remoteContent !== this.content) {
          BrowserPrint('DEBUG', `Register ${this.registerId} updated from remote: ${remoteContent.length} chars`);
          this.isUpdatingFromRemote = true;
          this.content = remoteContent;
          this.isUpdatingFromRemote = false;
        }
      }
    );
  }
  
  detached(): void {
    BrowserPrint('INFO', `Text register ${this.registerId} detached`);
    this.unsubscribe?.();
  }
  
  contentChanged(newValue: string, oldValue: string): void {
    // Skip initial binding and remote updates
    if (oldValue === undefined || this.isUpdatingFromRemote) return;
    
    BrowserPrint('DEBUG', `Register ${this.registerId} local change: ${newValue.length} chars`);
    this.collaboration.syncRegister(this.registerId, newValue);
  }
}