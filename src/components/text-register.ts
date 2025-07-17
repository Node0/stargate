import { BrowserPrint } from '../browser-logger';
import { CollaborationService } from '../services/collaboration.service';
import { CollaborationModeService, CollaborationMode, TextUpdate, RegisterActivity } from '../services/collaboration-mode.service';
import { MessageBusService } from '../services/message-bus.service';
import { AppStateService } from '../services/app-state.service';
import { inject } from 'aurelia';

@inject(CollaborationService, CollaborationModeService, MessageBusService, AppStateService)
export class TextRegister {
  static readonly bindables = ['registerId', 'content'];
  registerId: number = 1;
  content: string = '';
  
  private unsubscribe?: () => void;
  private modeUnsubscribe?: () => void;
  private timelineUnsubscribe?: () => void;
  private isUpdatingFromRemote: boolean = false;
  private isUpdatingFromTimeline: boolean = false;
  private textarea?: HTMLTextAreaElement;
  
  // Deferred mode properties
  private collaborationMode: CollaborationMode;
  private hasPendingUpdates: boolean = false;
  private savedSelection: { start: number; end: number } | null = null;
  private savedScroll: number = 0;
  private activityTimer?: NodeJS.Timeout;
  
  // Use constructor injection instead of resolve()
  constructor(
    private collaboration: CollaborationService,
    private collaborationModeService: CollaborationModeService,
    private messageBus: MessageBusService,
    private appState: AppStateService
  ) {
    this.collaborationMode = this.collaborationModeService.getMode();
  }
  
  attached(): void {
    BrowserPrint('INFO', `Text register ${this.registerId} attached`);
    
    // Get textarea element for advanced functionality
    this.textarea = document.querySelector(`[data-register-id="${this.registerId}"]`) as HTMLTextAreaElement;
    
    // Add focus/blur handlers for responsive layout
    this.setupResponsiveFocus();
    
    // Subscribe to collaboration mode changes
    this.modeUnsubscribe = this.collaborationModeService.subscribe((mode) => {
      this.collaborationMode = mode;
      BrowserPrint('DEBUG', `Register ${this.registerId} mode changed to: ${mode.type}`);
    });
    
    // Set up activity tracking
    this.setupActivityTracking();
    
    // Subscribe to timeline register updates
    this.timelineUnsubscribe = this.messageBus.subscribe('timeline:register_update', (updateData) => {
      if (updateData.registerId === this.registerId && updateData.fromTimeline) {
        this.isUpdatingFromTimeline = true;
        this.content = updateData.content;
        this.isUpdatingFromTimeline = false;
        BrowserPrint('DEBUG', `Register ${this.registerId} updated from timeline`);
      }
    });
    
    // Service is already injected and available
    this.unsubscribe = this.collaboration.subscribeToRegister(
      this.registerId,
      (remoteContent, metadata) => {
        if (remoteContent !== this.content) {
          BrowserPrint('DEBUG', `Register ${this.registerId} updated from remote: ${remoteContent.length} chars`);
          
          if (this.collaborationMode.type === 'immediate') {
            // Immediate mode: apply changes right away
            this.applyRemoteUpdate(remoteContent);
          } else {
            // Deferred mode: queue the update
            this.handleDeferredUpdate(remoteContent, metadata);
          }
        }
      }
    );
  }
  
  detached(): void {
    BrowserPrint('INFO', `Text register ${this.registerId} detached`);
    this.unsubscribe?.();
    this.modeUnsubscribe?.();
    this.timelineUnsubscribe?.();
    if (this.activityTimer) {
      clearTimeout(this.activityTimer);
    }
  }
  
  contentChanged(newValue: string, oldValue: string): void {
    // Skip initial binding and remote updates
    if (oldValue === undefined || this.isUpdatingFromRemote || this.isUpdatingFromTimeline) return;
    
    // Check if we're in timeline mode
    if (this.appState.isTimelineMode()) {
      BrowserPrint('DEBUG', `Register ${this.registerId} change blocked - in timeline mode`);
      return;
    }
    
    BrowserPrint('DEBUG', `Register ${this.registerId} local change: ${newValue.length} chars`);
    this.collaboration.syncRegister(this.registerId, newValue);
    
    // Track typing activity
    this.broadcastActivity('typing');
  }
  
  // Handle textarea focus to exit timeline mode
  handleTextareaFocus(): void {
    if (this.appState.isTimelineMode()) {
      BrowserPrint('INFO', `Register ${this.registerId} focused - exiting timeline mode`);
      
      // Exit timeline mode when user clicks on a register
      this.appState.exitTimelineMode();
    }
  }
  
  // Set up activity tracking for deferred mode
  private setupActivityTracking(): void {
    if (!this.textarea) return;
    
    // Track selection changes
    this.textarea.addEventListener('select', () => {
      this.broadcastActivity('selecting');
    });
    
    // Track copy events
    this.textarea.addEventListener('copy', () => {
      this.broadcastActivity('copying');
    });
    
    // Track when user is viewing (focus)
    this.textarea.addEventListener('focus', () => {
      this.broadcastActivity('viewing');
    });
    
    // Track idle state
    this.textarea.addEventListener('blur', () => {
      this.broadcastActivity('idle');
    });
  }
  
