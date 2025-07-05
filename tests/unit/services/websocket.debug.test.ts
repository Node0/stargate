import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import WS from 'vitest-websocket-mock';
import { WebSocketService } from '../../../src/services/websocket.service';

// Mock BrowserPrint
vi.mock('../../../src/browser-logger', () => ({
  BrowserPrint: vi.fn()
}));

// Mock window for Node.js environment
global.window = {
  setTimeout: global.setTimeout,
  clearTimeout: global.clearTimeout,
} as any;

describe('WebSocket Debug Test', () => {
  afterEach(() => {
    WS.clean();
  });

  it('should create mock WebSocket server', async () => {
    const server = new WS('ws://localhost:1234');
    const client = new WebSocket('ws://localhost:1234');
    
    await server.connected;
    expect(server).toBeDefined();
    
    client.send('hello');
    await expect(server).toReceiveMessage('hello');
  });

  it('should work with WebSocketService', async () => {
    const testUrl = 'ws://localhost:1235'; // Different port to avoid conflict
    const server = new WS(testUrl);
    const service = new WebSocketService({ url: testUrl });
    
    console.log('Created service with URL:', testUrl);
    service.connect();
    console.log('Called service.connect()');
    
    try {
      await server.connected;
      console.log('Server connected');
      expect(service.isConnected()).toBe(true);
    } catch (error) {
      console.error('Connection failed:', error);
      throw error;
    }
    
    service.disconnect();
  });
});