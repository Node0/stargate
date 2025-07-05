import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocketService, WebSocketConfig, TextChangeMessage, FileListUpdateMessage } from '../../../src/services/websocket.service';

// Mock BrowserPrint
vi.mock('../../../src/browser-logger', () => ({
  BrowserPrint: vi.fn()
}));

// Mock browser APIs
global.Event = class MockEvent {
  constructor(public type: string, public eventInitDict?: EventInit) {}
} as any;

global.CloseEvent = class MockCloseEvent extends global.Event {
  constructor(type: string, public eventInitDict?: { code?: number; reason?: string }) {
    super(type, eventInitDict);
    this.code = eventInitDict?.code || 1000;
    this.reason = eventInitDict?.reason || '';
  }
  code: number;
  reason: string;
} as any;

global.MessageEvent = class MockMessageEvent extends global.Event {
  constructor(type: string, public eventInitDict?: { data?: any }) {
    super(type, eventInitDict);
    this.data = eventInitDict?.data;
  }
  data: any;
} as any;

global.window = {
  setTimeout: vi.fn().mockImplementation((fn, delay) => setTimeout(fn, delay)),
  clearTimeout: vi.fn().mockImplementation((id) => clearTimeout(id)),
} as any;

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState: number = MockWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(public url: string) {
    // Simulate async connection - immediately set to connecting, then queue opening
    this.readyState = MockWebSocket.CONNECTING;
    
    // Use setTimeout that will be handled by fake timers
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.(new global.Event('open'));
    }, 0);
  }

  send(data: string) {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket is not open');
    }
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new global.CloseEvent('close', { code: 1000, reason: 'Normal closure' }));
  }

  // Test helpers
  simulateMessage(data: any) {
    if (this.readyState === MockWebSocket.OPEN) {
      this.onmessage?.(new global.MessageEvent('message', { data: JSON.stringify(data) }));
    }
  }

  simulateError() {
    this.onerror?.(new global.Event('error'));
  }

  simulateClose(code: number = 1000, reason: string = 'Normal closure') {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new global.CloseEvent('close', { code, reason }));
  }
}

// Mock global WebSocket
global.WebSocket = MockWebSocket as any;

