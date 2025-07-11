import { EventStore } from './event-store';
import { Print } from '../utilities';

export interface SystemState {
  registers: RegisterState[];
  files: FileInfo[];
  timestamp: number;
  version: string;
}

export interface RegisterState {
  id: number;
  content: string;
}

export interface FileInfo {
  displayName: string;
  storedName: string;
  timestamp: number;
  uploaderHostname: string;
  size: number;
  hash: string;
}

export class StateReconstructor {
  constructor(private eventStore: EventStore) {}
  
  async getStateAtEvent(eventId: number): Promise<SystemState> {
    try {
      // Get all events up to and including this event
      const allEvents = await this.eventStore.getAllEvents();
      const events = allEvents.filter(event => event.id! <= eventId);
      
      // Build state by replaying events
      const state: SystemState = {
        registers: [
          { id: 1, content: '' },
          { id: 2, content: '' },
          { id: 3, content: '' }
        ],
        files: [],
        timestamp: 0,
        version: '2.0.0'
      };
      
      events.forEach(event => {
        this.applyEventToState(state, event);
      });
      
      Print('DEBUG', `State reconstructed at event ${eventId}: ${events.length} events applied`);
      return state;
    } catch (error) {
      Print('ERROR', `Failed to reconstruct state at event ${eventId}: ${(error as Error).message}`);
      throw error;
    }
  }
  
  async getStateAtTimestamp(timestamp: number): Promise<SystemState> {
    try {
      // Get all events up to and including this timestamp
      const allEvents = await this.eventStore.getAllEvents();
      const events = allEvents.filter(event => event.timestamp <= timestamp);
      
      // Build state by replaying events
      const state: SystemState = {
        registers: [
          { id: 1, content: '' },
          { id: 2, content: '' },
          { id: 3, content: '' }
        ],
        files: [],
        timestamp: 0,
        version: '2.0.0'
      };
      
      events.forEach(event => {
        this.applyEventToState(state, event);
      });
      
      Print('DEBUG', `State reconstructed at timestamp ${timestamp}: ${events.length} events applied`);
      return state;
    } catch (error) {
      Print('ERROR', `Failed to reconstruct state at timestamp ${timestamp}: ${(error as Error).message}`);
      throw error;
    }
  }
  
  async getCurrentState(): Promise<SystemState> {
    try {
      const allEvents = await this.eventStore.getAllEvents();
      
      // Build state by replaying all events
      const state: SystemState = {
        registers: [
          { id: 1, content: '' },
          { id: 2, content: '' },
          { id: 3, content: '' }
        ],
        files: [],
        timestamp: Date.now(),
        version: '2.0.0'
      };
      
      allEvents.forEach(event => {
        this.applyEventToState(state, event);
      });
      
      Print('DEBUG', `Current state reconstructed: ${allEvents.length} events applied`);
      return state;
    } catch (error) {
      Print('ERROR', `Failed to reconstruct current state: ${(error as Error).message}`);
      throw error;
    }
  }
  
  private applyEventToState(state: SystemState, event: any): void {
    try {
      const payload = event.payload;
      
      switch (event.event_type) {
        case 'text_change':
          const registerIndex = parseInt(event.entity_id.replace('register', '')) - 1;
          if (state.registers[registerIndex]) {
            state.registers[registerIndex].content = payload.content;
          }
          break;
          
        case 'file_upload':
          // Check if file already exists (by hash or storedName)
          const existingFileIndex = state.files.findIndex(f => 
            f.hash === payload.hash || f.storedName === payload.storedName
          );
          
          if (existingFileIndex >= 0) {
            // Update existing file
            state.files[existingFileIndex] = {
              displayName: payload.filename || payload.displayName,
              storedName: payload.storedName,
              timestamp: event.timestamp,
              uploaderHostname: payload.uploaderHostname || 'unknown',
              size: payload.size || 0,
              hash: payload.hash || ''
            };
          } else {
            // Add new file
            state.files.push({
              displayName: payload.filename || payload.displayName,
              storedName: payload.storedName,
              timestamp: event.timestamp,
              uploaderHostname: payload.uploaderHostname || 'unknown',
              size: payload.size || 0,
              hash: payload.hash || ''
            });
          }
          break;
          
        case 'file_delete':
          // Remove file by hash or storedName
          state.files = state.files.filter(f => 
            f.hash !== payload.hash && f.storedName !== payload.storedName
          );
          break;
      }
      
      state.timestamp = event.timestamp;
    } catch (error) {
      Print('ERROR', `Failed to apply event ${event.id} to state: ${(error as Error).message}`);
    }
  }
  
  // Get state changes between two events
  async getStateChanges(fromEventId: number, toEventId: number): Promise<{
    fromState: SystemState;
    toState: SystemState;
    changes: StateChange[];
  }> {
    try {
      const fromState = await this.getStateAtEvent(fromEventId);
      const toState = await this.getStateAtEvent(toEventId);
      
      const changes: StateChange[] = [];
      
      // Compare registers
      for (let i = 0; i < fromState.registers.length; i++) {
        if (fromState.registers[i].content !== toState.registers[i].content) {
          changes.push({
            type: 'register_change',
            registerId: i + 1,
            from: fromState.registers[i].content,
            to: toState.registers[i].content
          });
        }
      }
      
      // Compare files (simplified - could be more sophisticated)
      const fromFileHashes = new Set(fromState.files.map(f => f.hash));
      const toFileHashes = new Set(toState.files.map(f => f.hash));
      
      // New files
      toState.files.forEach(file => {
        if (!fromFileHashes.has(file.hash)) {
          changes.push({
            type: 'file_added',
            file: file
          });
        }
      });
      
      // Deleted files
      fromState.files.forEach(file => {
        if (!toFileHashes.has(file.hash)) {
          changes.push({
            type: 'file_deleted',
            file: file
          });
        }
      });
      
      return { fromState, toState, changes };
    } catch (error) {
      Print('ERROR', `Failed to get state changes between events ${fromEventId} and ${toEventId}: ${(error as Error).message}`);
      throw error;
    }
  }
}

export interface StateChange {
  type: 'register_change' | 'file_added' | 'file_deleted';
  registerId?: number;
  from?: string;
  to?: string;
  file?: FileInfo;
}