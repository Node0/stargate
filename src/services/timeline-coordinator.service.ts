import { inject, singleton } from 'aurelia';
import { MessageBusService } from './message-bus.service';
import { CollaborationService } from './collaboration.service';
import { BrowserPrint } from '../browser-logger';

export interface TimelineCoordinatorState {
  mode: 'live' | 'timeline';
  currentTimestamp?: number;
  currentEventId?: number;
  selectedDay?: string;
  searchResultContext?: any;
  navigationPosition?: number;
}

/**
 * Central coordinator service for timeline-based navigation and state management.
 * Handles events from:
 * - TimeMap day selection
 * - DayScrubber timeline navigation  
 * - QuantumNavigator back/forward buttons
 * - MiniSearch result selection
 * - State reconstruction requests
 */
@singleton
@inject(MessageBusService, CollaborationService)
export class TimelineCoordinatorService {
  private state: TimelineCoordinatorState = {
    mode: 'live'
  };
  
  private eventSequence: any[] = [];
  private currentEventIndex: number = -1;
  
  constructor(
    private messageBus: MessageBusService,
    private collaboration: CollaborationService
  ) {
    this.setupEventHandlers();
    BrowserPrint('INFO', 'TimelineCoordinatorService initialized');
  }
  
  private setupEventHandlers(): void {
    // === TimeMap Events ===
    this.messageBus.subscribe('timemap:day_selected', (dayData) => {
      this.handleDaySelection(dayData);
    });
    
    // === DayScrubber Events ===
    this.messageBus.subscribe('timeline:apply_event', (eventData) => {
      this.handleTimelineEvent(eventData);
    });
    
    // === QuantumNavigator Events ===
    this.messageBus.subscribe('timeline:apply_state', (stateData) => {
      this.handleStateApplication(stateData);
    });
    
    // === Search Events ===
    this.messageBus.subscribe('search:result_selected', (searchData) => {
      this.handleSearchResultSelection(searchData);
    });
    
    // === Server Response Events ===
    this.messageBus.subscribe('timeline_response', (response) => {
      this.handleServerResponse(response);
    });
    
    BrowserPrint('DEBUG', 'Timeline coordinator event handlers set up');
  }
  
  // === Event Handlers ===
  
  private handleDaySelection(dayData: any): void {
    BrowserPrint('INFO', `Timeline coordinator: Day selected - ${dayData.date}`);
    
    this.state = {
      ...this.state,
      mode: 'timeline',
      selectedDay: dayData.date
    };
    
    // Store event sequence for this day
    this.eventSequence = dayData.events || [];
    this.currentEventIndex = this.eventSequence.length - 1; // Start at latest
    
    // Enable timeline mode
    this.messageBus.publish('timeline:mode', true);
    this.messageBus.publish('timeline:event_sequence', this.eventSequence);
    
    // Show quantum navigator
    this.messageBus.publish('quantum:show', true);
    
    BrowserPrint('DEBUG', `Event sequence loaded: ${this.eventSequence.length} events`);
  }
  
  private handleTimelineEvent(eventData: any): void {
    const { eventId, event, timestamp } = eventData;
    
    BrowserPrint('DEBUG', `Timeline coordinator: Applying event ${eventId}`);
    
    this.state = {
      ...this.state,
      currentTimestamp: timestamp,
      currentEventId: eventId
    };
    
    // Find position in event sequence
    const eventIndex = this.eventSequence.findIndex(e => e.id === eventId);
    if (eventIndex >= 0) {
      this.currentEventIndex = eventIndex;
      this.messageBus.publish('timeline:position', eventIndex);
    }
    
    // Request state reconstruction from server
    this.requestStateReconstruction(timestamp, eventId);
  }
  
  private handleStateApplication(stateData: any): void {
    const { event, changedRegisters, eventIndex } = stateData;
    
    BrowserPrint('DEBUG', `Timeline coordinator: Applying state from navigation`);
    
    if (eventIndex !== undefined) {
      this.currentEventIndex = eventIndex;
    }
    
    // Apply the event directly to application state
    this.applyEventToApplicationState(event);
  }
  
  private handleSearchResultSelection(searchData: any): void {
    BrowserPrint('INFO', `Timeline coordinator: Search result selected`);
    
    const { timestamp, eventId, context } = searchData;
    
    this.state = {
      ...this.state,
      mode: 'timeline',
      currentTimestamp: timestamp,
      currentEventId: eventId,
      searchResultContext: context
    };
    
    // Request state reconstruction
    this.requestStateReconstruction(timestamp, eventId);
  }
  
