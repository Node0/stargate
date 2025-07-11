import MiniSearch from 'minisearch';
import { singleton } from 'aurelia';
import { BrowserPrint } from '../browser-logger';
import { CollaborationService } from './collaboration.service';
import { MessageBusService } from './message-bus.service';

export interface SearchDocument {
  id: string;
  type: 'text' | 'file';
  entity_id: string;
  content: string;
  timestamp: number;
  metadata?: string;
  filename?: string;
  size?: number;
  enrichedTags?: string;
}

export interface SmartBundle {
  recentDocuments: SearchDocument[];
  historicalIndex: string;
  totalDocuments: number;
  indexVersion: number;
}

export interface IndexDelta {
  fromVersion: number;
  toVersion: number;
  timestamp: number;
  additions: SearchDocument[];
  removals: string[];
}

export interface SearchResult {
  id: string;
  score: number;
  content: string;
  hasFullContent: boolean;
  type: 'text' | 'file';
  entity_id: string;
  timestamp: number;
  filename?: string;
  size?: number;
  metadata?: string;
}

export interface SearchOptions {
  limit?: number;
  timeRange?: { start: number; end: number };
  type?: 'text' | 'file';
  fuzzy?: boolean;
  prefix?: boolean;
}

@singleton
export class SearchService {
  private localIndex?: MiniSearch<SearchDocument>;
  private historicalIndex?: MiniSearch<SearchDocument>;
  private contentCache = new Map<string, string>();
  private indexVersion = 0;
  private timeConstraint?: { start: number; end: number };
  private isInitialized = false;
  
  // Component lifecycle
  private unsubscribeSearchResponse?: () => void;
  private unsubscribeIndexDelta?: () => void;
  private unsubscribeTimeConstraint?: () => void;
  private unsubscribeConnection?: () => void;
  
  constructor(
    private collaboration: CollaborationService,
    private messageBus: MessageBusService
  ) {
    this.initialize();
  }
  
  private async initialize(): Promise<void> {
    BrowserPrint('INFO', 'Initializing SearchService');
    
    // Subscribe to search responses
    this.unsubscribeSearchResponse = this.messageBus.subscribe('search:response', (response: any) => {
      this.handleSearchResponse(response);
    });
    
    // Subscribe to index deltas
    this.unsubscribeIndexDelta = this.messageBus.subscribe('index_delta', (delta: IndexDelta) => {
      this.applyIndexDelta(delta);
    });
    
    // Subscribe to time constraints from TimeMap
    this.unsubscribeTimeConstraint = this.messageBus.subscribe('search:constrain', (constraint: any) => {
      this.timeConstraint = constraint;
      if (constraint) {
        BrowserPrint('INFO', `Search constrained to: ${new Date(constraint.start).toISOString()} - ${new Date(constraint.end).toISOString()}`);
      } else {
        BrowserPrint('INFO', 'Search constraint removed');
      }
    });
    
    // Subscribe to connection status
    this.unsubscribeConnection = this.collaboration.subscribeToConnection((connected: boolean) => {
      if (connected && !this.isInitialized) {
        this.requestSmartBundle();
      }
    });
    
    // Request initial smart bundle if connected
    if (this.collaboration.isConnected()) {
      this.requestSmartBundle();
    }
  }
  
  private handleSearchResponse(response: any): void {
    BrowserPrint('DEBUG', `Search response: ${response.action}`);
    
    switch (response.action) {
      case 'bundle':
        this.processSmartBundle(response.data);
        break;
      case 'results':
        this.messageBus.publish('search:results', response.data);
        break;
      case 'suggestions':
        this.messageBus.publish('search:suggestions', response.data);
        break;
      case 'stats':
        this.messageBus.publish('search:stats', response.data);
        break;
      default:
        if (response.error) {
          BrowserPrint('ERROR', `Search error: ${response.error}`);
          this.messageBus.publish('search:error', response.error);
        }
    }
  }
  
  private requestSmartBundle(): void {
    BrowserPrint('DEBUG', 'Requesting search bundle');
    
    const message = {
      type: 'search_request',
      action: 'get_bundle',
      req: btoa(JSON.stringify({ success: true, body: {} }))
    };
    
    if (!this.collaboration.sendMessage(message)) {
      BrowserPrint('ERROR', 'Failed to request search bundle');
    }
  }
  
