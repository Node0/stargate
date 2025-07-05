import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import WS from 'vitest-websocket-mock';
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

// Also set as global for Node.js environment
global.window = {
  setTimeout: global.setTimeout,
  clearTimeout: global.clearTimeout,
} as any;

describe('WebSocketService (Simplified)', () => {
  let service: WebSocketService;
  let server: WS;
  const testUrl = 'ws://localhost:3000/_data_stream/app_logging_data';

  beforeEach(() => {
    vi.clearAllMocks();
    server = new WS(testUrl);
    service = new WebSocketService({ url: testUrl });
  });

  afterEach(() => {
    if (service) {
      service.disconnect();
    }
    WS.clean();
  });

  describe('Core Functionality', () => {
    it('should create service instance', () => {
      expect(service).toBeDefined();
      expect(service.isConnected()).toBe(false);
    });

    it('should establish WebSocket connection', async () => {
      service.connect();
      await server.connected;
      expect(service.isConnected()).toBe(true);
    });

    it('should handle connection state changes', async () => {
      const handler = vi.fn();
      service.onConnectionChange(handler);
      
      service.connect();
      await server.connected;
      
      expect(handler).toHaveBeenCalledWith(true);
      expect(service.isConnected()).toBe(true);
    });

    it('should send messages when connected', async () => {
      service.connect();
      await server.connected;
      
      const testData = { type: 'test', message: 'hello' };
      const result = service.send(testData);
      
      expect(result).toBe(true);
      await expect(server).toReceiveMessage(JSON.stringify(testData));
    });

    it('should return false when sending while disconnected', () => {
      const result = service.send({ type: 'test' });
      expect(result).toBe(false);
    });

    it('should receive and parse messages', async () => {
      const messageHandler = vi.fn();
      service.onMessage(messageHandler);
      
      service.connect();
      await server.connected;
      
      const testMessage = { type: 'text_change', content: 'hello', registerId: 1, timestamp: Date.now() };
      server.send(testMessage);
      
      expect(messageHandler).toHaveBeenCalledWith(testMessage);
    });

    it('should handle multiple message handlers', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      service.onMessage(handler1);
      service.onMessage(handler2);
      
      service.connect();
      await server.connected;
      
      const testMessage = { type: 'test' };
      server.send(testMessage);
      
      expect(handler1).toHaveBeenCalledWith(testMessage);
      expect(handler2).toHaveBeenCalledWith(testMessage);
    });

    it('should remove message handlers correctly', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const unsubscribe1 = service.onMessage(handler1);
      service.onMessage(handler2);
      
      service.connect();
      await server.connected;
      
      // Remove first handler
      unsubscribe1();
      
      const testMessage = { type: 'test' };
      server.send(testMessage);
      
      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalledWith(testMessage);
    });

    it('should handle connection changes', async () => {
      const connectionHandler = vi.fn();
      service.onConnectionChange(connectionHandler);
      
      service.connect();
      await server.connected;
      
      expect(connectionHandler).toHaveBeenCalledWith(true);
      
      service.disconnect();
      expect(connectionHandler).toHaveBeenCalledWith(false);
    });

    it('should clean up on disconnect', async () => {
      const messageHandler = vi.fn();
      const connectionHandler = vi.fn();
      
      service.onMessage(messageHandler);
      service.onConnectionChange(connectionHandler);
      
      service.connect();
      await server.connected;
      
      service.disconnect();
      
      // After disconnect, handlers should not be called
      const testMessage = { type: 'test' };
      server.send(testMessage);
      
      expect(messageHandler).not.toHaveBeenCalledWith(testMessage);
    });
  });

  describe('Message Types', () => {
    beforeEach(async () => {
      service.connect();
      await server.connected;
    });

    it('should handle text change messages', async () => {
      const messageHandler = vi.fn();
      service.onMessage(messageHandler);
      
      const textMessage = {
        type: 'text_change',
        registerId: 123,
        content: 'Hello world',
        timestamp: Date.now()
      };
      
      server.send(textMessage);
      
      expect(messageHandler).toHaveBeenCalledWith(textMessage);
    });

    it('should handle file list update messages', async () => {
      const messageHandler = vi.fn();
      service.onMessage(messageHandler);
      
      const fileMessage = {
        type: 'file_list_update',
        files: []
      };
      
      server.send(fileMessage);
      
      expect(messageHandler).toHaveBeenCalledWith(fileMessage);
    });
  });

  describe('File Operations', () => {
    beforeEach(async () => {
      service.connect();
      await server.connected;
    });

    it('should send file chunks', async () => {
      const fileId = 'test-file-123';
      const chunkData = { chunk: 1, data: 'file content' };
      
      const result = service.sendFileChunk(fileId, chunkData);
      
      expect(result).toBe(true);
      await expect(server).toReceiveMessage(JSON.stringify({
        type: 'file_chunk',
        req: btoa(JSON.stringify({ success: true, body: chunkData }))
      }));
    });

    it('should handle file chunk send when disconnected', () => {
      service.disconnect();
      
      const result = service.sendFileChunk('test-file', { data: 'test' });
      expect(result).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid JSON gracefully', async () => {
      const messageHandler = vi.fn();
      service.onMessage(messageHandler);
      
      service.connect();
      await server.connected;
      
      // Send invalid JSON
      server.send('invalid json {');
      
      // Should not crash, handler should not be called
      expect(messageHandler).not.toHaveBeenCalled();
    });

    it('should handle send errors gracefully', async () => {
      service.connect();
      await server.connected;
      
      // Close server to simulate error
      server.close();
      
      const result = service.send({ type: 'test' });
      expect(result).toBe(false);
    });

    it('should be safe to disconnect multiple times', () => {
      expect(() => {
        service.disconnect();
        service.disconnect();
        service.disconnect();
      }).not.toThrow();
    });
  });

  describe('Configuration', () => {
    it('should use custom configuration', () => {
      const customConfig: WebSocketConfig = {
        url: 'wss://custom.host/websocket',
        reconnectDelay: 3000,
        maxReconnectAttempts: 5
      };

      const customService = new WebSocketService(customConfig);
      expect(customService).toBeDefined();
    });

    it('should use custom URL when provided', async () => {
      const customUrl = 'ws://custom.host:8080/ws';
      const customServer = new WS(customUrl);
      const customService = new WebSocketService({ url: customUrl });
      
      customService.connect();
      await customServer.connected;
      
      expect(customService.isConnected()).toBe(true);
      
      customService.disconnect();
      WS.clean();
    });
  });

  describe('Ping/Pong', () => {
    beforeEach(async () => {
      service.connect();
      await server.connected;
    });

    it('should send ping messages', async () => {
      const pingPromise = service.ping();
      
      await expect(server).toReceiveMessage(JSON.stringify({
        type: 'ping',
        timestamp: expect.any(Number)
      }));
      
      // Simulate pong response
      server.send({ type: 'pong' });
      
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