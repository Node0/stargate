import { inject } from 'aurelia';
import { CollaborationService } from '../services/collaboration.service';
import { MessageBusService } from '../services/message-bus.service';
import { TimelineCoordinatorService } from '../services/timeline-coordinator.service';
import { BrowserPrint } from '../browser-logger';

export interface TimeMapData {
  years: number[];
  monthsData: { [key: string]: number }; // "2025-01" -> event count
  daysData: { [key: string]: number };   // "2025-01-15" -> event count
  totalEvents: number;
  dateRange: { start: string; end: string };
}

export interface DayCell {
  date: string | null;
  dayNumber: number | null;
  eventCount: number;
  activityLevel: string;
  isSelected: boolean;
  isCurrentMonth: boolean;
  isCurrentYear?: boolean;
}

@inject(CollaborationService, MessageBusService, TimelineCoordinatorService)
export class TimeMap {
  private timeMapData: TimeMapData | null = null;
  private selectedDate: string | null = null;
  private selectedRange: 'day' | 'month' | 'year' | 'all' = 'all';
  private selectedYear: number | null = null;
  private currentYear: number = new Date().getFullYear();
  
  // Visual properties
  years: number[] = [];
  months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  dayGrid: DayCell[][] = [];
  
  // Component lifecycle
  private unsubscribeTimeMapData?: () => void;
  private unsubscribeConnection?: () => void;
  
  constructor(
    private collaboration: CollaborationService,
    private messageBus: MessageBusService,
    private coordinator: TimelineCoordinatorService
  ) {}
  
  attached(): void {
    BrowserPrint('INFO', 'TimeMap component attached');
    
    // Subscribe to timemap responses
    this.unsubscribeTimeMapData = this.messageBus.subscribe('timemap:response', (response: any) => {
      this.handleTimeMapResponse(response);
    });
    
    // Subscribe to connection status
    this.unsubscribeConnection = this.collaboration.subscribeToConnection((connected: boolean) => {
      if (connected) {
        BrowserPrint('DEBUG', 'TimeMap: Connection restored, reloading data');
        this.loadTimeMap();
      }
    });
    
    // Load initial data
    this.loadTimeMap();
  }
  
  detached(): void {
    BrowserPrint('INFO', 'TimeMap component detached');
    this.unsubscribeTimeMapData?.();
    this.unsubscribeConnection?.();
  }
  
  private handleTimeMapResponse(response: any): void {
    BrowserPrint('DEBUG', `TimeMap response: ${response.action}`);
    
    switch (response.action) {
      case 'map_data':
        this.processTimeMapData(response.data);
        break;
      case 'day_events':
        this.processDayEvents(response.data);
        break;
      case 'month_events':
        this.processMonthEvents(response.data);
        break;
      case 'year_events':
        this.processYearEvents(response.data);
        break;
      default:
        if (response.error) {
          BrowserPrint('ERROR', `TimeMap error: ${response.error}`);
        }
    }
  }
  
  private processTimeMapData(data: TimeMapData): void {
    BrowserPrint('DEBUG', `Processing TimeMap data: ${data.totalEvents} events`);
    
    this.timeMapData = data;
    this.years = data.years;
    
    // Update current year if we have data
    if (data.years.length > 0) {
      this.currentYear = Math.max(...data.years);
    }
    
    // Generate day grid for current year
    this.generateDayGrid();
  }
  
  private processDayEvents(dayEvents: any): void {
    BrowserPrint('DEBUG', `Processing day events: ${dayEvents.events.length} events for ${dayEvents.date}`);
    
    // Notify other components about day selection
    this.messageBus.publish('timemap:day_selected', dayEvents);
  }
  
  private processMonthEvents(monthEvents: any): void {
    BrowserPrint('DEBUG', `Processing month events: ${monthEvents.events.length} events`);
    // Handle month events if needed
  }
  
