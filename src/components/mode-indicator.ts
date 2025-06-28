import { BrowserPrint } from '../browser-logger';

export class ModeIndicator {
  mode: 'client' | 'peer' = 'client';
  
  get modeText(): string {
    return this.mode === 'client' ? 'Client Mode' : 'Peer Mode';
  }
  
  attached(): void {
    BrowserPrint('INFO', 'Mode indicator attached');
  }
  
  toggleMode(): void {
    if (this.mode === 'client') {
      this.mode = 'peer';
      BrowserPrint('STATE', 'Switched to Peer Mode');
    }
  }
}