import { DI } from 'aurelia';
import type { FileInfo, SystemState, TimeRange, TimelineEvent } from '../../shared/types';

// Forward declarations for circular dependency resolution
declare class WebSocketService {}
declare class FileService {}
declare class PersistenceService {}
declare class RequestEncoderService {}

// WebSocket Service
export interface IWebSocketService {
  readonly isConnected: boolean;
  send<T>(data: T): void;
  onMessage<T>(callback: (data: T) => void): () => void;
  dispose(): void;
}

export const IWebSocketService = DI.createInterface<IWebSocketService>(
  'IWebSocketService',
  x => x.singleton(WebSocketService)
);

// File Service
export interface IFileService {
  getFileList(): Promise<FileInfo[]>;
  uploadFile(file: File): Promise<void>;
  downloadFile(filename: string): void;
  deleteFile(filename: string): Promise<boolean>;
}

export const IFileService = DI.createInterface<IFileService>(
  'IFileService',
  x => x.singleton(FileService)
);

// Persistence Service (for future timeline)
export interface IPersistenceService {
  getTimelineRange(): Promise<TimeRange>;
  getStatesAt(timestamp: number): Promise<SystemState>;
  recordEvent(event: Omit<TimelineEvent, 'id' | 'timestamp'>): Promise<void>;
}

export const IPersistenceService = DI.createInterface<IPersistenceService>(
  'IPersistenceService',
  x => x.singleton(PersistenceService)
);

// Request Encoder Service
export interface IRequestEncoderService {
  encode<T>(success: boolean, body: T): string;
  decode<T>(reqHeader: string): { success: boolean; body: T };
}

export const IRequestEncoderService = DI.createInterface<IRequestEncoderService>(
  'IRequestEncoderService',
  x => x.singleton(RequestEncoderService)
);