  private processYearEvents(yearEvents: any): void {
    BrowserPrint('DEBUG', `Processing year events: ${yearEvents.events.length} events`);
    // Handle year events if needed
  }
  
  loadTimeMap(): void {
    if (!this.collaboration.isConnected()) {
      BrowserPrint('WARNING', 'Cannot load TimeMap: not connected');
      return;
    }
    
    BrowserPrint('DEBUG', 'Loading TimeMap data');
    
    // Send timemap request
    const message = {
      type: 'timemap_request',
      action: 'get_map',
      req: btoa(JSON.stringify({ success: true, body: {} }))
    };
    
    if (!this.sendMessage(message)) {
      BrowserPrint('ERROR', 'Failed to send TimeMap request');
    }
  }
  
  selectDay(date: string): void {
    if (!date) return;
    
    BrowserPrint('DEBUG', `Selecting day: ${date}`);
    
    this.selectedDate = date;
    this.selectedRange = 'day';
    
    // Update day grid selection
    this.updateDayGridSelection();
    
    // Request day events
    const message = {
      type: 'timemap_request',
      action: 'get_day',
      req: btoa(JSON.stringify({ success: true, body: { date } }))
    };
    
    if (!this.sendMessage(message)) {
      BrowserPrint('ERROR', 'Failed to send day events request');
    }
  }
  
  selectMonth(year: number, month: number): void {
    BrowserPrint('DEBUG', `Selecting month: ${year}-${month}`);
    
    this.selectedRange = 'month';
    this.selectedYear = year;
    this.currentYear = year;
    
    // Regenerate day grid for selected year
    this.generateDayGrid();
    
    // Constrain search to month
    this.messageBus.publish('search:constrain', {
      start: new Date(year, month - 1, 1).getTime(),
      end: new Date(year, month, 0, 23, 59, 59, 999).getTime()
    });
    
    // Request month events
    const message = {
      type: 'timemap_request',
      action: 'get_month',
      req: btoa(JSON.stringify({ success: true, body: { year, month } }))
    };
    
    this.sendMessage(message);
  }
  
  selectYear(year: number): void {
    BrowserPrint('DEBUG', `Selecting year: ${year}`);
    
    this.selectedRange = 'year';
    this.selectedYear = year;
    this.currentYear = year;
    
    // Regenerate day grid for selected year
    this.generateDayGrid();
    
    // Constrain search to year
    this.messageBus.publish('search:constrain', {
      start: new Date(year, 0, 1).getTime(),
      end: new Date(year, 11, 31, 23, 59, 59, 999).getTime()
    });
    
    // Request year events
    const message = {
      type: 'timemap_request',
      action: 'get_year',
      req: btoa(JSON.stringify({ success: true, body: { year } }))
    };
    
    this.sendMessage(message);
  }
  
  selectAllTime(): void {
    BrowserPrint('DEBUG', 'Selecting all time');
    
    this.selectedRange = 'all';
    this.selectedYear = null;
    this.selectedDate = null;
    
    // Remove search constraints
    this.messageBus.publish('search:constrain', null);
    
    // Update day grid selection
    this.updateDayGridSelection();
  }
  
  private generateDayGrid(): void {
    if (!this.timeMapData) {
      this.dayGrid = [];
      return;
    }
    
    const year = this.currentYear;
    this.dayGrid = this.generateYearGrid(year);
    BrowserPrint('DEBUG', `Generated day grid for ${year}: ${this.dayGrid.length} weeks`);
  }

