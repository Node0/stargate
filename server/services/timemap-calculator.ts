import { EventStore } from './event-store';
import { Print } from '../utilities';

export interface TimeMapData {
  years: number[];
  monthsData: Map<string, number>; // "2025-01" -> event count
  daysData: Map<string, number>;   // "2025-01-15" -> event count
  totalEvents: number;
  dateRange: { start: Date; end: Date };
}

export interface DayEvents {
  date: string;
  events: any[];
  hourlyDistribution: Map<number, number>;
}

export class TimeMapCalculator {
  constructor(private eventStore: EventStore) {}
  
  async calculateTimeMap(): Promise<TimeMapData> {
    try {
      // Get all events for analysis
      const allEvents = await this.eventStore.getAllEvents();
      
      if (allEvents.length === 0) {
        Print('DEBUG', 'No events found, returning empty TimeMap');
        return {
          years: [],
          monthsData: new Map(),
          daysData: new Map(),
          totalEvents: 0,
          dateRange: { start: new Date(), end: new Date() }
        };
      }
      
      const daysData = new Map<string, number>();
      const monthsData = new Map<string, number>();
      const years = new Set<number>();
      
      // Process each event
      allEvents.forEach(event => {
        const date = new Date(event.timestamp);
        const dayKey = this.formatDate(date);
        const monthKey = this.formatMonth(date);
        const year = date.getFullYear();
        
        // Count events by day
        daysData.set(dayKey, (daysData.get(dayKey) || 0) + 1);
        
        // Count events by month
        monthsData.set(monthKey, (monthsData.get(monthKey) || 0) + 1);
        
        // Track years
        years.add(year);
      });
      
      // Calculate date range
      const timestamps = allEvents.map(e => e.timestamp);
      const minTimestamp = Math.min(...timestamps);
      const maxTimestamp = Math.max(...timestamps);
      
      const timeMapData: TimeMapData = {
        years: Array.from(years).sort(),
        monthsData,
        daysData,
        totalEvents: allEvents.length,
        dateRange: {
          start: new Date(minTimestamp),
          end: new Date(maxTimestamp)
        }
      };
      
      Print('INFO', `TimeMap calculated: ${timeMapData.totalEvents} events across ${timeMapData.years.length} years`);
      Print('DEBUG', `Date range: ${timeMapData.dateRange.start.toISOString()} to ${timeMapData.dateRange.end.toISOString()}`);
      
      return timeMapData;
    } catch (error) {
      Print('ERROR', `Failed to calculate TimeMap: ${(error as Error).message}`);
      throw error;
    }
  }
  
  async getEventsForDay(date: string): Promise<DayEvents> {
    try {
      const startTime = new Date(date).getTime();
      const endTime = startTime + 86400000; // 24 hours in milliseconds
      
      // Get all events for the day
      const allEvents = await this.eventStore.getAllEvents();
      const dayEvents = allEvents.filter(event => 
        event.timestamp >= startTime && event.timestamp < endTime
      );
      
      // Group events by hour for the day scrubber
      const hourlyDistribution = new Map<number, number>();
      dayEvents.forEach(event => {
        const hour = new Date(event.timestamp).getHours();
        hourlyDistribution.set(hour, (hourlyDistribution.get(hour) || 0) + 1);
      });
      
      const result: DayEvents = {
        date,
        events: dayEvents,
        hourlyDistribution
      };
      
      Print('DEBUG', `Found ${dayEvents.length} events for day ${date}`);
      return result;
    } catch (error) {
      Print('ERROR', `Failed to get events for day ${date}: ${(error as Error).message}`);
      throw error;
    }
  }
  
  async getEventsForMonth(year: number, month: number): Promise<any[]> {
    try {
      const startTime = new Date(year, month - 1, 1).getTime();
      const endTime = new Date(year, month, 0, 23, 59, 59, 999).getTime();
      
      const allEvents = await this.eventStore.getAllEvents();
      const monthEvents = allEvents.filter(event => 
        event.timestamp >= startTime && event.timestamp <= endTime
      );
      
      Print('DEBUG', `Found ${monthEvents.length} events for month ${year}-${month}`);
      return monthEvents;
    } catch (error) {
      Print('ERROR', `Failed to get events for month ${year}-${month}: ${(error as Error).message}`);
      throw error;
    }
  }
  
  async getEventsForYear(year: number): Promise<any[]> {
    try {
      const startTime = new Date(year, 0, 1).getTime();
      const endTime = new Date(year, 11, 31, 23, 59, 59, 999).getTime();
      
      const allEvents = await this.eventStore.getAllEvents();
      const yearEvents = allEvents.filter(event => 
        event.timestamp >= startTime && event.timestamp <= endTime
      );
      
      Print('DEBUG', `Found ${yearEvents.length} events for year ${year}`);
      return yearEvents;
    } catch (error) {
      Print('ERROR', `Failed to get events for year ${year}: ${(error as Error).message}`);
      throw error;
    }
  }
  
  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0]; // YYYY-MM-DD format
  }
  
  private formatMonth(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }
  
  // Convert TimeMapData to JSON-serializable format for client
  serializeTimeMapData(timeMapData: TimeMapData): any {
    return {
      years: timeMapData.years,
      monthsData: Object.fromEntries(timeMapData.monthsData),
      daysData: Object.fromEntries(timeMapData.daysData),
      totalEvents: timeMapData.totalEvents,
      dateRange: {
        start: timeMapData.dateRange.start.toISOString(),
        end: timeMapData.dateRange.end.toISOString()
      }
    };
  }
  
  // Convert DayEvents to JSON-serializable format for client
  serializeDayEvents(dayEvents: DayEvents): any {
    return {
      date: dayEvents.date,
      events: dayEvents.events,
      hourlyDistribution: Object.fromEntries(dayEvents.hourlyDistribution)
    };
  }
}