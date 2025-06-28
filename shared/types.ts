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

// Persistence types (for future timeline feature)
export interface TimelineEvent {
  id?: number;
  event_type: 'text_change' | 'file_upload' | 'file_delete';
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

export interface RegisterState {
  id: number;
  content: string;
}

export interface SystemState {
  registers: RegisterState[];
  files: FileInfo[];
  timestamp: number;
}