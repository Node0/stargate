import { inject } from 'aurelia';
import { MessageBusService } from '../services/message-bus.service';
import { BrowserPrint } from '../browser-logger';

export interface NavigationState {
  currentEventIndex: number;
  totalEvents: number;
  canGoBack: boolean;
  canGoForward: boolean;
  currentEvent?: any;
  eventSequence: any[];
}

@inject(MessageBusService)
export class QuantumNavigator {
  private currentEventIndex: number = 0;
  private eventSequence: any[] = [];
  private canGoBack: boolean = false;
  private canGoForward: boolean = false;
  private isTimelineMode: boolean = false;
  private currentEvent: any = null;
  
  // Bindable properties for the view
  public navigationState: NavigationState = {
    currentEventIndex: 0,
    totalEvents: 0,
    canGoBack: false,
    canGoForward: false,
    eventSequence: []
  };
  
  constructor(private messageBus: MessageBusService) {}
  
  attached(): void {
    BrowserPrint('INFO', 'QuantumNavigator attached');
    
    // Subscribe to event sequences from day scrubber or timemap
    this.messageBus.subscribe('timeline:event_sequence', (events) => {
      this.eventSequence = events;
      this.currentEventIndex = events.length - 1; // Start at latest event
      this.updateButtonStates();
      this.updateNavigationState();
      BrowserPrint('DEBUG', `QuantumNavigator loaded ${events.length} events`);
    });
    
    // Subscribe to position updates from day scrubber
    this.messageBus.subscribe('timeline:position', (index) => {
      this.currentEventIndex = index;
      this.updateButtonStates();
      this.updateNavigationState();
      BrowserPrint('DEBUG', `QuantumNavigator position updated to ${index}`);
    });
    
    // Subscribe to timeline mode changes
    this.messageBus.subscribe('timeline:mode', (enabled) => {
      this.isTimelineMode = enabled;
      BrowserPrint('DEBUG', `QuantumNavigator timeline mode: ${enabled}`);
    });
    
    // Subscribe to state reconstruction requests
    this.messageBus.subscribe('timeline:reconstruct_state', (timestamp) => {
      this.reconstructStateAtTimestamp(timestamp);
    });
  }
  
  detached(): void {
    BrowserPrint('INFO', 'QuantumNavigator detached');
    // MessageBus handles cleanup automatically
  }
  
  // Navigation methods
  stepBack(): void {
    if (this.canGoBack && this.currentEventIndex > 0) {
      this.currentEventIndex--;
      this.applyCurrentEvent();
      this.updateButtonStates();
      this.updateNavigationState();
      BrowserPrint('DEBUG', `QuantumNavigator stepped back to event ${this.currentEventIndex}`);
    }
  }
  
  stepForward(): void {
    if (this.canGoForward && this.currentEventIndex < this.eventSequence.length - 1) {
      this.currentEventIndex++;
      this.applyCurrentEvent();
      this.updateButtonStates();
      this.updateNavigationState();
      BrowserPrint('DEBUG', `QuantumNavigator stepped forward to event ${this.currentEventIndex}`);
    }
  }
  
  goToFirst(): void {
    if (this.eventSequence.length > 0) {
      this.currentEventIndex = 0;
      this.applyCurrentEvent();
      this.updateButtonStates();
      this.updateNavigationState();
      BrowserPrint('DEBUG', 'QuantumNavigator jumped to first event');
    }
  }
  
  goToLast(): void {
    if (this.eventSequence.length > 0) {
      this.currentEventIndex = this.eventSequence.length - 1;
      this.applyCurrentEvent();
      this.updateButtonStates();
      this.updateNavigationState();
      BrowserPrint('DEBUG', 'QuantumNavigator jumped to last event');
    }
  }
  
  jumpToEvent(eventIndex: number): void {
    if (eventIndex >= 0 && eventIndex < this.eventSequence.length) {
      this.currentEventIndex = eventIndex;
      this.applyCurrentEvent();
      this.updateButtonStates();
      this.updateNavigationState();
      BrowserPrint('DEBUG', `QuantumNavigator jumped to event ${eventIndex}`);
    }
  }
  