  // Broadcast user activity
  private broadcastActivity(activity: RegisterActivity['activity']): void {
    if (!this.collaborationMode.showActivityIndicators) return;
    
    const activityData: RegisterActivity = {
      registerId: this.registerId,
      userId: 'current-user', // TODO: Get actual user ID
      userName: 'Current User', // TODO: Get actual user name
      activity,
      timestamp: Date.now(),
      selection: this.getSelection()
    };
    
    this.collaborationModeService.trackActivity(activityData);
  }
  
  // Apply remote update immediately
  private applyRemoteUpdate(remoteContent: string): void {
    this.isUpdatingFromRemote = true;
    this.content = remoteContent;
    this.isUpdatingFromRemote = false;
  }
  
  // Handle deferred updates
  private handleDeferredUpdate(remoteContent: string, metadata: any): void {
    // Save current user state if configured
    if (this.collaborationMode.preserveSelection) {
      this.savedSelection = this.getSelection();
    }
    if (this.collaborationMode.preserveScroll && this.textarea) {
      this.savedScroll = this.textarea.scrollTop;
    }
    
    // Create update object
    const update: TextUpdate = {
      content: remoteContent,
      timestamp: Date.now(),
      clientId: metadata?.clientId || 'unknown',
      metadata: {
        preserveSelection: this.collaborationMode.preserveSelection,
        preserveScroll: this.collaborationMode.preserveScroll
      }
    };
    
    // Add to pending updates
    this.collaborationModeService.addPendingUpdate(this.registerId, update);
    this.hasPendingUpdates = true;
    
    BrowserPrint('DEBUG', `Register ${this.registerId} deferred update queued`);
    
    // Auto-advance if configured and user is idle
    if (this.collaborationMode.autoAdvanceOnIdle) {
      this.scheduleAutoAdvance();
    }
  }
  
  // Schedule auto-advance for idle users
  private scheduleAutoAdvance(): void {
    if (this.activityTimer) {
      clearTimeout(this.activityTimer);
    }
    
    this.activityTimer = setTimeout(() => {
      if (this.hasPendingUpdates) {
        this.applyPendingUpdates();
      }
    }, 5000); // 5 second delay
  }
  
  // Apply all pending updates
  public applyPendingUpdates(): void {
    if (!this.hasPendingUpdates) return;
    
    const updates = this.collaborationModeService.applyPendingUpdates(this.registerId);
    if (updates.length === 0) return;
    
    // Apply the latest update
    const latestUpdate = updates[updates.length - 1];
    this.isUpdatingFromRemote = true;
    this.content = latestUpdate.content;
    this.isUpdatingFromRemote = false;
    
    // Restore user state if configured
    if (latestUpdate.metadata?.preserveSelection && this.savedSelection) {
      this.restoreSelection(this.savedSelection);
    }
    if (latestUpdate.metadata?.preserveScroll && this.textarea) {
      this.textarea.scrollTop = this.savedScroll;
    }
    
    this.hasPendingUpdates = false;
    BrowserPrint('DEBUG', `Register ${this.registerId} applied ${updates.length} pending updates`);
  }
  
  // Get current selection
  private getSelection(): { start: number; end: number } | null {
    if (!this.textarea) return null;
    
    return {
      start: this.textarea.selectionStart,
      end: this.textarea.selectionEnd
    };
  }
  
  // Restore selection
  private restoreSelection(selection: { start: number; end: number }): void {
    if (!this.textarea) return;
    
    // Use setTimeout to ensure DOM is updated
    setTimeout(() => {
      this.textarea!.setSelectionRange(selection.start, selection.end);
    }, 0);
  }
  
  // Public API for mode switching
  public switchToImmediate(): void {
    this.collaborationModeService.switchToImmediate();
  }
  
  public switchToDeferred(): void {
    this.collaborationModeService.switchToDeferred();
  }
  
  public toggleMode(): void {
    this.collaborationModeService.toggleMode();
  }
  
  // Check if there are pending updates
  public get hasPendingChanges(): boolean {
    return this.hasPendingUpdates;
  }
  
  // Get activity indicators for this register
  public getActivityIndicators(): RegisterActivity[] {
    return this.collaborationModeService.getActivityForRegister(this.registerId);
  }
  
  // Setup responsive focus behavior for horizontal expansion
  private setupResponsiveFocus(): void {
    if (!this.textarea) return;
    
    const container = this.textarea.closest('.textarea-container');
    const registerContainer = container?.closest('.register-container');
    
    if (!container || !registerContainer) return;
    
    // Focus handler
    this.textarea.addEventListener('focus', () => {
      // Remove focused class from all containers
      document.querySelectorAll('.textarea-container').forEach(el => {
        el.classList.remove('focused');
      });
      document.querySelectorAll('.register-container').forEach(el => {
        el.classList.remove('has-focus');
      });
      
      // Add focused class to current container
      container.classList.add('focused');
      registerContainer.classList.add('has-focus');
      
      BrowserPrint('DEBUG', `Register ${this.registerId} focused - horizontal expansion enabled`);
    });
    
    // Blur handler with delay to check if focus moved to another textarea
    this.textarea.addEventListener('blur', () => {
      setTimeout(() => {
        // Check if any textarea still has focus
        const anyFocused = document.querySelector('textarea:focus');
        if (!anyFocused) {
          // No textarea has focus, remove all focus classes
          document.querySelectorAll('.register-container').forEach(el => {
            el.classList.remove('has-focus');
          });
          document.querySelectorAll('.textarea-container').forEach(el => {
            el.classList.remove('focused');
          });
          
          BrowserPrint('DEBUG', `All registers blurred - horizontal expansion disabled`);
        }
      }, 100); // Small delay to allow focus to move
    });
  }
}