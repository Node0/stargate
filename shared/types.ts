// Message types for WebSocket communication
export interface TextChangeMessage {
  type: 'text_change';
  index: number;
  content: string;
}

export interface FileListUpdateMessage {
  type: 'file_list_update';
  files: FileInfo[];
}

export interface ConfigUpdateMessage {
  type: 'config_update';
  config: {
    oversize_file_in_mb: number;
  };
}

export type WebSocketMessage = 
  | TextChangeMessage 
  | FileListUpdateMessage 
  | ConfigUpdateMessage;

// File system types
export interface FileInfo {
  displayName: string;
  storedName: string;
  timestamp: number;
  uploaderHostname: string;
  size: number;
  hash: string;
}

export interface FileChunkData {
  fileId: string;
  chunkIndex: number;
  totalChunks: number;
  data: string;
  metadata: {
    filename: string;
    totalSize?: number;
  };
}

// REQ header pattern
export interface REQPayload<T = any> {
  success: boolean;
  body: T;
}

export interface RegisterState {
  id: number;
  content: string;
}

// Timeline/Persistence types (for future implementation)
export interface TimelineEvent {
  id?: number;
  event_type: 'text_change' | 'file_upload' | 'file_delete' | 'register_created';
  entity_id: string;
  payload: any;
  timestamp: number;
  client_id: string;
  sequence_num?: number;
}

export interface TimeRange {
  start: number;
  end: number;
}

export interface SystemSnapshot {
  registers: RegisterState[];
  files: FileInfo[];
  timestamp: number;
  version: string;
}

// Interface for future timeline store
export interface TimelineStore {
  recordEvent(event: TimelineEvent): Promise<void>;
  getSnapshot(timestamp: number): Promise<SystemSnapshot>;
  getEvents(range: TimeRange): Promise<TimelineEvent[]>;
  streamEvents(from: number, to: number): AsyncIterable<TimelineEvent>;
}

// WebSocket message types for timeline
export interface TimelineMessage {
  type: 'timeline_event' | 'timeline_request' | 'timeline_response';
  payload: TimelineEvent | TimeRange | SystemSnapshot;
}