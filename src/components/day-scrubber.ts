import { inject } from 'aurelia';
import { MessageBusService } from '../services/message-bus.service';
import { BrowserPrint } from '../browser-logger';

export interface HourMarker {
  hour: number;
  eventCount: number;
  percentage: number;
}

export interface DayEvents {
  date: string;
  events: any[];
  hourlyDistribution: { [hour: number]: number };
}

@inject(MessageBusService)
export class DayScrubber {
  private currentDay: string = '';
  private dayEvents: any[] = [];
  private currentMinute: number = 0; // 0-1439 (minute of day)
  private scrubberPosition: number = 0; // 0-100 percentage for UI display
  private hourMarkers: HourMarker[] = [];
  private isDragging: boolean = false;
  private isVisible: boolean = false;
  private isDetached: boolean = false;
  private setupRetryCount: number = 0;
  private maxSetupRetries: number = 10;
  private queryCache: Map<number, any> = new Map(); // Cache minute -> state
  
  // Event blocks
  private eventBlocks: Array<{
    minutePosition: number;  // 0-1439
    duration: number;        // width in minutes
    intensity: string;
    timestamp: number;
    eventType: string;
  }> = [];
  
  // DOM elements
  private scrubberTrack?: HTMLElement;
  private scrubberHandle?: HTMLElement;
  
  // Component lifecycle
  private unsubscribeDaySelected?: () => void;
  private documentMouseMoveHandler?: (e: MouseEvent) => void;
  private documentMouseUpHandler?: () => void;
  
  constructor(private messageBus: MessageBusService) {}
  
  attached(): void {
    BrowserPrint('INFO', 'DayScrubber component attached');
    
    // Subscribe to day selection from TimeMap
    this.unsubscribeDaySelected = this.messageBus.subscribe('timemap:day_selected', (data: DayEvents) => {
      this.loadDay(data);
    });
    
    // Subscribe to quantum navigation updates
    this.messageBus.subscribe('timeline:position', (eventIndex: number) => {
      if (this.dayEvents.length > 0 && eventIndex >= 0 && eventIndex < this.dayEvents.length) {
        const event = this.dayEvents[eventIndex];
        const eventTime = new Date(event.timestamp);
        const dayStart = new Date(this.currentDay).getTime();
        const minutesSinceDayStart = Math.floor((event.timestamp - dayStart) / 60000);
        
        this.currentMinute = Math.max(0, Math.min(1439, minutesSinceDayStart));
        this.scrubberPosition = this.minuteToPercentage(this.currentMinute);
        this.updateScrubberHandle();
        
        BrowserPrint('DEBUG', `Quantum navigation moved scrubber to minute ${this.currentMinute}`);
      }
    });
    
    // Don't set up scrubber immediately - wait for component to become visible
  }
  
  detached(): void {
    BrowserPrint('INFO', 'DayScrubber component detached');
    this.isDetached = true;
    this.unsubscribeDaySelected?.();
    this.cleanupEventHandlers();
  }
  
  private loadDay(dayData: DayEvents): void {
    BrowserPrint('DEBUG', `Loading day: ${dayData.date} with ${dayData.events.length} events`);
    
    this.currentDay = dayData.date;
    this.dayEvents = dayData.events;
    this.isVisible = dayData.events.length > 0;
    
    // Generate hour markers from hourly distribution
    this.generateHourMarkers(dayData.hourlyDistribution);
    
    // Generate precise event blocks
    this.generateEventBlocks();
    
    // Reset scrubber position
    this.currentMinute = 0;
    this.scrubberPosition = 0;
    this.queryCache.clear(); // Clear cache when loading new day
    
    // Set up scrubber DOM handlers now that component is visible
    if (this.isVisible) {
      this.setupRetryCount = 0; // Reset retry count
      setTimeout(() => {
        this.setupScrubber();
        this.updateScrubberHandle();
      }, 100);
    }
  }
  
  private generateHourMarkers(hourlyDistribution: { [hour: number]: number }): void {
    this.hourMarkers = [];
    
    for (let hour = 0; hour < 24; hour++) {
      const eventCount = hourlyDistribution[hour] || 0;
      const percentage = (hour / 24) * 100;
      
      this.hourMarkers.push({
        hour,
        eventCount,
        percentage
      });
    }
    
    BrowserPrint('DEBUG', `Generated ${this.hourMarkers.length} hour markers`);
  }
  