describe('WebSocketService', () => {
  let service: WebSocketService;
  let mockWebSocket: MockWebSocket;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    
    // Mock location for WebSocket URL construction
    Object.defineProperty(global, 'location', {
      value: { host: 'localhost:3000' },
      writable: true,
      configurable: true
    });
    
    // Intercept WebSocket constructor
    const originalWebSocket = global.WebSocket;
    global.WebSocket = vi.fn((url: string) => {
      mockWebSocket = new MockWebSocket(url);
      return mockWebSocket;
    }) as any;
    
    service = new WebSocketService();
  });

  afterEach(() => {
    if (service) {
      service.disconnect();
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create service with default config', () => {
      expect(service).toBeDefined();
    });

    it('should create service with custom config', () => {
      const config: WebSocketConfig = {
        url: 'wss://custom.host/websocket',
        reconnectDelay: 3000,
        maxReconnectAttempts: 5
      };

      const customService = new WebSocketService(config);
      expect(customService).toBeDefined();
    });

    it('should use default values for partial config', () => {
      const config: WebSocketConfig = {
        reconnectDelay: 1000
      };

      const customService = new WebSocketService(config);
      expect(customService).toBeDefined();
    });
  });

  describe('connect() method', () => {
    it('should create WebSocket connection', () => {
      service.connect();
      
      expect(global.WebSocket).toHaveBeenCalledWith(
        expect.stringContaining('wss://')
      );
    });

    it('should set up event handlers', () => {
      service.connect();
      
      expect(mockWebSocket.onopen).not.toBeNull();
      expect(mockWebSocket.onmessage).not.toBeNull();
      expect(mockWebSocket.onclose).not.toBeNull();
      expect(mockWebSocket.onerror).not.toBeNull();
    });

    it('should handle successful connection', async () => {
      const connectionHandler = vi.fn();
      service.onConnectionChange(connectionHandler);
      
      service.connect();
      
      // Wait for async connection
      await vi.runAllTimersAsync();
      
      expect(connectionHandler).toHaveBeenCalledWith(true);
    });

    it('should handle connection errors', () => {
      service.connect();
      
      expect(() => {
        mockWebSocket.simulateError();
      }).not.toThrow();
    });

    it('should reset reconnection attempts on successful connection', async () => {
      service.connect();
      
      // Wait for successful connection
      await vi.runAllTimersAsync();
      
      expect(mockWebSocket.readyState).toBe(MockWebSocket.OPEN);
    });
  });

  describe('message handling', () => {
    beforeEach(async () => {
      service.connect();
      await vi.runAllTimersAsync();
    });

    it('should receive and parse JSON messages', () => {
      const messageHandler = vi.fn();
      service.onMessage(messageHandler);
      
      const testMessage = { type: 'test', data: 'hello' };
      mockWebSocket.simulateMessage(testMessage);
      
      expect(messageHandler).toHaveBeenCalledWith(testMessage);
    });

    it('should handle multiple message handlers', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      
      service.onMessage(handler1);
      service.onMessage(handler2);
      
      const testMessage = { type: 'test' };
      mockWebSocket.simulateMessage(testMessage);
      
      expect(handler1).toHaveBeenCalledWith(testMessage);
      expect(handler2).toHaveBeenCalledWith(testMessage);
    });

    it('should handle invalid JSON gracefully', () => {
      const messageHandler = vi.fn();
      service.onMessage(messageHandler);
      
      // Simulate invalid JSON
      if (mockWebSocket.onmessage) {
        mockWebSocket.onmessage(new MessageEvent('message', { data: 'invalid json' }));
      }
      
      expect(messageHandler).not.toHaveBeenCalled();
    });

    it('should handle text change messages', () => {
      const messageHandler = vi.fn();
      service.onMessage(messageHandler);
      
      const textMessage: TextChangeMessage = {
        type: 'text_change',
        registerId: 1,
        content: 'Hello World',
        timestamp: Date.now()
      };
      
      mockWebSocket.simulateMessage(textMessage);
      
      expect(messageHandler).toHaveBeenCalledWith(textMessage);
    });

    it('should handle file list update messages', () => {
      const messageHandler = vi.fn();
      service.onMessage(messageHandler);
      
      const fileMessage: FileListUpdateMessage = {
        type: 'file_list_update',
        files: []
      };
      
      mockWebSocket.simulateMessage(fileMessage);
      
      expect(messageHandler).toHaveBeenCalledWith(fileMessage);
    });
  });

  describe('send() method', () => {
    beforeEach(async () => {
      service.connect();
      await vi.runAllTimersAsync();
    });

    it('should send messages when connected', () => {
      const spy = vi.spyOn(mockWebSocket, 'send');
      const testData = { type: 'test', message: 'hello' };
      
      const result = service.send(testData);
      
      expect(result).toBe(true);
      expect(spy).toHaveBeenCalledWith(JSON.stringify(testData));
    });

    it('should return false when not connected', () => {
      service.disconnect();
      
      const result = service.send({ type: 'test' });
      
      expect(result).toBe(false);
    });

    it('should handle send errors gracefully', () => {
      const spy = vi.spyOn(mockWebSocket, 'send').mockImplementation(() => {
        throw new Error('Send failed');
      });
      
      const result = service.send({ type: 'test' });
      
      expect(result).toBe(false);
      expect(spy).toHaveBeenCalled();
    });

    it('should send different data types', () => {
      const spy = vi.spyOn(mockWebSocket, 'send');
      
      service.send('string message');
      service.send({ object: 'message' });
      service.send(123);
      service.send(null);
      
      expect(spy).toHaveBeenCalledTimes(4);
      expect(spy).toHaveBeenNthCalledWith(1, '"string message"');
      expect(spy).toHaveBeenNthCalledWith(2, '{"object":"message"}');
      expect(spy).toHaveBeenNthCalledWith(3, '123');
      expect(spy).toHaveBeenNthCalledWith(4, 'null');
    });
  });

  describe('connection state management', () => {
    it('should track connection state correctly', async () => {
      expect(service.isConnected()).toBe(false);
      
      service.connect();
      expect(service.isConnected()).toBe(false); // Still connecting
      
      await vi.runAllTimersAsync();
      expect(service.isConnected()).toBe(true); // Now connected
    });

    it('should handle connection state changes', async () => {
      const connectionHandler = vi.fn();
      service.onConnectionChange(connectionHandler);
      
      service.connect();
      await vi.runAllTimersAsync();
      
      mockWebSocket.simulateClose();
      
      expect(connectionHandler).toHaveBeenCalledWith(true);  // Connected
      expect(connectionHandler).toHaveBeenCalledWith(false); // Disconnected
    });

    it('should notify existing connection state to new handlers', () => {
      const handler = vi.fn();
      
      service.onConnectionChange(handler);
      
      expect(handler).toHaveBeenCalledWith(false); // Initial state
    });

    it('should remove connection handlers correctly', async () => {
      const handler = vi.fn();
      
      const unsubscribe = service.onConnectionChange(handler);
      service.connect();
      await vi.runAllTimersAsync();
      
      handler.mockClear();
      unsubscribe();
      
      mockWebSocket.simulateClose();
      
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('reconnection logic', () => {
    it('should schedule reconnection on close', async () => {
      service.connect();
      await vi.runAllTimersAsync();
      
      mockWebSocket.simulateClose(1006, 'Connection lost');
      
      expect(global.WebSocket).toHaveBeenCalledTimes(1);
      
      // Advance timers to trigger reconnection
      await vi.runAllTimersAsync();
      
      expect(global.WebSocket).toHaveBeenCalledTimes(2);
    });

    it('should implement exponential backoff', async () => {
      const reconnectDelay = 1000;
      const customService = new WebSocketService({ reconnectDelay });
      
      customService.connect();
      await vi.runAllTimersAsync();
      
      // Simulate multiple disconnections
      mockWebSocket.simulateClose();
      await vi.advanceTimersByTimeAsync(reconnectDelay);
      
      mockWebSocket.simulateClose();
      await vi.advanceTimersByTimeAsync(reconnectDelay * 2);
      
      mockWebSocket.simulateClose();
      await vi.advanceTimersByTimeAsync(reconnectDelay * 3);
      
      expect(global.WebSocket).toHaveBeenCalledTimes(4); // Initial + 3 reconnections
    });

    it('should stop reconnecting after max attempts', async () => {
      const customService = new WebSocketService({ 
        maxReconnectAttempts: 2,
        reconnectDelay: 100
      });
      
      customService.connect();
      await vi.runAllTimersAsync();
      
      // Simulate failed reconnections
      for (let i = 0; i < 3; i++) {
        mockWebSocket.simulateClose();
        await vi.runAllTimersAsync();
      }
      
      expect(global.WebSocket).toHaveBeenCalledTimes(3); // Initial + 2 attempts
    });

    it('should not reconnect if explicitly disconnected', async () => {
      service.connect();
      await vi.runAllTimersAsync();
      
      service.disconnect();
      
      await vi.runAllTimersAsync();
      
      expect(global.WebSocket).toHaveBeenCalledTimes(1); // Only initial connection
    });
  });

  describe('message handler management', () => {
    it('should add and remove message handlers', () => {
      const handler = vi.fn();
      
      const unsubscribe = service.onMessage(handler);
      expect(unsubscribe).toBeInstanceOf(Function);
      
      unsubscribe();
      
      // Handler should be removed
      expect(() => unsubscribe()).not.toThrow();
    });

    it('should handle removal of non-existent handler', () => {
      const handler = vi.fn();
      
      const unsubscribe = service.onMessage(handler);
      unsubscribe();
      unsubscribe(); // Second call should be safe
      
      expect(() => unsubscribe()).not.toThrow();
    });
  });

  describe('file operations', () => {
    beforeEach(async () => {
      service.connect();
      await vi.runAllTimersAsync();
    });

    it('should send file chunks correctly', () => {
      const spy = vi.spyOn(mockWebSocket, 'send');
      const fileId = 'test-file-123';
      const chunkData = { chunk: 1, data: 'chunk content' };
      
      const result = service.sendFileChunk(fileId, chunkData);
      
      expect(result).toBe(true);
      expect(spy).toHaveBeenCalledWith(JSON.stringify({
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

  describe('ping/pong functionality', () => {
    beforeEach(async () => {
      service.connect();
      await vi.runAllTimersAsync();
    });

    it('should send ping and receive pong', async () => {
      const spy = vi.spyOn(mockWebSocket, 'send');
      
      const pingPromise = service.ping();
      
      expect(spy).toHaveBeenCalledWith(JSON.stringify({
        type: 'ping',
        timestamp: expect.any(Number)
      }));
      
      // Simulate pong response
      mockWebSocket.simulateMessage({ type: 'pong' });
      
      const result = await pingPromise;
      expect(result).toBe(true);
    });

    it('should timeout if no pong received', async () => {
      vi.spyOn(mockWebSocket, 'send');
      
      const pingPromise = service.ping();
      
      // Advance time past timeout
      vi.advanceTimersByTime(6000);
      
      const result = await pingPromise;
      expect(result).toBe(false);
    });

    it('should return false if not connected', async () => {
      service.disconnect();
      
      const result = await service.ping();
      expect(result).toBe(false);
    });

    it('should handle multiple concurrent pings', async () => {
      const spy = vi.spyOn(mockWebSocket, 'send');
      
      const ping1 = service.ping();
      const ping2 = service.ping();
      
      // Simulate pong responses
      mockWebSocket.simulateMessage({ type: 'pong' });
      mockWebSocket.simulateMessage({ type: 'pong' });
      
      const [result1, result2] = await Promise.all([ping1, ping2]);
      
      expect(result1).toBe(true);
      expect(result2).toBe(true);
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });

  describe('disconnect() method', () => {
    it('should close WebSocket connection', async () => {
      service.connect();
      await vi.runAllTimersAsync();
      
      const spy = vi.spyOn(mockWebSocket, 'close');
      
      service.disconnect();
      
      expect(spy).toHaveBeenCalled();
    });

    it('should clear reconnection timers', async () => {
      service.connect();
      await vi.runAllTimersAsync();
      
      mockWebSocket.simulateClose();
      service.disconnect();
      
      await vi.runAllTimersAsync();
      
      // Should not attempt reconnection
      expect(global.WebSocket).toHaveBeenCalledTimes(1);
    });

    it('should clear all handlers', async () => {
      const messageHandler = vi.fn();
      const connectionHandler = vi.fn();
      
      service.onMessage(messageHandler);
      service.onConnectionChange(connectionHandler);
      
      service.connect();
      await vi.runAllTimersAsync();
      
      service.disconnect();
      
      // Handlers should be cleared
      mockWebSocket.simulateMessage({ type: 'test' });
      
      expect(messageHandler).not.toHaveBeenCalled();
    });

    it('should be safe to call multiple times', () => {
      service.connect();
      
      expect(() => {
        service.disconnect();
        service.disconnect();
        service.disconnect();
      }).not.toThrow();
    });

    it('should be safe to call before connect', () => {
      expect(() => {
        service.disconnect();
      }).not.toThrow();
    });
  });

  describe('error handling and edge cases', () => {
    it('should handle WebSocket constructor errors', () => {
      global.WebSocket = vi.fn(() => {
        throw new Error('WebSocket creation failed');
      }) as any;
      
      expect(() => {
        service.connect();
      }).not.toThrow();
    });

    it('should handle rapid connect/disconnect cycles', async () => {
      for (let i = 0; i < 10; i++) {
        service.connect();
        await vi.runAllTimersAsync();
        service.disconnect();
      }
      
      expect(() => {
        service.connect();
      }).not.toThrow();
    });

    it('should handle message events when handlers throw errors', async () => {
      const errorHandler = vi.fn(() => {
        throw new Error('Handler error');
      });
      const goodHandler = vi.fn();
      
      service.onMessage(errorHandler);
      service.onMessage(goodHandler);
      
      service.connect();
      await vi.runAllTimersAsync();
      
      expect(() => {
        mockWebSocket.simulateMessage({ type: 'test' });
      }).not.toThrow();
      
      expect(errorHandler).toHaveBeenCalled();
      expect(goodHandler).toHaveBeenCalled();
    });

    it('should handle connection change handlers that throw errors', async () => {
      const errorHandler = vi.fn(() => {
        throw new Error('Connection handler error');
      });
      const goodHandler = vi.fn();
      
      service.onConnectionChange(errorHandler);
      service.onConnectionChange(goodHandler);
      
      expect(() => {
        service.connect();
      }).not.toThrow();
    });
  });

  describe('configuration handling', () => {
    it('should handle empty configuration', () => {
      const emptyConfigService = new WebSocketService({});
      expect(emptyConfigService).toBeDefined();
    });

    it('should use custom URL correctly', () => {
      const customUrl = 'wss://example.com/custom-path';
      const customService = new WebSocketService({ url: customUrl });
      
      customService.connect();
      
      expect(global.WebSocket).toHaveBeenCalledWith(customUrl);
    });

    it('should build default URL from location', () => {
      // Location is already mocked in beforeEach
      service.connect();
      
      expect(global.WebSocket).toHaveBeenCalledWith(
        'wss://localhost:3000/_data_stream/app_logging_data'
      );
    });
  });
});