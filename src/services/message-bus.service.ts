import { BrowserPrint } from '../browser-logger';
import { singleton } from 'aurelia';

export interface Subscription {
  unsubscribe: () => void;
}

@singleton
export class MessageBusService {
  private subscriptions = new Map<string, Set<(data: any) => void>>();
  
  subscribe<T>(channel: string, handler: (msg: T) => void): Subscription {
    BrowserPrint('DEBUG', `Subscribing to channel: ${channel}`);
    
    if (!this.subscriptions.has(channel)) {
      this.subscriptions.set(channel, new Set());
    }
    
    this.subscriptions.get(channel)!.add(handler);
    
    // Return subscription object with unsubscribe method
    return {
      unsubscribe: () => {
        BrowserPrint('DEBUG', `Unsubscribing from channel: ${channel}`);
        this.subscriptions.get(channel)?.delete(handler);
        
        // Clean up empty channels
        if (this.subscriptions.get(channel)?.size === 0) {
          this.subscriptions.delete(channel);
        }
      }
    };
  }
  
  publish<T>(channel: string, message: T): void {
    const handlers = this.subscriptions.get(channel);
    if (handlers) {
      BrowserPrint('DEBUG', `Publishing to channel ${channel}: ${handlers.size} handlers`);
      handlers.forEach(handler => {
        try {
          handler(message);
        } catch (error) {
          BrowserPrint('ERROR', `Handler error on channel ${channel}: ${error.message}`);
        }
      });
    }
  }
  
  // Get active channel count for debugging
  getActiveChannels(): string[] {
    return Array.from(this.subscriptions.keys());
  }
  
  // Get subscription count for a channel
  getChannelSubscriptionCount(channel: string): number {
    return this.subscriptions.get(channel)?.size || 0;
  }
  
  // Clean up all subscriptions
  dispose(): void {
    BrowserPrint('INFO', `Disposing MessageBus with ${this.subscriptions.size} active channels`);
    this.subscriptions.clear();
  }
}