  private generateEventBlocks(): void {
    if (!this.currentDay || !this.dayEvents) {
      this.eventBlocks = [];
      return;
    }
    
    this.eventBlocks = this.dayEvents.map(event => {
      const eventDate = new Date(event.timestamp);
      const hours = eventDate.getHours();
      const minutes = eventDate.getMinutes();
      const minuteOfDay = hours * 60 + minutes;
      
      // Calculate exact percentage position
      const leftPercentage = (minuteOfDay / 1439) * 100;
      
      // Width of 2 minutes for visibility
      const widthPercentage = (2 / 1439) * 100;
      
      return {
        leftPercentage,
        widthPercentage,
        minutePosition: minuteOfDay,
        duration: 2,
        intensity: this.getEventIntensity(event),
        timestamp: event.timestamp,
        eventType: event.event_type,
        label: this.formatMinuteTime(minuteOfDay)
      };
    });
    
    BrowserPrint('DEBUG', `Generated ${this.eventBlocks.length} event blocks`);
  }
  
  private getEventIntensity(event: any): string {
    if (event.event_type === 'file_upload' || event.event_type === 'file_delete') {
      return 'high';
    }
    if (event.payload?.content?.length > 100) {
      return 'medium';
    }
    return 'low';
  }
  
  private setupScrubber(): void {
    // Only set up if component is visible
    if (!this.isVisible) {
      BrowserPrint('DEBUG', 'Skipping scrubber setup - component not visible');
      return;
    }
    
    // Get DOM elements within this component's scope
    this.scrubberTrack = document.querySelector('.day-scrubber-container .scrubber-track') as HTMLElement;
    this.scrubberHandle = document.querySelector('.day-scrubber-container .scrubber-handle') as HTMLElement;
    
    if (!this.scrubberTrack || !this.scrubberHandle) {
      this.setupRetryCount++;
      
      if (this.setupRetryCount >= this.maxSetupRetries) {
        BrowserPrint('ERROR', `Scrubber DOM elements not found after ${this.maxSetupRetries} attempts, giving up`);
        return;
      }
      
      BrowserPrint('WARNING', `Scrubber DOM elements not found, retrying... (${this.setupRetryCount}/${this.maxSetupRetries})`);
      // Retry after another short delay, but only if still visible and not detached
      setTimeout(() => {
        if (this.isVisible && !this.isDetached) {
          this.setupScrubber();
        }
      }, 200);
      return;
    }
    
    // Set up mouse event handlers
    this.scrubberTrack.addEventListener('mousedown', (e) => {
      this.startDragging(e);
    });
    
    this.scrubberHandle.addEventListener('mousedown', (e) => {
      this.startDragging(e);
      e.stopPropagation();
    });
    
    // Document-level event handlers
    this.documentMouseMoveHandler = (e) => {
      if (this.isDragging) {
        this.updateScrubberPosition(e);
      }
    };
    
    this.documentMouseUpHandler = () => {
      this.stopDragging();
    };
    
    document.addEventListener('mousemove', this.documentMouseMoveHandler);
    document.addEventListener('mouseup', this.documentMouseUpHandler);
    
    BrowserPrint('DEBUG', 'Scrubber event handlers set up');
  }
  
  private cleanupEventHandlers(): void {
    if (this.documentMouseMoveHandler) {
      document.removeEventListener('mousemove', this.documentMouseMoveHandler);
    }
    if (this.documentMouseUpHandler) {
      document.removeEventListener('mouseup', this.documentMouseUpHandler);
    }
  }
  
  private startDragging(event: MouseEvent): void {
    this.isDragging = true;
    this.updateScrubberPosition(event);
    BrowserPrint('DEBUG', 'Started dragging scrubber');
  }
  
  private stopDragging(): void {
    if (this.isDragging) {
      this.isDragging = false;
      BrowserPrint('DEBUG', 'Stopped dragging scrubber');
    }
  }
  
  private updateScrubberPosition(event: MouseEvent): void {
    if (!this.scrubberTrack) return;
    
    const rect = this.scrubberTrack.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
    
    // Convert percentage to minute (0-1439)
    this.currentMinute = Math.round((percentage / 100) * 1439);
    
    // Store percentage for positioning
    this.scrubberPosition = percentage;
    
    this.updateScrubberHandle();
    
    // Query events near this time
    const targetTime = this.minuteToTime(this.currentMinute);
    this.queryTimeWindow(targetTime);
    
    BrowserPrint('DEBUG', `Scrubber at ${this.currentMinute} minutes (${this.formatMinuteTime(this.currentMinute)})`);
  }
  
  private updateScrubberHandle(): void {
    if (this.scrubberHandle) {
      this.scrubberHandle.style.left = `${this.scrubberPosition}%`;
    }
    
    // Trigger UI update for data binding
    this.triggerUIUpdate();
  }

