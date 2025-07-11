import { inject } from 'aurelia';
import { MessageBusService } from './message-bus.service';
import { CollaborationService } from './collaboration.service';
import { BrowserPrint } from '../browser-logger';

export interface TimelineState {
  registers: { id: number; content: string }[];
  timestamp: number;
  eventId?: number;
}

@inject(MessageBusService, CollaborationService)
export class TimelineService {
  private isTimelineMode: boolean = false;
  private currentTimelineState: TimelineState | null = null;
  
  constructor(
    private messageBus: MessageBusService,
    private collaboration: CollaborationService
  ) {
    this.setupEventHandlers();
  }
  
  private setupEventHandlers(): void {
    // Listen for timeline events from DayScrubber
    this.messageBus.subscribe('timeline:apply_event', (data) => {
      this.handleTimelineEvent(data);
    });
    
    // Listen for state reconstruction requests
    this.messageBus.subscribe('timeline:apply_state', (data) => {
      this.handleStateApplication(data);
    });
    
    // Listen for timeline mode changes
    this.messageBus.subscribe('timeline:mode', (enabled) => {
      this.isTimelineMode = enabled;
      BrowserPrint('INFO', `Timeline mode ${enabled ? 'enabled' : 'disabled'}`);
    });
  }
  
  private handleTimelineEvent(data: any): void {
    const { eventId, event, timestamp } = data;
    
    BrowserPrint('DEBUG', `Timeline service applying event ${eventId} at ${new Date(timestamp).toISOString()}`);
    
    // Request state reconstruction from server
    this.requestStateReconstruction(eventId, timestamp);
  }
  
  private handleStateApplication(data: any): void {
    const { event, changedRegisters, eventIndex, timestamp } = data;
    
    BrowserPrint('DEBUG', `Timeline service applying state from QuantumNavigator`);
    
    // Apply the event state directly
    this.applyEventToRegisters(event);
  }
  
  private requestStateReconstruction(eventId: number, timestamp: number): void {
    if (!this.collaboration.isConnected()) {
      BrowserPrint('WARNING', 'Cannot request state reconstruction: not connected');
      return;
    }
    
    // Send state reconstruction request to server
    const message = {
      type: 'timeline_request',
      action: 'reconstruct_state',
      req: btoa(JSON.stringify({ 
        success: true, 
        body: { eventId, timestamp } 
      }))
    };
    
    this.collaboration.sendMessage(message);
  }
  
  private applyEventToRegisters(event: any): void {
    if (!event) return;
    
    try {
      // Extract register information from event
      if (event.event_type === 'text_change') {
        const registerMatch = event.entity_id.match(/register(\d+)/);
        if (registerMatch) {
          const registerId = parseInt(registerMatch[1]);
          const content = event.payload?.content || '';
          
          BrowserPrint('DEBUG', `Applying text change to register ${registerId}: ${content.substring(0, 50)}...`);
          
          // Publish register update
          this.messageBus.publish('timeline:register_update', {
            registerId,
            content,
            timestamp: event.timestamp
          });
        }
      }
    } catch (error) {
      BrowserPrint('ERROR', `Failed to apply event to registers: ${(error as Error).message}`);
    }
  }
  
  // Enable timeline mode
  enableTimelineMode(): void {
    this.isTimelineMode = true;
    this.messageBus.publish('timeline:mode', true);
  }
  
  // Disable timeline mode
  disableTimelineMode(): void {
    this.isTimelineMode = false;
    this.messageBus.publish('timeline:mode', false);
    
    // Return to live state
    this.returnToLiveState();
  }
  
  // Return to live collaboration state
  private returnToLiveState(): void {
    BrowserPrint('INFO', 'Returning to live collaboration state');
    this.currentTimelineState = null;
    
    // Notify components to return to live mode
    this.messageBus.publish('timeline:live_mode', true);
  }
  
  // Check if in timeline mode
  isInTimelineMode(): boolean {
    return this.isTimelineMode;
  }
  
  // Get current timeline state
  getCurrentState(): TimelineState | null {
    return this.currentTimelineState;
  }
  
  // Apply a full system state (from StateReconstructor)
  applySystemState(state: any): void {
    BrowserPrint('DEBUG', `Applying full system state with ${state.registers?.length || 0} registers`);
    
    this.currentTimelineState = {
      registers: state.registers || [],
      timestamp: state.timestamp || Date.now(),
      eventId: state.eventId
    };
    
    // Apply each register state
    state.registers?.forEach((register: any) => {
      this.messageBus.publish('timeline:register_update', {
        registerId: register.id,
        content: register.content,
        timestamp: state.timestamp
      });
    });
  }
}