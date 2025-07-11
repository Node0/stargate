import { createClient } from '@libsql/client';
import { Print } from '../utilities';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// ES module compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface StargateEvent {
  id?: number;
  event_type: 'text_change' | 'file_upload' | 'file_delete';
  entity_id: string;
  payload: any;
  timestamp: number;
  client_id: string;
  sequence_num: number;
}

export class EventStore {
  private db: any; // LibSQL Client
  private dbPath: string;
  
  constructor() {
    this.dbPath = path.join(__dirname, '../../storage/data/stargate.db');
    
    // Ensure the directory exists
    const dbDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
      Print('INFO', `Created database directory: ${dbDir}`);
    }
    
    // Create LibSQL client for local file
    this.db = createClient({
      url: `file:${this.dbPath}`
    });
    
    // Initialize schema (async, but we'll handle it in the methods)
    this.initSchema().catch(error => {
      Print('ERROR', `Failed to initialize EventStore: ${error.message}`);
    });
    
    Print('INFO', `EventStore initialized with database at: ${this.dbPath}`);
  }
  
  private async initSchema(): Promise<void> {
    try {
      await this.db.execute(`
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          payload TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          client_id TEXT,
          sequence_num INTEGER,
          UNIQUE(client_id, sequence_num)
        );
      `);
      
      await this.db.execute(`CREATE INDEX IF NOT EXISTS idx_timestamp ON events(timestamp);`);
      await this.db.execute(`CREATE INDEX IF NOT EXISTS idx_entity_timestamp ON events(entity_id, timestamp);`);
      await this.db.execute(`CREATE INDEX IF NOT EXISTS idx_date ON events(date(timestamp/1000, 'unixepoch'));`);
      await this.db.execute(`CREATE INDEX IF NOT EXISTS idx_event_type ON events(event_type);`);
      
      Print('INFO', 'EventStore schema initialized');
    } catch (error) {
      Print('ERROR', `Failed to initialize schema: ${(error as Error).message}`);
      throw error;
    }
  }
  
  
  async recordEvent(event: Omit<StargateEvent, 'id' | 'timestamp'>): Promise<StargateEvent> {
    const timestamp = Date.now();
    
    try {
      const result = await this.db.execute({
        sql: 'INSERT INTO events (event_type, entity_id, payload, timestamp, client_id, sequence_num) VALUES (?, ?, ?, ?, ?, ?)',
        args: [
          event.event_type,
          event.entity_id,
          JSON.stringify(event.payload),
          timestamp,
          event.client_id,
          event.sequence_num
        ]
      });
      
      const recordedEvent: StargateEvent = {
        id: result.lastInsertRowid as number,
        timestamp,
        ...event
      };
      
      Print('DEBUG', `Event recorded: ${event.event_type} for ${event.entity_id} (ID: ${recordedEvent.id})`);
      return recordedEvent;
    } catch (error) {
      Print('ERROR', `Failed to record event: ${(error as Error).message}`);
      throw error;
    }
  }
  
  async getAllEvents(): Promise<StargateEvent[]> {
    try {
      const result = await this.db.execute('SELECT * FROM events ORDER BY timestamp, sequence_num');
      return result.rows.map(row => ({
        ...row,
        payload: JSON.parse(row.payload as string)
      })) as StargateEvent[];
    } catch (error) {
      Print('ERROR', `Failed to get all events: ${(error as Error).message}`);
      throw error;
    }
  }
  
  async getEventsSince(timestamp: number): Promise<StargateEvent[]> {
    try {
      const result = await this.db.execute({
        sql: 'SELECT * FROM events WHERE timestamp >= ? ORDER BY timestamp, sequence_num',
        args: [timestamp]
      });
      return result.rows.map(row => ({
        ...row,
        payload: JSON.parse(row.payload as string)
      })) as StargateEvent[];
    } catch (error) {
      Print('ERROR', `Failed to get events since ${timestamp}: ${(error as Error).message}`);
      throw error;
    }
  }
  
  async getEventsBefore(timestamp: number): Promise<StargateEvent[]> {
    try {
      const result = await this.db.execute({
        sql: 'SELECT * FROM events WHERE timestamp < ? ORDER BY timestamp, sequence_num',
        args: [timestamp]
      });
      return result.rows.map(row => ({
        ...row,
        payload: JSON.parse(row.payload as string)
      })) as StargateEvent[];
    } catch (error) {
      Print('ERROR', `Failed to get events before ${timestamp}: ${(error as Error).message}`);
      throw error;
    }
  }
  
  async getEventById(id: number): Promise<StargateEvent | null> {
    try {
      const result = await this.db.execute({
        sql: 'SELECT * FROM events WHERE id = ?',
        args: [id]
      });
      
      if (result.rows.length === 0) return null;
      
      const row = result.rows[0];
      return {
        ...row,
        payload: JSON.parse(row.payload as string)
      } as StargateEvent;
    } catch (error) {
      Print('ERROR', `Failed to get event by ID ${id}: ${(error as Error).message}`);
      throw error;
    }
  }
  
  async getEventCount(): Promise<number> {
    try {
      const result = await this.db.execute('SELECT COUNT(*) as count FROM events');
      return result.rows[0].count as number;
    } catch (error) {
      Print('ERROR', `Failed to get event count: ${(error as Error).message}`);
      throw error;
    }
  }
  
  async close(): Promise<void> {
    try {
      await this.db.close();
      Print('INFO', 'EventStore database connection closed');
    } catch (error) {
      Print('ERROR', `Failed to close EventStore database: ${(error as Error).message}`);
    }
  }
}