  private generateYearGrid(year: number): DayCell[][] {
    const grid: DayCell[][] = [];
    
    // Start from the first Sunday of the year or before
    const startOfYear = new Date(year, 0, 1);
    const startDate = new Date(startOfYear);
    
    // Find the Sunday before or on the start of the year
    const dayOfWeek = startOfYear.getDay();
    startDate.setDate(startDate.getDate() - dayOfWeek);
    
    const endOfYear = new Date(year, 11, 31);
    const endDate = new Date(endOfYear);
    
    // Find the Saturday after or on the end of the year
    const endDayOfWeek = endOfYear.getDay();
    endDate.setDate(endDate.getDate() + (6 - endDayOfWeek));
    
    // Generate weeks
    let currentDate = new Date(startDate);
    
    while (currentDate <= endDate) {
      const week: DayCell[] = [];
      
      // Generate 7 days for this week
      for (let day = 0; day < 7; day++) {
        const dateStr = this.formatDate(currentDate);
        const eventCount = this.timeMapData?.daysData[dateStr] || 0;
        const isCurrentYear = currentDate.getFullYear() === year;
        
        const dayCell: DayCell = {
          date: isCurrentYear ? dateStr : '',
          dayNumber: currentDate.getDate(),
          eventCount,
          activityLevel: this.getActivityLevel(eventCount),
          isSelected: dateStr === this.selectedDate,
          isCurrentMonth: true, // We'll use this for current year
          isCurrentYear
        };
        
        week.push(dayCell);
        
        // Move to next day
        currentDate.setDate(currentDate.getDate() + 1);
      }
      
      grid.push(week);
    }
    
    return grid;
  }
  
  private generateMonthGrid(year: number, month: number): DayCell[][] {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startWeek = new Date(firstDay);
    
    // Adjust to Monday (0 = Sunday, 1 = Monday, etc.)
    const dayOfWeek = (firstDay.getDay() + 6) % 7;
    startWeek.setDate(startWeek.getDate() - dayOfWeek);
    
    const weeks: DayCell[][] = [];
    let currentWeek: DayCell[] = [];
    let currentDate = new Date(startWeek);
    
    // Generate weeks for the month
    while (currentDate <= lastDay || currentWeek.length < 7) {
      const isCurrentMonth = currentDate.getMonth() === month;
      const dateStr = this.formatDate(currentDate);
      const eventCount = this.timeMapData?.daysData[dateStr] || 0;
      
      const dayCell: DayCell = {
        date: dateStr,
        dayNumber: currentDate.getDate(),
        eventCount,
        activityLevel: this.getActivityLevel(eventCount),
        isSelected: dateStr === this.selectedDate,
        isCurrentMonth
      };
      
      currentWeek.push(dayCell);
      
      // Start new week on Monday
      if (currentWeek.length === 7) {
        weeks.push(currentWeek);
        currentWeek = [];
      }
      
      currentDate.setDate(currentDate.getDate() + 1);
      
      // Stop if we've gone past the month and completed a week
      if (currentDate.getMonth() !== month && currentWeek.length === 0) {
        break;
      }
    }
    
    return weeks;
  }
  
  private updateDayGridSelection(): void {
    this.dayGrid.forEach(week => {
      week.forEach(day => {
        day.isSelected = day.date === this.selectedDate;
      });
    });
  }
  
  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0]; // YYYY-MM-DD format
  }
  
  getActivityLevel(eventCount: number): string {
    if (eventCount === 0) return 'activity-none';
    if (eventCount <= 3) return 'activity-low';
    if (eventCount <= 10) return 'activity-medium';
    if (eventCount <= 20) return 'activity-high';
    return 'activity-max';
  }
  
  private sendMessage(message: any): boolean {
    return this.collaboration.sendMessage(message);
  }
  
  // === Quantum Navigation Methods ===
  
  get canGoBack(): boolean {
    return this.coordinator.getCurrentEventIndex() > 0;
  }
  
  get canGoForward(): boolean {
    const sequence = this.coordinator.getEventSequence();
    return this.coordinator.getCurrentEventIndex() < sequence.length - 1;
  }
  
  quantumBack(): void {
    BrowserPrint('DEBUG', 'TimeMap: Quantum navigation back');
    this.coordinator.navigateToEvent('previous');
  }
  
  quantumForward(): void {
    BrowserPrint('DEBUG', 'TimeMap: Quantum navigation forward');
    this.coordinator.navigateToEvent('next');
  }
  
}