  // Apply current event to the system
  private applyCurrentEvent(): void {
    if (this.currentEventIndex < 0 || this.currentEventIndex >= this.eventSequence.length) {
      return;\n    }\n    \n    const event = this.eventSequence[this.currentEventIndex];\n    this.currentEvent = event;\n    \n    // Determine which registers changed\n    const previousEvent = this.currentEventIndex > 0 ? \n      this.eventSequence[this.currentEventIndex - 1] : null;\n    \n    const changedRegisters = this.detectChanges(previousEvent, event);\n    \n    // Apply state and highlight changes\n    this.messageBus.publish('timeline:apply_state', {\n      event,\n      changedRegisters,\n      eventIndex: this.currentEventIndex,\n      timestamp: event.timestamp\n    });\n  }\n  \n  // Detect which registers changed between events\n  private detectChanges(prevEvent: any, currentEvent: any): number[] {\n    const changedRegisters: number[] = [];\n    \n    if (!prevEvent) {\n      // First event - all registers that have content are \"changed\"\n      if (currentEvent.event_type === 'text_change') {\n        const registerId = parseInt(currentEvent.entity_id.replace('register', ''));\n        changedRegisters.push(registerId);\n      }\n      return changedRegisters;\n    }\n    \n    // Compare event types and entities\n    if (currentEvent.event_type === 'text_change') {\n      const registerId = parseInt(currentEvent.entity_id.replace('register', ''));\n      \n      // Check if this register's content actually changed\n      if (prevEvent.event_type !== 'text_change' || \n          prevEvent.entity_id !== currentEvent.entity_id ||\n          prevEvent.payload.content !== currentEvent.payload.content) {\n        changedRegisters.push(registerId);\n      }\n    }\n    \n    return changedRegisters;\n  }\n  \n  // Update navigation button states\n  private updateButtonStates(): void {\n    this.canGoBack = this.currentEventIndex > 0;\n    this.canGoForward = this.currentEventIndex < this.eventSequence.length - 1;\n  }\n  \n  // Update navigation state for binding\n  private updateNavigationState(): void {\n    this.navigationState = {\n      currentEventIndex: this.currentEventIndex,\n      totalEvents: this.eventSequence.length,\n      canGoBack: this.canGoBack,\n      canGoForward: this.canGoForward,\n      currentEvent: this.currentEvent,\n      eventSequence: this.eventSequence\n    };\n  }\n  \n  // Reconstruct state at specific timestamp\n  private reconstructStateAtTimestamp(timestamp: number): void {\n    // Find the event closest to this timestamp\n    let closestIndex = 0;\n    let closestDiff = Math.abs(this.eventSequence[0]?.timestamp - timestamp);\n    \n    for (let i = 1; i < this.eventSequence.length; i++) {\n      const diff = Math.abs(this.eventSequence[i].timestamp - timestamp);\n      if (diff < closestDiff) {\n        closestDiff = diff;\n        closestIndex = i;\n      }\n    }\n    \n    this.jumpToEvent(closestIndex);\n  }\n  \n  // Public API for external control\n  public setEventSequence(events: any[]): void {\n    this.eventSequence = events;\n    this.currentEventIndex = events.length - 1;\n    this.updateButtonStates();\n    this.updateNavigationState();\n  }\n  \n  public getCurrentEvent(): any {\n    return this.currentEvent;\n  }\n  \n  public getCurrentIndex(): number {\n    return this.currentEventIndex;\n  }\n  \n  public getEventSequence(): any[] {\n    return this.eventSequence;\n  }\n  \n  // Check if timeline mode is active\n  public get timelineMode(): boolean {\n    return this.isTimelineMode;\n  }\n  \n  // Format event for display\n  public formatEvent(event: any): string {\n    if (!event) return 'No event';\n    \n    const date = new Date(event.timestamp).toLocaleString();\n    const entityId = event.entity_id || 'unknown';\n    \n    switch (event.event_type) {\n      case 'text_change':\n        const registerId = entityId.replace('register', '');\n        return `Register ${registerId} changed (${date})`;\n      case 'file_upload':\n        return `File uploaded: ${event.payload.filename || 'unknown'} (${date})`;\n      case 'file_delete':\n        return `File deleted: ${event.payload.filename || 'unknown'} (${date})`;\n      default:\n        return `${event.event_type} on ${entityId} (${date})`;\n    }\n  }\n  \n  // Get event summary for UI\n  public getEventSummary(): string {\n    if (this.eventSequence.length === 0) {\n      return 'No events';\n    }\n    \n    return `Event ${this.currentEventIndex + 1} of ${this.eventSequence.length}`;\n  }\n}