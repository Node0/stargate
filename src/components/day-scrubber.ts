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
  private scrubberPosition: number = 0; // 0-100 percentage
  private hourMarkers: HourMarker[] = [];
  private isDragging: boolean = false;
  private isVisible: boolean = false;
  
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
    
    // Set up DOM event handlers after a short delay to ensure DOM is ready
    setTimeout(() => {
      this.setupScrubber();
    }, 100);
  }
  
  detached(): void {
    BrowserPrint('INFO', 'DayScrubber component detached');
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
    
    // Reset scrubber position
    this.scrubberPosition = 0;
    this.updateScrubberHandle();
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
  
  private setupScrubber(): void {
    // Get DOM elements within this component's scope
    this.scrubberTrack = document.querySelector('.day-scrubber-container .scrubber-track') as HTMLElement;
    this.scrubberHandle = document.querySelector('.day-scrubber-container .scrubber-handle') as HTMLElement;
    
    if (!this.scrubberTrack || !this.scrubberHandle) {
      BrowserPrint('WARNING', 'Scrubber DOM elements not found, retrying...');
      // Retry after another short delay
      setTimeout(() => {
        this.setupScrubber();
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
    const percentage = Math.max(0, Math.min(100, 
      ((event.clientX - rect.left) / rect.width) * 100
    ));
    
    this.scrubberPosition = percentage;
    this.updateScrubberHandle();
    
    // Find and apply the nearest event
    const targetTime = this.percentageToTime(percentage);
    const nearestEvent = this.findNearestEvent(targetTime);
    
    if (nearestEvent) {
      this.applyEventState(nearestEvent);
    }
    
    BrowserPrint('DEBUG', `Scrubber position: ${percentage.toFixed(2)}%`);
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
  
  private percentageToTime(percentage: number): number {
    if (!this.currentDay) return Date.now();
    
    const dayStart = new Date(this.currentDay).getTime();
    const dayMillis = 24 * 60 * 60 * 1000;
    return dayStart + (dayMillis * percentage / 100);
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
  
  private applyEventState(event: any): void {
    BrowserPrint('DEBUG', `Applying event state: ${event.event_type} at ${new Date(event.timestamp).toISOString()}`);
    
    // Publish event for other components to handle
    this.messageBus.publish('timeline:apply_event', {
      eventId: event.id,
      event: event,
      timestamp: event.timestamp
    });
  }
  
  // Jump to specific hour
  jumpToHour(hour: number): void {
    const percentage = (hour / 24) * 100;
    this.scrubberPosition = percentage;
    this.updateScrubberHandle();
    
    // Find events at this hour
    const targetTime = this.percentageToTime(percentage);
    const nearestEvent = this.findNearestEvent(targetTime);
    
    if (nearestEvent) {
      this.applyEventState(nearestEvent);
    }
    
    BrowserPrint('DEBUG', `Jumped to hour ${hour}`);
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
    const percentage = ((hours * 60 + minutes) / (24 * 60)) * 100;
    
    this.scrubberPosition = percentage;
    this.updateScrubberHandle();
    
    const targetTime = this.percentageToTime(percentage);
    const nearestEvent = this.findNearestEvent(targetTime);
    
    if (nearestEvent) {
      this.applyEventState(nearestEvent);
    }
    
    BrowserPrint('DEBUG', `Navigated to time ${timeString}`);
  }
  
  // Get current time as string
  getCurrentTime(): string {
    const totalMinutes = (this.scrubberPosition / 100) * 24 * 60;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = Math.floor(totalMinutes % 60);
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
}