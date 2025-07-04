import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocketService, WebSocketConfig } from '../../../src/services/websocket.service';

// Mock BrowserPrint
vi.mock('../../../src/browser-logger', () => ({
  BrowserPrint: vi.fn()
}));

// Mock browser globals
Object.defineProperty(global, 'location', {
  value: { host: 'localhost:3000' },
  writable: true,
  configurable: true
});

Object.defineProperty(global, 'window', {
  value: {
    setTimeout: global.setTimeout,
    clearTimeout: global.clearTimeout,
  },
  writable: true,
  configurable: true
});

// Simple WebSocket mock
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen: ((event: any) => void) | null = null;
  onclose: ((event: any) => void) | null = null;
  onmessage: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  
  constructor(public url: string) {}
  
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
  });
  
  // Test helpers
  connect() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.({ type: 'open' });
  }
  
  simulateMessage(data: any) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
  
  simulateClose() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code: 1000, reason: 'Normal closure' });
  }
}

// Set static constants on the constructor
MockWebSocket.CONNECTING = 0;
MockWebSocket.OPEN = 1;
MockWebSocket.CLOSING = 2;
MockWebSocket.CLOSED = 3;

global.WebSocket = MockWebSocket as any;

describe('WebSocketService (Simplified)', () => {
  let service: WebSocketService;
  let mockWs: MockWebSocket;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock WebSocket constructor
    global.WebSocket = vi.fn((url) => {
      mockWs = new MockWebSocket(url);
      return mockWs;
    }) as any;
    
    service = new WebSocketService();
  });

  afterEach(() => {
    if (service) {
      service.disconnect();
    }
  });

  describe('Core Functionality', () => {
    it('should create service instance', () => {
      expect(service).toBeDefined();
      expect(service.isConnected()).toBe(false);
    });

    it('should establish WebSocket connection', () => {
      service.connect();
      
      expect(global.WebSocket).toHaveBeenCalledWith(
        expect.stringContaining('wss://localhost:3000')
      );
    });

    it('should handle connection state changes', () => {
      const handler = vi.fn();
      service.onConnectionChange(handler);
      
      service.connect();
      mockWs.connect(); // Simulate successful connection
      
      expect(handler).toHaveBeenCalledWith(true);
      expect(service.isConnected()).toBe(true);
    });

    it('should send messages when connected', () => {
      service.connect();
      mockWs.connect(); // Simulate connection
      
      const testData = { type: 'test', message: 'hello' };
      const result = service.send(testData);
      
      expect(result).toBe(true);
      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify(testData));
    });

    it('should return false when sending while disconnected', () => {
      const result = service.send({ type: 'test' });
      expect(result).toBe(false);
    });

    it('should receive and parse messages', () => {
      const messageHandler = vi.fn();
      service.onMessage(messageHandler);
      
      service.connect();
      mockWs.connect();
      
      const testMessage = { type: 'test', data: 'hello' };
      mockWs.simulateMessage(testMessage);
      
      expect(messageHandler).toHaveBeenCalledWith(testMessage);
    });

    it('should handle multiple message handlers', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      
      service.onMessage(handler1);
      service.onMessage(handler2);
      
      service.connect();
      mockWs.connect();
      
      const testMessage = { type: 'test' };
      mockWs.simulateMessage(testMessage);
      
      expect(handler1).toHaveBeenCalledWith(testMessage);
      expect(handler2).toHaveBeenCalledWith(testMessage);
    });

    it('should remove message handlers correctly', () => {
      const handler = vi.fn();
      
      const unsubscribe = service.onMessage(handler);
      unsubscribe();
      
      service.connect();
      mockWs.connect();
      mockWs.simulateMessage({ type: 'test' });
      
      expect(handler).not.toHaveBeenCalled();
    });

    it('should handle connection changes', () => {
      const connectionHandler = vi.fn();
      service.onConnectionChange(connectionHandler);
      
      service.connect();
      mockWs.connect();
      
      expect(connectionHandler).toHaveBeenCalledWith(true);
      
      mockWs.simulateClose();
      expect(connectionHandler).toHaveBeenCalledWith(false);
    });

    it('should clean up on disconnect', () => {
      service.connect();
      mockWs.connect();
      
      service.disconnect();
      
      expect(mockWs.close).toHaveBeenCalled();
      expect(service.isConnected()).toBe(false);
    });
  });

  describe('Message Types', () => {
    beforeEach(() => {
      service.connect();
      mockWs.connect();
    });

    it('should handle text change messages', () => {
      const handler = vi.fn();
      service.onMessage(handler);
      
      const textMessage = {
        type: 'text_change',
        registerId: 1,
        content: 'Hello World',
        timestamp: Date.now()
      };
      
      mockWs.simulateMessage(textMessage);
      expect(handler).toHaveBeenCalledWith(textMessage);
    });

    it('should handle file list update messages', () => {
      const handler = vi.fn();
      service.onMessage(handler);
      
      const fileMessage = {
        type: 'file_list_update',
        files: []
      };
      
      mockWs.simulateMessage(fileMessage);
      expect(handler).toHaveBeenCalledWith(fileMessage);
    });
  });

  describe('File Operations', () => {
    beforeEach(() => {
      service.connect();
      mockWs.connect();
    });

    it('should send file chunks', () => {
      const fileId = 'test-file-123';
      const chunkData = { chunk: 1, data: 'chunk content' };
      
      const result = service.sendFileChunk(fileId, chunkData);
      
      expect(result).toBe(true);
      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({
        type: 'file_chunk',
        req: btoa(JSON.stringify({ success: true, body: chunkData }))
      }));
    });

    it('should handle file chunk send when disconnected', () => {
      service.disconnect();
      
      const result = service.sendFileChunk('test-file', {});
      expect(result).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid JSON gracefully', () => {
      const messageHandler = vi.fn();
      service.onMessage(messageHandler);
      
      service.connect();
      mockWs.connect();
      
      // Simulate invalid JSON
      mockWs.onmessage?.({ data: 'invalid json' });
      
      expect(messageHandler).not.toHaveBeenCalled();
    });

    it('should handle send errors gracefully', () => {
      service.connect();
      mockWs.connect();
      
      mockWs.send.mockImplementation(() => {
        throw new Error('Send failed');
      });
      
      const result = service.send({ type: 'test' });
      expect(result).toBe(false);
    });

    it('should be safe to disconnect multiple times', () => {
      service.connect();
      
      expect(() => {
        service.disconnect();
        service.disconnect();
        service.disconnect();
      }).not.toThrow();
    });
  });

  describe('Configuration', () => {
    it('should use custom configuration', () => {
      const config: WebSocketConfig = {
        url: 'wss://custom.host/websocket',
        reconnectDelay: 3000,
        maxReconnectAttempts: 5
      };

      const customService = new WebSocketService(config);
      expect(customService).toBeDefined();
    });

    it('should use custom URL when provided', () => {
      const customUrl = 'wss://example.com/custom-path';
      const customService = new WebSocketService({ url: customUrl });
      
      customService.connect();
      
      expect(global.WebSocket).toHaveBeenCalledWith(customUrl);
    });
  });

  describe('Ping/Pong', () => {
    beforeEach(() => {
      service.connect();
      mockWs.connect();
    });

    it('should send ping messages', async () => {
      const pingPromise = service.ping();
      
      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({
        type: 'ping',
        timestamp: expect.any(Number)
      }));
      
      // Simulate pong response
      mockWs.simulateMessage({ type: 'pong' });
      
      const result = await pingPromise;
      expect(result).toBe(true);
    });

    it('should return false when not connected', async () => {
      service.disconnect();
      
      const result = await service.ping();
      expect(result).toBe(false);
    });
  });
});