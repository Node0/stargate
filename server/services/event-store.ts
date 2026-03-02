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
  event_type: 'text_change' | 'file_upload' | 'file_delete' | 'file_archive';
  entity_id: string;
  payload: any;
  timestamp: number;
  client_id: string;
  sequence_num: number;
}

export interface FileRecord {
  id?: number;
  stored_name: string;
  display_name: string;
  hash: string;
  size: number;
  uploader_hostname: string;
  upload_timestamp: number;
  archived: boolean;
  archived_timestamp: number | null;
  deleted: boolean;
  deleted_timestamp: number | null;
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

      // Create files table for tracking file lifecycle (archive/delete status)
      await this.db.execute(`
        CREATE TABLE IF NOT EXISTS files (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          stored_name TEXT NOT NULL UNIQUE,
          display_name TEXT NOT NULL,
          hash TEXT NOT NULL,
          size INTEGER NOT NULL,
          uploader_hostname TEXT,
          upload_timestamp INTEGER NOT NULL,
          archived INTEGER DEFAULT 0,
          archived_timestamp INTEGER,
          deleted INTEGER DEFAULT 0,
          deleted_timestamp INTEGER
        );
      `);

      await this.db.execute(`CREATE INDEX IF NOT EXISTS idx_files_stored_name ON files(stored_name);`);
      await this.db.execute(`CREATE INDEX IF NOT EXISTS idx_files_hash ON files(hash);`);
      await this.db.execute(`CREATE INDEX IF NOT EXISTS idx_files_archived ON files(archived);`);
      await this.db.execute(`CREATE INDEX IF NOT EXISTS idx_files_deleted ON files(deleted);`);

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
  
  // File record management methods

  async createFileRecord(fileInfo: {
    storedName: string;
    displayName: string;
    hash: string;
    size: number;
    uploaderHostname: string;
  }): Promise<FileRecord> {
    const timestamp = Date.now();

    try {
      await this.db.execute({
        sql: `INSERT INTO files (stored_name, display_name, hash, size, uploader_hostname, upload_timestamp, archived, deleted)
              VALUES (?, ?, ?, ?, ?, ?, 0, 0)`,
        args: [
          fileInfo.storedName,
          fileInfo.displayName,
          fileInfo.hash,
          fileInfo.size,
          fileInfo.uploaderHostname,
          timestamp
        ]
      });

      Print('DEBUG', `File record created: ${fileInfo.displayName} (${fileInfo.storedName})`);

      return {
        stored_name: fileInfo.storedName,
        display_name: fileInfo.displayName,
        hash: fileInfo.hash,
        size: fileInfo.size,
        uploader_hostname: fileInfo.uploaderHostname,
        upload_timestamp: timestamp,
        archived: false,
        archived_timestamp: null,
        deleted: false,
        deleted_timestamp: null
      };
    } catch (error) {
      Print('ERROR', `Failed to create file record: ${(error as Error).message}`);
      throw error;
    }
  }

  async archiveFileRecord(storedName: string): Promise<FileRecord | null> {
    const timestamp = Date.now();

    try {
      await this.db.execute({
        sql: `UPDATE files SET archived = 1, archived_timestamp = ? WHERE stored_name = ?`,
        args: [timestamp, storedName]
      });

      const result = await this.db.execute({
        sql: 'SELECT * FROM files WHERE stored_name = ?',
        args: [storedName]
      });

      if (result.rows.length === 0) return null;

      const row = result.rows[0];
      Print('DEBUG', `File record archived: ${storedName}`);

      return {
        id: row.id as number,
        stored_name: row.stored_name as string,
        display_name: row.display_name as string,
        hash: row.hash as string,
        size: row.size as number,
        uploader_hostname: row.uploader_hostname as string,
        upload_timestamp: row.upload_timestamp as number,
        archived: Boolean(row.archived),
        archived_timestamp: row.archived_timestamp as number | null,
        deleted: Boolean(row.deleted),
        deleted_timestamp: row.deleted_timestamp as number | null
      };
    } catch (error) {
      Print('ERROR', `Failed to archive file record: ${(error as Error).message}`);
      throw error;
    }
  }