  private handleServerResponse(response: any): void {
    const { action, data } = response;
    
    switch (action) {
      case 'state_reconstructed':
        this.applyReconstructedState(data);
        break;
      case 'timeline_data':
        this.updateTimelineData(data);
        break;
      default:
        BrowserPrint('DEBUG', `Unknown timeline response action: ${action}`);
    }
  }
  
  // === State Application Methods ===
  
  private requestStateReconstruction(timestamp: number, eventId?: number): void {
    if (!this.collaboration.isConnected()) {
      BrowserPrint('WARNING', 'Cannot request state reconstruction: not connected');
      return;
    }
    
    BrowserPrint('DEBUG', `Requesting state reconstruction for timestamp ${timestamp}`);
    
    const message = {
      type: 'timeline_request',
      action: 'reconstruct_state',
      req: btoa(JSON.stringify({ 
        success: true, 
        body: { timestamp, eventId } 
      }))
    };
    
    this.collaboration.sendMessage(message);
  }
  
  private applyEventToApplicationState(event: any): void {
    if (!event) return;
    
    try {
      if (event.event_type === 'text_change') {
        const registerMatch = event.entity_id.match(/register(\d+)/);
        if (registerMatch) {
          const registerId = parseInt(registerMatch[1]);
          const content = event.payload?.content || '';
          
          BrowserPrint('DEBUG', `Applying to register ${registerId}: "${content.substring(0, 30)}..."`);
          
          // Publish register update for components to receive
          this.messageBus.publish('timeline:register_update', {
            registerId,
            content,
            fromTimeline: true
          });
        }
      }
    } catch (error) {
      BrowserPrint('ERROR', `Failed to apply event to application state: ${(error as Error).message}`);
    }
  }
  
  private applyReconstructedState(stateData: any): void {
    BrowserPrint('INFO', `Applying reconstructed state with ${stateData.registers?.length || 0} registers`);
    
    // Apply each register state
    stateData.registers?.forEach((register: any) => {
      this.messageBus.publish('timeline:register_update', {
        registerId: register.id,
        content: register.content,
        fromTimeline: true
      });
    });
    
    // Apply file state if needed
    if (stateData.files) {
      this.messageBus.publish('timeline:files_update', {
        files: stateData.files,
        fromTimeline: true
      });
    }
  }
  
  private updateTimelineData(data: any): void {
    // Update event sequence if provided
    if (data.events) {
      this.eventSequence = data.events;
      this.messageBus.publish('timeline:event_sequence', this.eventSequence);
    }
  }
  
  // === Public API ===
  
  public getState(): TimelineCoordinatorState {
    return { ...this.state };
  }
  
  public isInTimelineMode(): boolean {
    return this.state.mode === 'timeline';
  }
  
  public exitTimelineMode(): void {
    BrowserPrint('INFO', 'Exiting timeline mode, returning to live collaboration');
    
    this.state = {
      mode: 'live'
    };
    
    this.eventSequence = [];
    this.currentEventIndex = -1;
    
    // Disable timeline mode
    this.messageBus.publish('timeline:mode', false);
    this.messageBus.publish('quantum:show', false);
    
    // Return to live mode
    this.messageBus.publish('timeline:live_mode', true);
  }
  
  public navigateToEvent(direction: 'previous' | 'next'): void {
    if (this.eventSequence.length === 0) return;
    
    const newIndex = direction === 'previous' 
      ? Math.max(0, this.currentEventIndex - 1)
      : Math.min(this.eventSequence.length - 1, this.currentEventIndex + 1);
    
    if (newIndex !== this.currentEventIndex) {
      this.currentEventIndex = newIndex;
      const event = this.eventSequence[newIndex];
      
      BrowserPrint('DEBUG', `Navigating ${direction} to event ${newIndex}: ${event.event_type}`);
      
      this.messageBus.publish('timeline:position', newIndex);
      this.applyEventToApplicationState(event);
    }
  }
  
  public jumpToEvent(eventIndex: number): void {
    if (eventIndex >= 0 && eventIndex < this.eventSequence.length) {
      this.currentEventIndex = eventIndex;
      const event = this.eventSequence[eventIndex];
      
      BrowserPrint('DEBUG', `Jumping to event ${eventIndex}: ${event.event_type}`);
      
      this.messageBus.publish('timeline:position', eventIndex);
      this.applyEventToApplicationState(event);
    }
  }
  
  public getCurrentEventIndex(): number {
    return this.currentEventIndex;
  }
  
  public getEventSequence(): any[] {
    return [...this.eventSequence];
  }
}