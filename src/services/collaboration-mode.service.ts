import { singleton } from 'aurelia';

export interface CollaborationMode {
  type: 'immediate' | 'deferred';
  showActivityIndicators: boolean;
  autoAdvanceOnIdle: boolean;
  preserveSelection: boolean;
  preserveScroll: boolean;
}

export interface TextUpdate {
  content: string;
  timestamp: number;
  clientId: string;
  operation?: 'insert' | 'delete' | 'replace';
  position?: {
    start: number;
    end: number;
  };
  metadata?: {
    userAction?: 'typing' | 'paste' | 'cut' | 'undo' | 'redo';
    preserveSelection?: boolean;
    preserveScroll?: boolean;
  };
}

export interface RegisterActivity {
  registerId: number;
  userId: string;
  userName: string;
  activity: 'viewing' | 'selecting' | 'copying' | 'typing' | 'idle';
  timestamp: number;
  selection?: { start: number; end: number };
}

@singleton
export class CollaborationModeService {
  private mode: CollaborationMode = {
    type: 'deferred', // Default to non-disruptive
    showActivityIndicators: true,
    autoAdvanceOnIdle: false,
    preserveSelection: true,
    preserveScroll: true
  };
  
  private pendingUpdates = new Map<number, TextUpdate[]>();
  private subscribers = new Set<(mode: CollaborationMode) => void>();
  private activityTracking = new Map<string, RegisterActivity>();
  
  constructor() {
    // Load saved preferences
    const saved = localStorage.getItem('collaboration-mode');
    if (saved) {
      try {
        this.mode = { ...this.mode, ...JSON.parse(saved) };
      } catch (error) {
        console.warn('Failed to load collaboration mode from localStorage:', error);
      }
    }
  }
  
  getMode(): CollaborationMode {
    return this.mode;
  }
  
  setMode(mode: Partial<CollaborationMode>): void {
    this.mode = { ...this.mode, ...mode };
    localStorage.setItem('collaboration-mode', JSON.stringify(this.mode));
    this.notifySubscribers();
  }
  
  subscribe(callback: (mode: CollaborationMode) => void): () => void {
    this.subscribers.add(callback);
    callback(this.mode); // Initial call
    return () => this.subscribers.delete(callback);
  }
  
  private notifySubscribers(): void {
    this.subscribers.forEach(cb => cb(this.mode));
  }
  
  addPendingUpdate(registerId: number, update: TextUpdate): void {
    if (!this.pendingUpdates.has(registerId)) {
      this.pendingUpdates.set(registerId, []);
    }
    this.pendingUpdates.get(registerId)!.push(update);
  }
  
  getPendingUpdates(registerId: number): TextUpdate[] {
    return this.pendingUpdates.get(registerId) || [];
  }
  
  clearPendingUpdates(registerId: number): void {
    this.pendingUpdates.delete(registerId);
  }
  
  hasPendingUpdates(registerId: number): boolean {
    return this.pendingUpdates.has(registerId) && this.pendingUpdates.get(registerId)!.length > 0;
  }
  
  // Activity tracking methods
  trackActivity(activity: RegisterActivity): void {
    const key = `${activity.registerId}-${activity.userId}`;
    this.activityTracking.set(key, activity);
    
    // Clean up old activity entries (older than 30 seconds)
    const cutoff = Date.now() - 30000;
    for (const [activityKey, activityData] of this.activityTracking.entries()) {
      if (activityData.timestamp < cutoff) {
        this.activityTracking.delete(activityKey);
      }
    }
  }
  
  getActivityForRegister(registerId: number): RegisterActivity[] {
    return Array.from(this.activityTracking.values())
      .filter(activity => activity.registerId === registerId)
      .sort((a, b) => b.timestamp - a.timestamp);
  }
  
  // Utility methods for mode switching
  switchToImmediate(): void {
    this.setMode({ type: 'immediate' });
  }
  
  switchToDeferred(): void {
    this.setMode({ type: 'deferred' });
  }
  
  toggleMode(): void {
    const newType = this.mode.type === 'immediate' ? 'deferred' : 'immediate';
    this.setMode({ type: newType });
  }
  
  // Apply pending updates for a register
  applyPendingUpdates(registerId: number): TextUpdate[] {
    const updates = this.getPendingUpdates(registerId);
    this.clearPendingUpdates(registerId);
    return updates;
  }
  
  // Get the latest update for a register
  getLatestUpdate(registerId: number): TextUpdate | null {
    const updates = this.getPendingUpdates(registerId);
    return updates.length > 0 ? updates[updates.length - 1] : null;
  }
  
  // Merge multiple updates for a register
  mergeUpdates(registerId: number): TextUpdate | null {
    const updates = this.getPendingUpdates(registerId);
    if (updates.length === 0) return null;
    
    // Return the most recent update (simple strategy)
    // In a more sophisticated implementation, you might merge the content
    return updates[updates.length - 1];
  }
}