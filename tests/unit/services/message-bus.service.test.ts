import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MessageBusService, Subscription } from '../../../src/services/message-bus.service';

// Mock BrowserPrint
vi.mock('../../../src/browser-logger', () => ({
  BrowserPrint: vi.fn()
}));

describe('MessageBusService', () => {
  let messageBus: MessageBusService;

  beforeEach(() => {
    messageBus = new MessageBusService();
  });

  afterEach(() => {
    messageBus.dispose();
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create instance with empty subscriptions', () => {
      expect(messageBus.getActiveChannels()).toEqual([]);
    });
  });

  describe('subscribe() method', () => {
    it('should add handler to new channel', () => {
      const handler = vi.fn();
      
      const subscription = messageBus.subscribe('test-channel', handler);
      
      expect(messageBus.getActiveChannels()).toContain('test-channel');
      expect(messageBus.getChannelSubscriptionCount('test-channel')).toBe(1);
      expect(subscription).toHaveProperty('unsubscribe');
    });

    it('should add multiple handlers to same channel', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      
      messageBus.subscribe('test-channel', handler1);
      messageBus.subscribe('test-channel', handler2);
      
      expect(messageBus.getChannelSubscriptionCount('test-channel')).toBe(2);
    });

    it('should handle different channels independently', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      
      messageBus.subscribe('channel-1', handler1);
      messageBus.subscribe('channel-2', handler2);
      
      expect(messageBus.getActiveChannels()).toContain('channel-1');
      expect(messageBus.getActiveChannels()).toContain('channel-2');
      expect(messageBus.getChannelSubscriptionCount('channel-1')).toBe(1);
      expect(messageBus.getChannelSubscriptionCount('channel-2')).toBe(1);
    });

    it('should return subscription object with working unsubscribe', () => {
      const handler = vi.fn();
      
      const subscription = messageBus.subscribe('test-channel', handler);
      expect(messageBus.getChannelSubscriptionCount('test-channel')).toBe(1);
      
      subscription.unsubscribe();
      expect(messageBus.getChannelSubscriptionCount('test-channel')).toBe(0);
    });

    it('should clean up empty channels after unsubscribe', () => {
      const handler = vi.fn();
      
      const subscription = messageBus.subscribe('test-channel', handler);
      expect(messageBus.getActiveChannels()).toContain('test-channel');
      
      subscription.unsubscribe();
      expect(messageBus.getActiveChannels()).not.toContain('test-channel');
    });

    it('should not affect other handlers when one unsubscribes', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      
      const sub1 = messageBus.subscribe('test-channel', handler1);
      const sub2 = messageBus.subscribe('test-channel', handler2);
      
      expect(messageBus.getChannelSubscriptionCount('test-channel')).toBe(2);
      
      sub1.unsubscribe();
      expect(messageBus.getChannelSubscriptionCount('test-channel')).toBe(1);
      expect(messageBus.getActiveChannels()).toContain('test-channel');
    });
  });

  describe('publish() method', () => {
    it('should call all handlers for a channel', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const testMessage = { data: 'test' };
      
      messageBus.subscribe('test-channel', handler1);
      messageBus.subscribe('test-channel', handler2);
      
      messageBus.publish('test-channel', testMessage);
      
      expect(handler1).toHaveBeenCalledWith(testMessage);
      expect(handler2).toHaveBeenCalledWith(testMessage);
      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('should not call handlers for different channels', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      
      messageBus.subscribe('channel-1', handler1);
      messageBus.subscribe('channel-2', handler2);
      
      messageBus.publish('channel-1', { data: 'test' });
      
      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).not.toHaveBeenCalled();
    });

    it('should handle publish to non-existent channel gracefully', () => {
      expect(() => {
        messageBus.publish('non-existent', { data: 'test' });
      }).not.toThrow();
    });

    it('should handle handler errors gracefully', () => {
      const errorHandler = vi.fn(() => {
        throw new Error('Handler error');
      });
      const goodHandler = vi.fn();
      
      messageBus.subscribe('test-channel', errorHandler);
      messageBus.subscribe('test-channel', goodHandler);
      
      expect(() => {
        messageBus.publish('test-channel', { data: 'test' });
      }).not.toThrow();
      
      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(goodHandler).toHaveBeenCalledTimes(1);
    });

    it('should handle different message types', () => {
      const handler = vi.fn();
      messageBus.subscribe('test-channel', handler);
      
      const stringMessage = 'test string';
      const objectMessage = { type: 'test', data: [1, 2, 3] };
      const numberMessage = 42;
      const nullMessage = null;
      
      messageBus.publish('test-channel', stringMessage);
      messageBus.publish('test-channel', objectMessage);
      messageBus.publish('test-channel', numberMessage);
      messageBus.publish('test-channel', nullMessage);
      
      expect(handler).toHaveBeenNthCalledWith(1, stringMessage);
      expect(handler).toHaveBeenNthCalledWith(2, objectMessage);
      expect(handler).toHaveBeenNthCalledWith(3, numberMessage);
      expect(handler).toHaveBeenNthCalledWith(4, nullMessage);
      expect(handler).toHaveBeenCalledTimes(4);
    });
  });

  describe('getActiveChannels() method', () => {
    it('should return empty array initially', () => {
      expect(messageBus.getActiveChannels()).toEqual([]);
    });

    it('should return all active channel names', () => {
      const handler = vi.fn();
      
      messageBus.subscribe('channel-1', handler);
      messageBus.subscribe('channel-2', handler);
      messageBus.subscribe('channel-3', handler);
      
      const channels = messageBus.getActiveChannels();
      expect(channels).toContain('channel-1');
      expect(channels).toContain('channel-2');
      expect(channels).toContain('channel-3');
      expect(channels).toHaveLength(3);
    });

    it('should not return duplicate channel names', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      
      messageBus.subscribe('test-channel', handler1);
      messageBus.subscribe('test-channel', handler2);
      
      const channels = messageBus.getActiveChannels();
      expect(channels.filter(ch => ch === 'test-channel')).toHaveLength(1);
    });

    it('should update when channels are removed', () => {
      const handler = vi.fn();
      
      const sub1 = messageBus.subscribe('channel-1', handler);
      const sub2 = messageBus.subscribe('channel-2', handler);
      
      expect(messageBus.getActiveChannels()).toHaveLength(2);
      
      sub1.unsubscribe();
      expect(messageBus.getActiveChannels()).toHaveLength(1);
      expect(messageBus.getActiveChannels()).toContain('channel-2');
    });
  });

  describe('getChannelSubscriptionCount() method', () => {
    it('should return 0 for non-existent channel', () => {
      expect(messageBus.getChannelSubscriptionCount('non-existent')).toBe(0);
    });

    it('should return correct count for single subscription', () => {
      const handler = vi.fn();
      messageBus.subscribe('test-channel', handler);
      
      expect(messageBus.getChannelSubscriptionCount('test-channel')).toBe(1);
    });

    it('should return correct count for multiple subscriptions', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const handler3 = vi.fn();
      
      messageBus.subscribe('test-channel', handler1);
      messageBus.subscribe('test-channel', handler2);
      messageBus.subscribe('test-channel', handler3);
      
      expect(messageBus.getChannelSubscriptionCount('test-channel')).toBe(3);
    });

    it('should update count when subscriptions are removed', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      
      const sub1 = messageBus.subscribe('test-channel', handler1);
      const sub2 = messageBus.subscribe('test-channel', handler2);
      
      expect(messageBus.getChannelSubscriptionCount('test-channel')).toBe(2);
      
      sub1.unsubscribe();
      expect(messageBus.getChannelSubscriptionCount('test-channel')).toBe(1);
      
      sub2.unsubscribe();
      expect(messageBus.getChannelSubscriptionCount('test-channel')).toBe(0);
    });
  });

  describe('dispose() method', () => {
    it('should clear all subscriptions', () => {
      const handler = vi.fn();
      
      messageBus.subscribe('channel-1', handler);
      messageBus.subscribe('channel-2', handler);
      messageBus.subscribe('channel-3', handler);
      
      expect(messageBus.getActiveChannels()).toHaveLength(3);
      
      messageBus.dispose();
      
      expect(messageBus.getActiveChannels()).toHaveLength(0);
    });

    it('should prevent handlers from being called after dispose', () => {
      const handler = vi.fn();
      
      messageBus.subscribe('test-channel', handler);
      messageBus.dispose();
      messageBus.publish('test-channel', { data: 'test' });
      
      expect(handler).not.toHaveBeenCalled();
    });

    it('should be safe to call multiple times', () => {
      const handler = vi.fn();
      messageBus.subscribe('test-channel', handler);
      
      expect(() => {
        messageBus.dispose();
        messageBus.dispose();
        messageBus.dispose();
      }).not.toThrow();
      
      expect(messageBus.getActiveChannels()).toHaveLength(0);
    });
  });

  describe('memory management', () => {
    it('should handle rapid subscribe/unsubscribe cycles', () => {
      const handler = vi.fn();
      
      // Simulate rapid subscription changes
      for (let i = 0; i < 1000; i++) {
        const sub = messageBus.subscribe(`channel-${i % 10}`, handler);
        if (i % 2 === 0) {
          sub.unsubscribe();
        }
      }
      
      expect(messageBus.getActiveChannels().length).toBeLessThanOrEqual(10);
    });

    it('should handle large number of handlers per channel', () => {
      const handlers = Array.from({ length: 100 }, () => vi.fn());
      
      handlers.forEach(handler => {
        messageBus.subscribe('stress-test', handler);
      });
      
      expect(messageBus.getChannelSubscriptionCount('stress-test')).toBe(100);
      
      messageBus.publish('stress-test', { data: 'test' });
      
      handlers.forEach(handler => {
        expect(handler).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('channel naming patterns', () => {
    it('should handle special characters in channel names', () => {
      const handler = vi.fn();
      const specialChannels = [
        'register:1',
        'files:update',
        'connection:status',
        'config:update',
        'user-action:click',
        'app.state.changed',
        'websocket/message'
      ];
      
      specialChannels.forEach(channel => {
        messageBus.subscribe(channel, handler);
      });
      
      expect(messageBus.getActiveChannels()).toHaveLength(specialChannels.length);
      
      specialChannels.forEach(channel => {
        messageBus.publish(channel, { test: true });
      });
      
      expect(handler).toHaveBeenCalledTimes(specialChannels.length);
    });

    it('should handle empty string channel name', () => {
      const handler = vi.fn();
      
      expect(() => {
        messageBus.subscribe('', handler);
        messageBus.publish('', { data: 'test' });
      }).not.toThrow();
      
      expect(handler).toHaveBeenCalledWith({ data: 'test' });
    });
  });

  describe('TypeScript type safety', () => {
    it('should work with typed messages', () => {
      interface TestMessage {
        type: 'test';
        data: string;
        timestamp: number;
      }
      
      const handler = vi.fn<[TestMessage], void>();
      
      messageBus.subscribe<TestMessage>('typed-channel', handler);
      
      const message: TestMessage = {
        type: 'test',
        data: 'typed message',
        timestamp: Date.now()
      };
      
      messageBus.publish('typed-channel', message);
      
      expect(handler).toHaveBeenCalledWith(message);
    });
  });
});