import MiniSearch from 'minisearch';
import { EventStore } from './event-store';
import { Print } from '../utilities';

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
  recentDocuments: SearchDocument[]; // Last 7 days with full content
  historicalIndex: string; // Serialized MiniSearch index
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

export class SearchIndexManager {
  private index: MiniSearch<SearchDocument>;
  private indexVersion: number = 0;
  private lastIndexUpdate: number = 0;
  
  constructor(private eventStore: EventStore) {
    this.index = new MiniSearch({
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
    
    this.buildInitialIndex().catch(error => {
      Print('ERROR', `Failed to build initial search index: ${error.message}`);
    });
  }
  
  private async buildInitialIndex(): Promise<void> {
    try {
      const events = await this.eventStore.getAllEvents();
      let documentsAdded = 0;
      
      events.forEach(event => {
        const doc = this.eventToSearchDocument(event);
        if (doc) {
          this.index.add(doc);
          documentsAdded++;
        }
      });
      
      this.indexVersion = 1;
      this.lastIndexUpdate = Date.now();
      
      Print('INFO', `Search index built with ${documentsAdded} documents`);
      Print('DEBUG', `Index version: ${this.indexVersion}, update time: ${new Date(this.lastIndexUpdate).toISOString()}`);
    } catch (error) {
      Print('ERROR', `Failed to build initial search index: ${(error as Error).message}`);
      throw error;
    }
  }
  
  private eventToSearchDocument(event: any): SearchDocument | null {
    try {
      const baseDoc: Partial<SearchDocument> = {
        id: `${event.entity_id}_${event.timestamp}`,
        entity_id: event.entity_id,
        timestamp: event.timestamp
      };
      
      switch (event.event_type) {
        case 'text_change':
          return {
            ...baseDoc,
            type: 'text',
            content: event.payload.content || '',
            metadata: `Register ${event.entity_id}`,
            enrichedTags: this.generateContentTags(event.payload.content)
          } as SearchDocument;
          
        case 'file_upload':
          return {
            ...baseDoc,
            type: 'file',
            filename: event.payload.filename || event.payload.displayName || 'unknown',
            content: event.payload.filename || event.payload.displayName || '',
            size: event.payload.size || 0,
            metadata: `File upload: ${event.payload.filename || 'unknown'}`,
            enrichedTags: this.generateFileTags(event.payload.filename || '')
          } as SearchDocument;
          
        case 'file_delete':
          // For file deletions, we might want to remove from index
          // But for now, we'll index the deletion event
          return {
            ...baseDoc,
            type: 'file',
            filename: event.payload.filename || 'unknown',
            content: `Deleted: ${event.payload.filename || 'unknown'}`,
            metadata: `File deletion: ${event.payload.filename || 'unknown'}`,
            enrichedTags: `deleted file ${this.generateFileTags(event.payload.filename || '')}`
          } as SearchDocument;
          
        default:
          Print('DEBUG', `Unknown event type for search indexing: ${event.event_type}`);
          return null;
      }
    } catch (error) {
      Print('ERROR', `Failed to convert event to search document: ${(error as Error).message}`);
      return null;
    }
  }
  
  private generateContentTags(content: string): string {
    if (!content) return '';
    
    const tags = [];
    
    // Extract common patterns
    const patterns = [
      { regex: /\b\w+@\w+\.\w+\b/g, tag: 'email' },
      { regex: /https?:\/\/[^\s]+/g, tag: 'url' },
      { regex: /\b\d{4}-\d{2}-\d{2}\b/g, tag: 'date' },
      { regex: /\b\d{1,2}:\d{2}(?::\d{2})?\b/g, tag: 'time' },
      { regex: /\b\d+\.\d+\.\d+\.\d+\b/g, tag: 'ip' },
      { regex: /\b[A-Z]{2,}\b/g, tag: 'acronym' },
      { regex: /\b\d+\b/g, tag: 'number' }
    ];
    
    patterns.forEach(pattern => {
      if (pattern.regex.test(content)) {
        tags.push(pattern.tag);
      }
    });
    
    // Add word count info
    const wordCount = content.split(/\s+/).length;
    if (wordCount > 100) tags.push('long-text');
    if (wordCount < 10) tags.push('short-text');
    
    return tags.join(' ');
  }
  
  private generateFileTags(filename: string): string {
    if (!filename) return '';
    
    const tags = [];
    const ext = filename.split('.').pop()?.toLowerCase();
    
    // File type categories
    const typeCategories = {
      'image': ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'],
      'document': ['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt'],
      'code': ['js', 'ts', 'py', 'java', 'cpp', 'c', 'rb', 'go', 'rs'],
      'data': ['json', 'xml', 'csv', 'sql', 'yaml', 'yml'],
      'archive': ['zip', 'tar', 'gz', 'rar', '7z'],
      'media': ['mp4', 'mp3', 'wav', 'avi', 'mov', 'mkv']
    };
    
    if (ext) {
      tags.push(`ext-${ext}`);
      
      // Add category tags
      for (const [category, extensions] of Object.entries(typeCategories)) {
        if (extensions.includes(ext)) {
          tags.push(category);
        }
      }
    }
    
    // Add filename patterns
    if (filename.includes('test')) tags.push('test');
    if (filename.includes('config')) tags.push('config');
    if (filename.includes('temp')) tags.push('temp');
    if (filename.includes('backup')) tags.push('backup');
    
    return tags.join(' ');
  }
  
  async getSmartBundle(): Promise<SmartBundle> {
    try {
      const cutoffTime = Date.now() - (7 * 24 * 60 * 60 * 1000); // 7 days ago
      
      // Get recent events with full content
      const recentEvents = await this.eventStore.getEventsSince(cutoffTime);
      const recentDocuments = recentEvents
        .map(event => this.eventToSearchDocument(event))
        .filter(doc => doc !== null) as SearchDocument[];
      
      // Build index for historical data (metadata only)
      const historicalIndex = new MiniSearch({
        fields: ['filename', 'metadata', 'enrichedTags'],
        storeFields: ['type', 'entity_id', 'timestamp', 'size', 'filename'],
        searchOptions: this.index.options.searchOptions
      });
      
      const historicalEvents = await this.eventStore.getEventsBefore(cutoffTime);
      historicalEvents.forEach(event => {
        const doc = this.eventToSearchDocument(event);
        if (doc) {
          // Create a lightweight version for historical index
          const lightDoc = {
            ...doc,
            content: doc.content?.substring(0, 100) || '' // Just snippet
          };
          historicalIndex.add(lightDoc);
        }
      });
      
      const bundle: SmartBundle = {
        recentDocuments,
        historicalIndex: JSON.stringify(historicalIndex),
        totalDocuments: this.index.documentCount,
        indexVersion: this.indexVersion
      };
      
      Print('DEBUG', `Generated SmartBundle: ${recentDocuments.length} recent docs, ${historicalIndex.documentCount} historical docs`);
      return bundle;
    } catch (error) {
      Print('ERROR', `Failed to generate SmartBundle: ${(error as Error).message}`);
      throw error;
    }
  }
  
  handleIndexDelta(event: any): IndexDelta {
    try {
      const fromVersion = this.indexVersion;
      this.indexVersion++;
      
      const doc = this.eventToSearchDocument(event);
      const additions: SearchDocument[] = [];
      const removals: string[] = [];
      
      if (doc) {
        // Check if this is an update to existing document
        const existingDocId = `${event.entity_id}_*`;
        
        // For text changes, we might want to remove previous versions
        if (event.event_type === 'text_change') {
          // Remove previous versions of this register
          const documentsToRemove = this.findDocumentsByEntityId(event.entity_id);
          documentsToRemove.forEach(docId => {
            if (docId !== doc.id) {
              this.index.remove(docId);
              removals.push(docId);
            }
          });
        }
        
        // Add new document
        this.index.add(doc);
        additions.push(doc);
      }
      
      const delta: IndexDelta = {
        fromVersion,
        toVersion: this.indexVersion,
        timestamp: Date.now(),
        additions,
        removals
      };
      
      Print('DEBUG', `Created index delta: v${fromVersion} -> v${this.indexVersion}, +${additions.length} -${removals.length}`);
      return delta;
    } catch (error) {
      Print('ERROR', `Failed to handle index delta: ${(error as Error).message}`);
      throw error;
    }
  }
  
  private findDocumentsByEntityId(entityId: string): string[] {
    try {
      // Search for documents with matching entity_id
      const results = this.index.search('', {
        filter: (result: any) => {
          const storedFields = this.index.getStoredFields(result.id);
          return storedFields.entity_id === entityId;
        }
      });
      
      return results.map(result => result.id);
    } catch (error) {
      Print('ERROR', `Failed to find documents by entity ID: ${(error as Error).message}`);
      return [];
    }
  }
  
  search(query: string, options: {
    limit?: number;
    timeRange?: { start: number; end: number };
    type?: 'text' | 'file';
  } = {}): any[] {
    try {
      const searchOptions = {
        limit: options.limit || 50,
        ...this.index.options.searchOptions
      };
      
      let results = this.index.search(query, searchOptions);
      
      // Apply filters
      if (options.timeRange) {
        results = results.filter(result => {
          const storedFields = this.index.getStoredFields(result.id);
          return storedFields.timestamp >= options.timeRange!.start && 
                 storedFields.timestamp <= options.timeRange!.end;
        });
      }
      
      if (options.type) {
        results = results.filter(result => {
          const storedFields = this.index.getStoredFields(result.id);
          return storedFields.type === options.type;
        });
      }
      
      Print('DEBUG', `Search for "${query}" returned ${results.length} results`);
      return results;
    } catch (error) {
      Print('ERROR', `Search failed: ${(error as Error).message}`);
      return [];
    }
  }
  
  getSuggestions(prefix: string, limit: number = 10): string[] {
    try {
      const suggestions = this.index.autoSuggest(prefix, { limit });
      Print('DEBUG', `Generated ${suggestions.length} suggestions for "${prefix}"`);
      return suggestions;
    } catch (error) {
      Print('ERROR', `Failed to generate suggestions: ${(error as Error).message}`);
      return [];
    }
  }
  
  getIndexStats(): { documentCount: number; indexVersion: number; lastUpdate: number } {
    return {
      documentCount: this.index.documentCount,
      indexVersion: this.indexVersion,
      lastUpdate: this.lastIndexUpdate
    };
  }
  
  async rebuildIndex(): Promise<void> {
    try {
      Print('INFO', 'Rebuilding search index...');
      
      // Clear existing index
      this.index.removeAll();
      
      // Rebuild from events
      await this.buildInitialIndex();
      
      Print('INFO', 'Search index rebuilt successfully');
    } catch (error) {
      Print('ERROR', `Failed to rebuild search index: ${(error as Error).message}`);
      throw error;
    }
  }
}