  private processSmartBundle(bundle: SmartBundle): void {
    try {
      BrowserPrint('INFO', `Processing search bundle: ${bundle.recentDocuments.length} recent, ${bundle.totalDocuments} total`);
      
      // Initialize local index for recent documents
      this.localIndex = new MiniSearch({
        fields: ['content', 'filename', 'metadata', 'enrichedTags'],
        storeFields: ['type', 'entity_id', 'timestamp', 'size', 'filename'],
        searchOptions: {
          boost: { 
            filename: 2.0,
            content: 1.5,
            enrichedTags: 1.5,
            metadata: 1.0
          },
          fuzzy: 0.2,
          prefix: true,
          combineWith: 'AND'
        }
      });
      
      // Add recent documents with full content
      bundle.recentDocuments.forEach(doc => {
        this.localIndex!.add(doc);
        this.contentCache.set(doc.id, doc.content);
      });
      
      // Load historical index
      try {
        this.historicalIndex = MiniSearch.loadJSON(bundle.historicalIndex);
        BrowserPrint('DEBUG', `Loaded historical index with ${this.historicalIndex.documentCount} documents`);
      } catch (error) {
        BrowserPrint('ERROR', `Failed to load historical index: ${(error as Error).message}`);
        this.historicalIndex = undefined;
      }
      
      this.indexVersion = bundle.indexVersion;
      this.isInitialized = true;
      
      BrowserPrint('INFO', `Search service initialized: version ${this.indexVersion}`);
      this.messageBus.publish('search:initialized', {
        recentDocuments: bundle.recentDocuments.length,
        totalDocuments: bundle.totalDocuments,
        version: this.indexVersion
      });
    } catch (error) {
      BrowserPrint('ERROR', `Failed to process search bundle: ${(error as Error).message}`);
    }
  }
  
  private applyIndexDelta(delta: IndexDelta): void {
    if (!this.isInitialized) {
      BrowserPrint('DEBUG', 'Ignoring index delta: not initialized');
      return;
    }
    
    if (delta.fromVersion !== this.indexVersion) {
      BrowserPrint('WARNING', `Index version mismatch: expected ${this.indexVersion}, got ${delta.fromVersion}. Requesting resync.`);
      this.requestSmartBundle();
      return;
    }
    
    if (!this.localIndex) {
      BrowserPrint('ERROR', 'Cannot apply index delta: local index not initialized');
      return;
    }
    
    try {
      // Apply removals
      delta.removals.forEach(id => {
        try {
          this.localIndex!.remove(id);
          this.contentCache.delete(id);
        } catch (error) {
          BrowserPrint('DEBUG', `Could not remove document ${id}: ${(error as Error).message}`);
        }
      });
      
      // Apply additions
      delta.additions.forEach(doc => {
        try {
          this.localIndex!.add(doc);
          if (doc.content) {
            this.contentCache.set(doc.id, doc.content);
          }
        } catch (error) {
          BrowserPrint('ERROR', `Could not add document ${doc.id}: ${(error as Error).message}`);
        }
      });
      
      this.indexVersion = delta.toVersion;
      
      BrowserPrint('DEBUG', `Applied index delta: v${delta.fromVersion} -> v${delta.toVersion}, +${delta.additions.length} -${delta.removals.length}`);
      
      // Notify components of index update
      this.messageBus.publish('search:updated', {
        version: this.indexVersion,
        additions: delta.additions.length,
        removals: delta.removals.length
      });
    } catch (error) {
      BrowserPrint('ERROR', `Failed to apply index delta: ${(error as Error).message}`);
    }
  }
  
  search(query: string, options: SearchOptions = {}): SearchResult[] {
    if (!query.trim()) {
      return [];
    }
    
    if (!this.isInitialized) {
      BrowserPrint('WARNING', 'Search attempted before initialization');
      return [];
    }
    
    try {
      const searchOptions = {
        limit: options.limit || 50,
        fuzzy: options.fuzzy !== false ? 0.2 : 0,
        prefix: options.prefix !== false,
        combineWith: 'AND' as const
      };
      
      let results: SearchResult[] = [];
      
      // Search local index (recent documents)
      if (this.localIndex) {
        const localResults = this.localIndex.search(query, searchOptions);
        results = results.concat(localResults.map(r => this.mapSearchResult(r, true)));
      }
      
      // Search historical index
      if (this.historicalIndex) {
        const historicalResults = this.historicalIndex.search(query, searchOptions);
        results = results.concat(historicalResults.map(r => this.mapSearchResult(r, false)));
      }
      
      // Remove duplicates and sort by score
      const uniqueResults = this.deduplicateResults(results);
      uniqueResults.sort((a, b) => b.score - a.score);
      
      // Apply filters
      let filteredResults = uniqueResults;
      
      if (this.timeConstraint) {
        filteredResults = filteredResults.filter(r => 
          r.timestamp >= this.timeConstraint!.start && 
          r.timestamp <= this.timeConstraint!.end
        );
      }
      
      if (options.timeRange) {
        filteredResults = filteredResults.filter(r => 
          r.timestamp >= options.timeRange!.start && 
          r.timestamp <= options.timeRange!.end
        );
      }
      
      if (options.type) {
        filteredResults = filteredResults.filter(r => r.type === options.type);
      }
      
      // Apply limit
      if (options.limit) {
        filteredResults = filteredResults.slice(0, options.limit);
      }
      
      BrowserPrint('DEBUG', `Search "${query}" returned ${filteredResults.length} results`);
      return filteredResults;
    } catch (error) {
      BrowserPrint('ERROR', `Search failed: ${(error as Error).message}`);
      return [];
    }
  }
  
