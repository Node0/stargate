import { singleton } from 'aurelia';
import { MessageBusService } from './message-bus.service';
import { RegisterState } from '../../shared/types';
import { BrowserPrint } from '../browser-logger';

@singleton
export class AppStateService {
  // Live mode state (what Aurelia binds to)
  public registers: RegisterState[] = [
    { id: 1, content: '' },
    { id: 2, content: '' },
    { id: 3, content: '' }
  ];
  
  // Timeline mode state (temporary override)
  private timelineSnapshot: RegisterState[] | null = null;
  
  // Current mode
  private mode: 'live' | 'timeline' = 'live';
  
  constructor(private messageBus: MessageBusService) {
    this.setupStateHandlers();
    BrowserPrint('INFO', 'AppStateService initialized');
  }
  
  private setupStateHandlers(): void {
    // When timeline snapshot arrives from coordinator
    this.messageBus.subscribe('timeline:register_update', (updateData) => {
      if (updateData.fromTimeline) {
        this.handleTimelineRegisterUpdate(updateData);
      }
    });
    
    // When timeline mode is activated
    this.messageBus.subscribe('timeline:mode', (enabled) => {
      if (enabled) {
        this.mode = 'timeline';
        BrowserPrint('INFO', 'AppStateService switched to timeline mode');
      } else {
        this.mode = 'live';
        this.timelineSnapshot = null;
        BrowserPrint('INFO', 'AppStateService switched to live mode');
      }
    });
    
    // When returning to live mode
    this.messageBus.subscribe('timeline:exit', () => {
      this.exitTimelineMode();
    });
    
    // When live mode is restored
    this.messageBus.subscribe('timeline:live_mode', () => {
      this.mode = 'live';
      this.timelineSnapshot = null;
      BrowserPrint('INFO', 'AppStateService returned to live mode');
    });
    
    BrowserPrint('DEBUG', 'AppStateService event handlers set up');
  }
  
  private handleTimelineRegisterUpdate(updateData: any): void {
    const { registerId, content } = updateData;
    
    // Store in timeline snapshot
    if (!this.timelineSnapshot) {
      this.timelineSnapshot = this.registers.map(r => ({ ...r }));
    }
    
    // Find and update the register
    const register = this.registers.find(r => r.id === registerId);
    if (register) {
      register.content = content;
      BrowserPrint('DEBUG', `Timeline update applied to register ${registerId}`);
    }
    
    // Update timeline snapshot too
    const snapshotRegister = this.timelineSnapshot.find(r => r.id === registerId);
    if (snapshotRegister) {
      snapshotRegister.content = content;
    }
  }
  
  isTimelineMode(): boolean {
    return this.mode === 'timeline';
  }
  
  exitTimelineMode(): void {
    BrowserPrint('INFO', 'Exiting timeline mode');
    
    this.mode = 'live';
    this.timelineSnapshot = null;
    
    // Publish exit event
    this.messageBus.publish('timeline:mode', false);
    this.messageBus.publish('timeline:live_mode', true);
    
    // Show user feedback
    this.messageBus.publish('ui:show_toast', {
      message: 'Returned to live mode',
      type: 'info'
    });
  }
  
  // Get current register content (for components that need it)
  getRegisterContent(registerId: number): string {
    const register = this.registers.find(r => r.id === registerId);
    return register?.content || '';
  }
  
  // Update register content (from live collaboration)
  updateRegisterContent(registerId: number, content: string): void {
    if (this.mode === 'timeline') {
      // Don't update during timeline mode unless it's a timeline update
      return;
    }
    
    const register = this.registers.find(r => r.id === registerId);
    if (register) {
      register.content = content;
      BrowserPrint('DEBUG', `Live update applied to register ${registerId}`);
    }
  }
  
  // Get all register states
  getAllRegisters(): RegisterState[] {
    return [...this.registers];
  }
  
  // Get current mode
  getCurrentMode(): 'live' | 'timeline' {
    return this.mode;
  }
  
  // Get timeline snapshot if available
  getTimelineSnapshot(): RegisterState[] | null {
    return this.timelineSnapshot ? [...this.timelineSnapshot] : null;
  }
}