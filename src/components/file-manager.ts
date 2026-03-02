import { BrowserPrint } from '../browser-logger';
import { CollaborationService } from '../services/collaboration.service';
import { AdminService, AdminState } from '../services/admin.service';
import { inject } from 'aurelia';

interface FileInfo {
  hash: string;
  displayName: string;
  size: number;
  timestamp: number;
  uploaderHostname: string;
  storedName?: string;
}

@inject(CollaborationService, AdminService)
export class FileManager {
  files: FileInfo[] = [];
  filteredFiles: FileInfo[] = [];
  searchFilter: string = '';
  sortColumn: string = 'timestamp';
  sortAscending: boolean = false;
  isConnected: boolean = false;

  // Admin state
  isAdminMode: boolean = false;
  isAdminAuthenticated: boolean = false;
  showAdminActions: boolean = false; // Computed from isAdminMode && isAdminAuthenticated
  activeActionsMenu: string | null = null; // Track which file's action menu is open

  // Refs
  dropZone: HTMLElement;
  fileInput: HTMLInputElement;

  private fileUpdateUnsubscribe?: () => void;
  private connectionUnsubscribe?: () => void;
  private adminUnsubscribe?: () => void;

  // Use constructor injection
  constructor(
    private collaboration: CollaborationService,
    private adminService: AdminService
  ) {}
  
  attached(): void {
    BrowserPrint('INFO', 'File manager attached');

    // Service is already injected and available
    this.fileUpdateUnsubscribe = this.collaboration.subscribeToFileUpdates((files) => {
      BrowserPrint('INFO', `Received file list update: ${files.length} files`);
      this.files = files;
      this.filterFiles();
    });

    // Subscribe to connection status
    this.connectionUnsubscribe = this.collaboration.subscribeToConnection((connected) => {
      this.isConnected = connected;
    });

    // Subscribe to admin state changes
    this.adminUnsubscribe = this.adminService.subscribe((state: AdminState) => {
      this.isAdminMode = state.isAdminMode;
      this.isAdminAuthenticated = state.isAuthenticated;
      this.showAdminActions = state.isAdminMode && state.isAuthenticated;
      BrowserPrint('DEBUG', `Admin state updated: mode=${state.isAdminMode}, auth=${state.isAuthenticated}, showActions=${this.showAdminActions}`);
    });

    // Close action menu when clicking outside
    document.addEventListener('click', this.handleDocumentClick);

    // Initial load
    this.loadFiles();
  }

  detached(): void {
    BrowserPrint('INFO', 'File manager detached');
    this.fileUpdateUnsubscribe?.();
    this.connectionUnsubscribe?.();
    this.adminUnsubscribe?.();
    document.removeEventListener('click', this.handleDocumentClick);
  }

  private handleDocumentClick = (event: MouseEvent): void => {
    const target = event.target as HTMLElement;
    if (!target.closest('.actions-menu-container')) {
      this.activeActionsMenu = null;
    }
  };
  
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

  // Actions menu methods
  toggleActionsMenu(file: FileInfo, event: MouseEvent): void {
    event.stopPropagation();
    const fileId = file.storedName || file.hash;
    BrowserPrint('DEBUG', `Toggle actions menu for file: ${fileId}, current active: ${this.activeActionsMenu}`);
    if (this.activeActionsMenu === fileId) {
      this.activeActionsMenu = null;
    } else {
      this.activeActionsMenu = fileId;
    }
    BrowserPrint('DEBUG', `Actions menu now: ${this.activeActionsMenu}`);
  }

  // Admin file management methods
  async archiveFile(file: FileInfo): Promise<void> {
    if (!this.isAdminAuthenticated) {
      BrowserPrint('WARNING', 'Archive attempted without admin authentication');
      return;
    }

    const filename = file.storedName || file.hash;
    if (!confirm(`Archive ${file.displayName}? The file will be moved to the archived folder.`)) {
      return;
    }

    this.activeActionsMenu = null;
    const success = await this.adminService.archiveFile(filename);
    if (success) {
      await this.loadFiles();
    }
  }

  async adminDeleteFile(file: FileInfo): Promise<void> {
    if (!this.isAdminAuthenticated) {
      BrowserPrint('WARNING', 'Delete attempted without admin authentication');
      return;
    }

    const filename = file.storedName || file.hash;
    if (!confirm(`PERMANENTLY DELETE ${file.displayName}? This action cannot be undone!`)) {
      return;
    }

    this.activeActionsMenu = null;
    const success = await this.adminService.deleteFilePermanently(filename);
    if (success) {
      await this.loadFiles();
    }
  }

}