  private mapSearchResult(result: any, hasFullContent: boolean): SearchResult {
    const storedFields = hasFullContent ? 
      this.localIndex!.getStoredFields(result.id) : 
      this.historicalIndex!.getStoredFields(result.id);
    
    return {
      id: result.id,
      score: result.score,
      content: this.contentCache.get(result.id) || result.content || 'Loading...',
      hasFullContent,
      type: storedFields.type,
      entity_id: storedFields.entity_id,
      timestamp: storedFields.timestamp,
      filename: storedFields.filename,
      size: storedFields.size,
      metadata: storedFields.metadata
    };
  }
  
  private deduplicateResults(results: SearchResult[]): SearchResult[] {
    const seen = new Set<string>();
    return results.filter(result => {
      if (seen.has(result.id)) {
        return false;
      }
      seen.add(result.id);
      return true;
    });
  }
  
  getSuggestions(prefix: string, limit: number = 10): string[] {
    if (!this.isInitialized || !prefix.trim()) {
      return [];
    }
    
    try {
      const suggestions = new Set<string>();
      
      // Get suggestions from local index
      if (this.localIndex) {
        const localSuggestions = this.localIndex.autoSuggest(prefix, { limit });
        localSuggestions.forEach(s => suggestions.add(s));
      }
      
      // Get suggestions from historical index
      if (this.historicalIndex) {
        const historicalSuggestions = this.historicalIndex.autoSuggest(prefix, { limit });
        historicalSuggestions.forEach(s => suggestions.add(s));
      }
      
      const result = Array.from(suggestions).slice(0, limit);
      BrowserPrint('DEBUG', `Generated ${result.length} suggestions for "${prefix}"`);
      return result;
    } catch (error) {
      BrowserPrint('ERROR', `Failed to generate suggestions: ${(error as Error).message}`);
      return [];
    }
  }
  
  // Request server-side search (for complex queries)
  searchRemote(query: string, options: SearchOptions = {}): void {
    const message = {
      type: 'search_request',
      action: 'search',
      req: btoa(JSON.stringify({ 
        success: true, 
        body: { query, ...options } 
      }))
    };
    
    if (!this.collaboration.sendMessage(message)) {
      BrowserPrint('ERROR', 'Failed to send remote search request');
    }
  }
  
  // Request server-side suggestions
  suggestRemote(prefix: string, limit: number = 10): void {
    const message = {
      type: 'search_request',
      action: 'suggest',
      req: btoa(JSON.stringify({ 
        success: true, 
        body: { prefix, limit } 
      }))
    };
    
    if (!this.collaboration.sendMessage(message)) {
      BrowserPrint('ERROR', 'Failed to send remote suggestions request');
    }
  }
  
  // Get search statistics
  getStats(): any {
    return {
      isInitialized: this.isInitialized,
      indexVersion: this.indexVersion,
      localDocuments: this.localIndex?.documentCount || 0,
      historicalDocuments: this.historicalIndex?.documentCount || 0,
      cachedContent: this.contentCache.size,
      timeConstraint: this.timeConstraint
    };
  }
  
  // Clear time constraint
  clearTimeConstraint(): void {
    this.timeConstraint = undefined;
    this.messageBus.publish('search:constrain', null);
  }
  
  // Subscribe to search events
  subscribeToResults(callback: (results: any) => void): () => void {
    return this.messageBus.subscribe('search:results', callback).unsubscribe;
  }
  
  subscribeToSuggestions(callback: (suggestions: any) => void): () => void {
    return this.messageBus.subscribe('search:suggestions', callback).unsubscribe;
  }
  
  subscribeToUpdates(callback: (update: any) => void): () => void {
    return this.messageBus.subscribe('search:updated', callback).unsubscribe;
  }
  
  subscribeToInitialization(callback: (status: any) => void): () => void {
    return this.messageBus.subscribe('search:initialized', callback).unsubscribe;
  }
  
  // Cleanup
  dispose(): void {
    BrowserPrint('INFO', 'Disposing SearchService');
    this.unsubscribeSearchResponse?.();
    this.unsubscribeIndexDelta?.();
    this.unsubscribeTimeConstraint?.();
    this.unsubscribeConnection?.();
    this.contentCache.clear();
  }
}