  async deleteFileRecord(storedName: string): Promise<FileRecord | null> {
    const timestamp = Date.now();

    try {
      await this.db.execute({
        sql: `UPDATE files SET deleted = 1, deleted_timestamp = ? WHERE stored_name = ?`,
        args: [timestamp, storedName]
      });

      const result = await this.db.execute({
        sql: 'SELECT * FROM files WHERE stored_name = ?',
        args: [storedName]
      });

      if (result.rows.length === 0) return null;

      const row = result.rows[0];
      Print('DEBUG', `File record marked as deleted: ${storedName}`);

      return {
        id: row.id as number,
        stored_name: row.stored_name as string,
        display_name: row.display_name as string,
        hash: row.hash as string,
        size: row.size as number,
        uploader_hostname: row.uploader_hostname as string,
        upload_timestamp: row.upload_timestamp as number,
        archived: Boolean(row.archived),
        archived_timestamp: row.archived_timestamp as number | null,
        deleted: Boolean(row.deleted),
        deleted_timestamp: row.deleted_timestamp as number | null
      };
    } catch (error) {
      Print('ERROR', `Failed to delete file record: ${(error as Error).message}`);
      throw error;
    }
  }

  async getFileRecord(storedName: string): Promise<FileRecord | null> {
    try {
      const result = await this.db.execute({
        sql: 'SELECT * FROM files WHERE stored_name = ?',
        args: [storedName]
      });

      if (result.rows.length === 0) return null;

      const row = result.rows[0];
      return {
        id: row.id as number,
        stored_name: row.stored_name as string,
        display_name: row.display_name as string,
        hash: row.hash as string,
        size: row.size as number,
        uploader_hostname: row.uploader_hostname as string,
        upload_timestamp: row.upload_timestamp as number,
        archived: Boolean(row.archived),
        archived_timestamp: row.archived_timestamp as number | null,
        deleted: Boolean(row.deleted),
        deleted_timestamp: row.deleted_timestamp as number | null
      };
    } catch (error) {
      Print('ERROR', `Failed to get file record: ${(error as Error).message}`);
      throw error;
    }
  }

  async getActiveFileRecords(): Promise<FileRecord[]> {
    try {
      const result = await this.db.execute(
        'SELECT * FROM files WHERE deleted = 0 AND archived = 0 ORDER BY upload_timestamp DESC'
      );

      return result.rows.map(row => ({
        id: row.id as number,
        stored_name: row.stored_name as string,
        display_name: row.display_name as string,
        hash: row.hash as string,
        size: row.size as number,
        uploader_hostname: row.uploader_hostname as string,
        upload_timestamp: row.upload_timestamp as number,
        archived: Boolean(row.archived),
        archived_timestamp: row.archived_timestamp as number | null,
        deleted: Boolean(row.deleted),
        deleted_timestamp: row.deleted_timestamp as number | null
      }));
    } catch (error) {
      Print('ERROR', `Failed to get active file records: ${(error as Error).message}`);
      throw error;
    }
  }

  async getArchivedFileRecords(): Promise<FileRecord[]> {
    try {
      const result = await this.db.execute(
        'SELECT * FROM files WHERE archived = 1 AND deleted = 0 ORDER BY archived_timestamp DESC'
      );

      return result.rows.map(row => ({
        id: row.id as number,
        stored_name: row.stored_name as string,
        display_name: row.display_name as string,
        hash: row.hash as string,
        size: row.size as number,
        uploader_hostname: row.uploader_hostname as string,
        upload_timestamp: row.upload_timestamp as number,
        archived: Boolean(row.archived),
        archived_timestamp: row.archived_timestamp as number | null,
        deleted: Boolean(row.deleted),
        deleted_timestamp: row.deleted_timestamp as number | null
      }));
    } catch (error) {
      Print('ERROR', `Failed to get archived file records: ${(error as Error).message}`);
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