  private triggerUIUpdate(): void {
    // Force Aurelia to update the UI
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(() => {
        // This forces a re-render of the component
        this.scrubberPosition = this.scrubberPosition;
      });
    }
  }
  
  private minuteToTime(minute: number): number {
    if (!this.currentDay) return Date.now();
    
    const dayStart = new Date(this.currentDay).getTime();
    const minuteMillis = 60 * 1000; // 60 seconds in milliseconds
    return dayStart + (minute * minuteMillis);
  }
  
  private timeToMinute(timestamp: number): number {
    if (!this.currentDay) return 0;
    
    const dayStart = new Date(this.currentDay).getTime();
    const minuteMillis = 60 * 1000; // 60 seconds in milliseconds
    const minutesSinceDayStart = Math.floor((timestamp - dayStart) / minuteMillis);
    
    // Clamp to 0-1439 range
    return Math.max(0, Math.min(1439, minutesSinceDayStart));
  }
  
  private minuteToPercentage(minute: number): number {
    // Ensure minute is within bounds
    const clampedMinute = Math.max(0, Math.min(1439, minute));
    return (clampedMinute / 1439) * 100;
  }
  
  private percentageToMinute(percentage: number): number {
    // Ensure percentage is within bounds
    const clampedPercentage = Math.max(0, Math.min(100, percentage));
    return Math.round((clampedPercentage / 100) * 1439);
  }
  
  private findNearestEvent(targetTime: number): any {
    if (this.dayEvents.length === 0) return null;
    
    return this.dayEvents.reduce((nearest, event) => {
      const eventTime = event.timestamp;
      if (!nearest || Math.abs(eventTime - targetTime) < Math.abs(nearest.timestamp - targetTime)) {
        return event;
      }
      return nearest;
    }, null);
  }
  
  private queryTimeWindow(targetTime: number): void {
    if (this.dayEvents.length === 0) {
      BrowserPrint('DEBUG', 'No events available for this day');
      return;
    }
    
    // Find the nearest event in the entire day (not just ±60 seconds)
    const nearestEvent = this.findNearestEvent(targetTime);
    
    if (!nearestEvent) {
      BrowserPrint('DEBUG', 'No nearest event found');
      return;
    }
    
    // Calculate the minute position of the nearest event
    const eventMinute = this.timeToMinute(nearestEvent.timestamp);
    const minuteDiff = Math.abs(eventMinute - this.currentMinute);
    
    BrowserPrint('DEBUG', `Found nearest event ${minuteDiff} minutes away at minute ${eventMinute}`);
    
    // Snap to the nearest event
    this.currentMinute = eventMinute;
    this.scrubberPosition = this.minuteToPercentage(eventMinute);
    this.updateScrubberHandle();
    
    // Request state reconstruction at this event
    this.requestStateAtTimestamp(nearestEvent.timestamp, nearestEvent.id);
    
    // Update quantum navigation position
    const eventIndex = this.dayEvents.findIndex(e => e.id === nearestEvent.id);
    if (eventIndex >= 0) {
      this.messageBus.publish('timeline:scrubber_position', {
        eventIndex,
        totalEvents: this.dayEvents.length,
        timestamp: nearestEvent.timestamp
      });
      
      BrowserPrint('INFO', `Snapped to event ${eventIndex + 1}/${this.dayEvents.length}: ${nearestEvent.event_type}`);
    }
  }
  
  private requestStateAtTimestamp(timestamp: number, eventId: number): void {
    BrowserPrint('DEBUG', `Requesting state reconstruction at timestamp ${timestamp}`);
    
    const event = this.dayEvents.find(e => e.id === eventId);
    if (!event) {
      BrowserPrint('ERROR', `Event ${eventId} not found`);
      return;
    }
    
    // Find the event index for proper navigation tracking
    const eventIndex = this.dayEvents.findIndex(e => e.id === eventId);
    
    // Use the same mechanism as BACK/FORWARD buttons: publish timeline:apply_state
    this.messageBus.publish('timeline:apply_state', {
      event: event,
      changedRegisters: [],  // Will be detected by the handler
      eventIndex: eventIndex,
      timestamp: timestamp
    });
  }
  
  private applyStateFromQuery(cachedState: any): void {
    if (cachedState && cachedState.eventId) {
      const event = this.dayEvents.find(e => e.id === cachedState.eventId);
      if (event) {
        const eventIndex = this.dayEvents.findIndex(e => e.id === cachedState.eventId);
        
        // Use the same mechanism as BACK/FORWARD buttons: publish timeline:apply_state
        this.messageBus.publish('timeline:apply_state', {
          event: event,
          changedRegisters: [],  // Will be detected by the handler
          eventIndex: eventIndex,
          timestamp: cachedState.timestamp
        });
      }
    }
  }
  
  private applyEventState(event: any): void {
    BrowserPrint('DEBUG', `Applying event state: ${event.event_type} at ${new Date(event.timestamp).toISOString()}`);
    
    const eventIndex = this.dayEvents.findIndex(e => e.id === event.id);
    
    // Use the same mechanism as BACK/FORWARD buttons: publish timeline:apply_state
    this.messageBus.publish('timeline:apply_state', {
      event: event,
      changedRegisters: [],  // Will be detected by the handler
      eventIndex: eventIndex,
      timestamp: event.timestamp
    });
  }
  
  // Jump to specific hour
  jumpToHour(hour: number): void {
    const minute = hour * 60; // Convert hour to minute
    // Clamp to 0-1439 range
    this.currentMinute = Math.max(0, Math.min(1439, minute));
    this.scrubberPosition = this.minuteToPercentage(this.currentMinute);
    this.updateScrubberHandle();
    
    // Query events at this time
    const targetTime = this.minuteToTime(this.currentMinute);
    this.queryTimeWindow(targetTime);
    
    BrowserPrint('DEBUG', `Jumped to hour ${hour} (minute ${this.currentMinute})`);
  }
  
  // Format time for display
  formatTime(hour: number): string {
    return `${hour.toString().padStart(2, '0')}:00`;
  }
  
  // Get activity level for hour
  getHourActivityLevel(eventCount: number): string {
    if (eventCount === 0) return 'hour-none';
    if (eventCount <= 2) return 'hour-low';
    if (eventCount <= 5) return 'hour-medium';
    if (eventCount <= 10) return 'hour-high';
    return 'hour-max';
  }
  
  // Navigate to specific time within day
  navigateToTime(timeString: string): void {
    const [hours, minutes] = timeString.split(':').map(Number);
    const totalMinutes = hours * 60 + minutes;
    
    // Clamp to 0-1439 range
    this.currentMinute = Math.max(0, Math.min(1439, totalMinutes));
    this.scrubberPosition = this.minuteToPercentage(this.currentMinute);
    this.updateScrubberHandle();
    
    const targetTime = this.minuteToTime(this.currentMinute);
    this.queryTimeWindow(targetTime);
    
    BrowserPrint('DEBUG', `Navigated to time ${timeString} (minute ${this.currentMinute})`);
  }
  
  // Get current time as string
  getCurrentTime(): string {
    const hours = Math.floor(this.currentMinute / 60);
    const minutes = this.currentMinute % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  }

  // Getter methods for template bindings
  get visible(): boolean {
    return this.isVisible;
  }

  get currentDayFormatted(): string {
    return this.currentDay;
  }

  get eventsForDay(): any[] {
    return this.dayEvents;
  }

  get hourMarkersForTemplate(): HourMarker[] {
    return this.hourMarkers;
  }

  get scrubberPositionForTemplate(): number {
    return this.scrubberPosition;
  }
  
  get scrubberMinute(): number {
    return this.currentMinute;
  }
  
  get eventBlocksForTemplate(): any[] {
    return this.eventBlocks;
  }
  
  formatMinuteTime(minuteOfDay: number): string {
    const hours = Math.floor(minuteOfDay / 60);
    const minutes = minuteOfDay % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  }
  
  // Test method to verify scrubber functionality
  testScrubber(): void {
    BrowserPrint('INFO', 'Testing scrubber functionality');
    
    // Create fake day data
    const testData: DayEvents = {
      date: '2025-07-16',
      events: [
        { id: 1, timestamp: Date.now() - 3600000, event_type: 'text_change', entity_id: 'register1', payload: { content: 'Test 1' } },
        { id: 2, timestamp: Date.now() - 1800000, event_type: 'text_change', entity_id: 'register2', payload: { content: 'Test 2' } },
        { id: 3, timestamp: Date.now() - 900000, event_type: 'text_change', entity_id: 'register1', payload: { content: 'Test 3' } }
      ],
      hourlyDistribution: { 8: 1, 12: 1, 16: 1 }
    };
    
    this.loadDay(testData);
    BrowserPrint('INFO', `Scrubber test loaded with ${testData.events.length} events, visible: ${this.isVisible}`);
  }
  
  // Debug helper for positioning verification
  private debugPositioning(): void {
    console.log('Current minute:', this.currentMinute);
    console.log('Scrubber position %:', this.scrubberPosition);
    console.log('Expected position %:', (this.currentMinute / 1439) * 100);
    
    this.eventBlocks.forEach((block, i) => {
      console.log(`Event ${i}: minute ${block.minutePosition}, left ${block.leftPercentage}%`);
    });
  }
}