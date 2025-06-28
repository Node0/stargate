import { BrowserPrint } from '../browser-logger';

interface FileInfo {
  hash: string;
  displayName: string;
  size: number;
  timestamp: number;
  uploaderHostname: string;
  storedName?: string;
}

export class FileManager {
  files: FileInfo[] = [];
  filteredFiles: FileInfo[] = [];
  searchFilter: string = '';
  sortColumn: string = 'timestamp';
  sortAscending: boolean = false;
  
  // Refs
  dropZone: HTMLElement;
  fileInput: HTMLInputElement;
  
  attached(): void {
    BrowserPrint('INFO', 'File manager attached');
    this.loadFiles();
  }
  
  searchFilterChanged(): void {
    this.filterFiles();
  }
  
  filterFiles(): void {
    if (!this.searchFilter) {
      this.filteredFiles = [...this.files];
    } else {
      const filter = this.searchFilter.toLowerCase();
      this.filteredFiles = this.files.filter(f => 
        f.displayName.toLowerCase().includes(filter)
      );
    }
    this.sortFiles();
  }
  
  sort(column: string): void {
    if (this.sortColumn === column) {
      this.sortAscending = !this.sortAscending;
    } else {
      this.sortColumn = column;
      this.sortAscending = true;
    }
    this.sortFiles();
  }
  
  sortFiles(): void {
    this.filteredFiles.sort((a, b) => {
      let aVal = a[this.sortColumn];
      let bVal = b[this.sortColumn];
      
      if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase();
        bVal = bVal.toLowerCase();
      }
      
      if (aVal < bVal) return this.sortAscending ? -1 : 1;
      if (aVal > bVal) return this.sortAscending ? 1 : -1;
      return 0;
    });
  }
  
  async loadFiles(): Promise<void> {
    try {
      const response = await fetch('/_cat/files');
      if (response.ok) {
        const reqHeader = response.headers.get('REQ');
        if (reqHeader) {
          const decoded = JSON.parse(atob(reqHeader));
          if (decoded.success) {
            this.files = decoded.body.files || [];
            this.filterFiles();
            BrowserPrint('INFO', `Loaded ${this.files.length} files`);
          }
        }
      }
    } catch (e) {
      BrowserPrint('ERROR', `Failed to load files: ${e.message}`);
    }
  }
  
  handleDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dropZone.classList.add('drag-over');
  }
  
  handleDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.dropZone.classList.remove('drag-over');
  }
  
  handleDrop(event: DragEvent): void {
    event.preventDefault();
    this.dropZone.classList.remove('drag-over');
    
    const files = event.dataTransfer?.files;
    if (files) {
      this.uploadFiles(files);
    }
  }
  
  handleFileSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files) {
      this.uploadFiles(input.files);
    }
  }
  
  async uploadFiles(files: FileList): Promise<void> {
    for (const file of Array.from(files)) {
      await this.uploadFile(file);
    }
    await this.loadFiles();
  }
  
  async uploadFile(file: File): Promise<void> {
    BrowserPrint('INFO', `Uploading ${file.name}...`);
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });
      
      if (response.ok) {
        BrowserPrint('SUCCESS', `Uploaded ${file.name}`);
      } else {
        BrowserPrint('ERROR', `Failed to upload ${file.name}`);
      }
    } catch (e) {
      BrowserPrint('ERROR', `Upload error: ${e.message}`);
    }
  }
  
  async downloadFile(file: FileInfo): Promise<void> {
    const filename = file.storedName || file.hash;
    window.location.href = `/api/download/${filename}`;
  }
  
  async deleteFile(file: FileInfo): Promise<void> {
    if (!confirm(`Delete ${file.displayName}?`)) return;
    
    try {
      const filename = file.storedName || file.hash;
      const response = await fetch(`/api/delete/${filename}`, {
        method: 'DELETE'
      });
      
      if (response.ok) {
        BrowserPrint('SUCCESS', `Deleted ${file.displayName}`);
        await this.loadFiles();
      }
    } catch (e) {
      BrowserPrint('ERROR', `Delete failed: ${e.message}`);
    }
  }
  
  async downloadAll(): Promise<void> {
    BrowserPrint('INFO', 'Downloading all files...');
    // Implementation depends on backend support
  }
}