import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CollaborationService, TextChangeMessage, FileInfo } from '../../../src/services/collaboration.service';
import { WebSocketService } from '../../../src/services/websocket.service';
import { MessageBusService } from '../../../src/services/message-bus.service';

// Mock BrowserPrint
vi.mock('../../../src/browser-logger', () => ({
  BrowserPrint: vi.fn()
}));

// Mock dependencies
vi.mock('../../../src/services/websocket.service');
vi.mock('../../../src/services/message-bus.service');

describe('CollaborationService', () => {
  let collaborationService: CollaborationService;
  let mockWebSocketService: vi.Mocked<WebSocketService>;
  let mockMessageBusService: vi.Mocked<MessageBusService>;
  let mockWsUnsubscribe: vi.Mock;
  let mockConnectionUnsubscribe: vi.Mock;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Create mock unsubscribe functions
    mockWsUnsubscribe = vi.fn();
    mockConnectionUnsubscribe = vi.fn();

    // Create mock WebSocket service
    mockWebSocketService = {
      onMessage: vi.fn().mockReturnValue(mockWsUnsubscribe),
      onConnectionChange: vi.fn().mockReturnValue(mockConnectionUnsubscribe),
      connect: vi.fn(),
      send: vi.fn().mockReturnValue(true),
      isConnected: vi.fn().mockReturnValue(true),
      sendFileChunk: vi.fn().mockReturnValue(true),
      ping: vi.fn().mockResolvedValue(true),
      disconnect: vi.fn(),
    } as any;

    // Create mock MessageBus service
    mockMessageBusService = {
      subscribe: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }),
      publish: vi.fn(),
      getActiveChannels: vi.fn().mockReturnValue([]),
      dispose: vi.fn(),
    } as any;

    // Create service instance
    collaborationService = new CollaborationService(mockWebSocketService, mockMessageBusService);
  });

  afterEach(() => {
    collaborationService.dispose();
  });

  describe('constructor and initialization', () => {
    it('should initialize WebSocket message handler', () => {
      expect(mockWebSocketService.onMessage).toHaveBeenCalledTimes(1);
      expect(mockWebSocketService.onMessage).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should initialize connection change handler', () => {
      expect(mockWebSocketService.onConnectionChange).toHaveBeenCalledTimes(1);
      expect(mockWebSocketService.onConnectionChange).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should call WebSocket connect', () => {
      expect(mockWebSocketService.connect).toHaveBeenCalledTimes(1);
    });

    it('should set up unsubscribe functions', () => {
      expect(mockWsUnsubscribe).toBeDefined();
      expect(mockConnectionUnsubscribe).toBeDefined();
    });
  });

  describe('message handling', () => {
    let messageHandler: (msg: any) => void;

    beforeEach(() => {
      // Get the message handler that was passed to onMessage
      messageHandler = mockWebSocketService.onMessage.mock.calls[0][0];
    });

    it('should handle text_change messages correctly', () => {
      const message = {
        type: 'text_change',
        index: 0, // 0-based index
        content: 'Hello World'
      };

      messageHandler(message);

      expect(mockMessageBusService.publish).toHaveBeenCalledWith(
        'register:1', // Converted to 1-based
        'Hello World'
      );
    });

    it('should convert index correctly for different registers', () => {
      const messages = [
        { type: 'text_change', index: 0, content: 'Register 1' },
        { type: 'text_change', index: 1, content: 'Register 2' },
        { type: 'text_change', index: 2, content: 'Register 3' }
      ];

      messages.forEach(messageHandler);

      expect(mockMessageBusService.publish).toHaveBeenCalledWith('register:1', 'Register 1');
      expect(mockMessageBusService.publish).toHaveBeenCalledWith('register:2', 'Register 2');
      expect(mockMessageBusService.publish).toHaveBeenCalledWith('register:3', 'Register 3');
    });

    it('should handle file_list_update messages', () => {
      const files: FileInfo[] = [
        {
          hash: 'abc123',
          displayName: 'test.txt',
          size: 1024,
          timestamp: Date.now(),
          uploaderHostname: 'localhost',
          storedName: 'test_abc123.txt'
        }
      ];

      const message = {
        type: 'file_list_update',
        files
      };

      messageHandler(message);

      expect(mockMessageBusService.publish).toHaveBeenCalledWith('files:update', files);
    });

    it('should handle config_update messages', () => {
      const config = {
        oversize_file_in_mb: 10
      };

      const message = {
        type: 'config_update',
        config
      };

      messageHandler(message);

      expect(mockMessageBusService.publish).toHaveBeenCalledWith('config:update', config);
    });

    it('should handle unknown message types gracefully', () => {
      const message = {
        type: 'unknown_type',
        data: 'some data'
      };

      expect(() => messageHandler(message)).not.toThrow();

      // Should not publish anything for unknown types
      expect(mockMessageBusService.publish).not.toHaveBeenCalled();
    });

    it('should handle malformed messages gracefully', () => {
      const malformedMessages = [
        {},
        { type: 'text_change' }, // missing required fields
        { index: 0, content: 'test' }, // missing type
        'invalid message'
      ];

      malformedMessages.forEach(message => {
        expect(() => messageHandler(message)).not.toThrow();
      });

      // Handle null and undefined separately since they cause different errors
      expect(() => messageHandler(null)).toThrow();
      expect(() => messageHandler(undefined)).toThrow();
    });
  });

  describe('connection status handling', () => {
    let connectionHandler: (connected: boolean) => void;

    beforeEach(() => {
      // Get the connection handler that was passed to onConnectionChange
      connectionHandler = mockWebSocketService.onConnectionChange.mock.calls[0][0];
    });

    it('should publish connection status changes', () => {
      connectionHandler(true);
      expect(mockMessageBusService.publish).toHaveBeenCalledWith('connection:status', true);

      connectionHandler(false);
      expect(mockMessageBusService.publish).toHaveBeenCalledWith('connection:status', false);
    });
  });

  describe('syncRegister() method', () => {
    it('should send text change message with correct format', () => {
      collaborationService.syncRegister(2, 'Test content');

      expect(mockWebSocketService.send).toHaveBeenCalledWith({
        type: 'text_change',
        index: 1, // Converted from 1-based to 0-based
        content: 'Test content'
      });
    });

    it('should handle WebSocket send failure', () => {
      mockWebSocketService.send.mockReturnValue(false);

      expect(() => {
        collaborationService.syncRegister(1, 'Test content');
      }).not.toThrow();

      expect(mockWebSocketService.send).toHaveBeenCalledWith({
        type: 'text_change',
        index: 0,
        content: 'Test content'
      });
    });

    it('should handle different register IDs correctly', () => {
      collaborationService.syncRegister(1, 'Content 1');
      collaborationService.syncRegister(3, 'Content 3');
      collaborationService.syncRegister(10, 'Content 10');

      expect(mockWebSocketService.send).toHaveBeenNthCalledWith(1, {
        type: 'text_change',
        index: 0,
        content: 'Content 1'
      });
      expect(mockWebSocketService.send).toHaveBeenNthCalledWith(2, {
        type: 'text_change',
        index: 2,
        content: 'Content 3'
      });
      expect(mockWebSocketService.send).toHaveBeenNthCalledWith(3, {
        type: 'text_change',
        index: 9,
        content: 'Content 10'
      });
    });

    it('should handle empty and special content', () => {
      collaborationService.syncRegister(1, '');
      collaborationService.syncRegister(2, 'Line 1\nLine 2\nLine 3');
      collaborationService.syncRegister(3, '{"json": "content"}');

      expect(mockWebSocketService.send).toHaveBeenNthCalledWith(1, {
        type: 'text_change',
        index: 0,
        content: ''
      });
      expect(mockWebSocketService.send).toHaveBeenNthCalledWith(2, {
        type: 'text_change',
        index: 1,
        content: 'Line 1\nLine 2\nLine 3'
      });
      expect(mockWebSocketService.send).toHaveBeenNthCalledWith(3, {
        type: 'text_change',
        index: 2,
        content: '{"json": "content"}'
      });
    });
  });

  describe('subscription methods', () => {
    it('should subscribe to register updates correctly', () => {
      const callback = vi.fn();
      const mockUnsubscribe = vi.fn();
      mockMessageBusService.subscribe.mockReturnValue({ unsubscribe: mockUnsubscribe });

      const unsubscribe = collaborationService.subscribeToRegister(5, callback);

      expect(mockMessageBusService.subscribe).toHaveBeenCalledWith('register:5', callback);
      expect(unsubscribe).toBe(mockUnsubscribe);
    });

    it('should subscribe to file updates correctly', () => {
      const callback = vi.fn();
      const mockUnsubscribe = vi.fn();
      mockMessageBusService.subscribe.mockReturnValue({ unsubscribe: mockUnsubscribe });

      const unsubscribe = collaborationService.subscribeToFileUpdates(callback);

      expect(mockMessageBusService.subscribe).toHaveBeenCalledWith('files:update', callback);
      expect(unsubscribe).toBe(mockUnsubscribe);
    });

    it('should subscribe to connection status correctly', () => {
      const callback = vi.fn();
      const mockUnsubscribe = vi.fn();
      mockMessageBusService.subscribe.mockReturnValue({ unsubscribe: mockUnsubscribe });

      const unsubscribe = collaborationService.subscribeToConnection(callback);

      expect(mockMessageBusService.subscribe).toHaveBeenCalledWith('connection:status', callback);
      expect(unsubscribe).toBe(mockUnsubscribe);
    });

    it('should handle multiple subscriptions to same register', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      collaborationService.subscribeToRegister(1, callback1);
      collaborationService.subscribeToRegister(1, callback2);

      expect(mockMessageBusService.subscribe).toHaveBeenCalledTimes(2);
      expect(mockMessageBusService.subscribe).toHaveBeenNthCalledWith(1, 'register:1', callback1);
      expect(mockMessageBusService.subscribe).toHaveBeenNthCalledWith(2, 'register:1', callback2);
    });
  });

  describe('file operations', () => {
    it('should send file chunks correctly', () => {
      const fileId = 'test-file-123';
      const chunkData = { chunk: 1, data: 'chunk data' };

      const result = collaborationService.sendFileChunk(fileId, chunkData);

      expect(mockWebSocketService.sendFileChunk).toHaveBeenCalledWith(fileId, chunkData);
      expect(result).toBe(true);
    });

    it('should handle file chunk send failure', () => {
      mockWebSocketService.sendFileChunk.mockReturnValue(false);

      const result = collaborationService.sendFileChunk('test-file', {});

      expect(result).toBe(false);
    });
  });

  describe('connection management', () => {
    it('should return connection status', () => {
      mockWebSocketService.isConnected.mockReturnValue(true);
      expect(collaborationService.isConnected()).toBe(true);

      mockWebSocketService.isConnected.mockReturnValue(false);
      expect(collaborationService.isConnected()).toBe(false);
    });

    it('should test connection with ping', async () => {
      mockWebSocketService.ping.mockResolvedValue(true);

      const result = await collaborationService.testConnection();

      expect(mockWebSocketService.ping).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should handle ping failure', async () => {
      mockWebSocketService.ping.mockResolvedValue(false);

      const result = await collaborationService.testConnection();

      expect(result).toBe(false);
    });

    it('should handle ping error', async () => {
      mockWebSocketService.ping.mockRejectedValue(new Error('Ping failed'));

      await expect(collaborationService.testConnection()).rejects.toThrow('Ping failed');
    });
  });

  describe('debugging methods', () => {
    it('should return active channels from message bus', () => {
      const channels = ['register:1', 'files:update', 'connection:status'];
      mockMessageBusService.getActiveChannels.mockReturnValue(channels);

      const result = collaborationService.getActiveChannels();

      expect(mockMessageBusService.getActiveChannels).toHaveBeenCalled();
      expect(result).toEqual(channels);
    });
  });

  describe('dispose() method', () => {
    it('should clean up all resources', () => {
      collaborationService.dispose();

      expect(mockWsUnsubscribe).toHaveBeenCalled();
      expect(mockConnectionUnsubscribe).toHaveBeenCalled();
      expect(mockWebSocketService.disconnect).toHaveBeenCalled();
      expect(mockMessageBusService.dispose).toHaveBeenCalled();
    });

    it('should handle dispose when unsubscribe functions are undefined', () => {
      // Create a new service that might not have unsubscribe functions
      const serviceWithoutSubs = new CollaborationService(mockWebSocketService, mockMessageBusService);

      // Mock the onMessage and onConnectionChange to return undefined
      mockWebSocketService.onMessage.mockReturnValue(undefined as any);
      mockWebSocketService.onConnectionChange.mockReturnValue(undefined as any);

      expect(() => serviceWithoutSubs.dispose()).not.toThrow();
    });

    it('should be safe to call dispose multiple times', () => {
      collaborationService.dispose();
      collaborationService.dispose();
      collaborationService.dispose();

      expect(mockWsUnsubscribe).toHaveBeenCalledTimes(3);
      expect(mockConnectionUnsubscribe).toHaveBeenCalledTimes(3);
      expect(mockWebSocketService.disconnect).toHaveBeenCalledTimes(3);
      expect(mockMessageBusService.dispose).toHaveBeenCalledTimes(3);
    });
  });

  describe('error scenarios', () => {
    it('should handle WebSocket service errors gracefully', () => {
      mockWebSocketService.send.mockImplementation(() => {
        throw new Error('WebSocket error');
      });

      expect(() => {
        collaborationService.syncRegister(1, 'test');
      }).toThrow('WebSocket error');
    });

    it('should handle message bus errors gracefully', () => {
      mockMessageBusService.publish.mockImplementation(() => {
        throw new Error('MessageBus error');
      });

      const messageHandler = mockWebSocketService.onMessage.mock.calls[0][0];

      expect(() => {
        messageHandler({ type: 'text_change', index: 0, content: 'test' });
      }).toThrow('MessageBus error');
    });
  });

  describe('integration scenarios', () => {
    it('should handle rapid message sequences', () => {
      const messageHandler = mockWebSocketService.onMessage.mock.calls[0][0];

      // Simulate rapid incoming messages
      for (let i = 0; i < 100; i++) {
        messageHandler({
          type: 'text_change',
          index: i % 3,
          content: `Message ${i}`
        });
      }

      expect(mockMessageBusService.publish).toHaveBeenCalledTimes(100);
    });

    it('should handle mixed message types in sequence', () => {
      const messageHandler = mockWebSocketService.onMessage.mock.calls[0][0];

      const messages = [
        { type: 'text_change', index: 0, content: 'Text update' },
        { type: 'file_list_update', files: [] },
        { type: 'config_update', config: { oversize_file_in_mb: 5 } },
        { type: 'text_change', index: 1, content: 'Another text update' }
      ];

      messages.forEach(messageHandler);

      expect(mockMessageBusService.publish).toHaveBeenCalledTimes(4);
      expect(mockMessageBusService.publish).toHaveBeenNthCalledWith(1, 'register:1', 'Text update');
      expect(mockMessageBusService.publish).toHaveBeenNthCalledWith(2, 'files:update', []);
      expect(mockMessageBusService.publish).toHaveBeenNthCalledWith(3, 'config:update', { oversize_file_in_mb: 5 });
      expect(mockMessageBusService.publish).toHaveBeenNthCalledWith(4, 'register:2', 'Another text update');
    });

    it('should maintain state consistency during connection changes', () => {
      const connectionHandler = mockWebSocketService.onConnectionChange.mock.calls[0][0];

      // Simulate connection status changes
      connectionHandler(false);
      connectionHandler(true);
      connectionHandler(false);
      connectionHandler(true);

      expect(mockMessageBusService.publish).toHaveBeenCalledTimes(4);
      expect(mockMessageBusService.publish).toHaveBeenNthCalledWith(1, 'connection:status', false);
      expect(mockMessageBusService.publish).toHaveBeenNthCalledWith(2, 'connection:status', true);
      expect(mockMessageBusService.publish).toHaveBeenNthCalledWith(3, 'connection:status', false);
      expect(mockMessageBusService.publish).toHaveBeenNthCalledWith(4, 'connection:status', true);
    });
  });
});
