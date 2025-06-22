// FileHandler Class for file management with oversize handling
class FileHandler {
  constructor(websocket, mode = 'client') {
    this.ws = websocket;
    this.mode = mode;
    this.files = [];
    this.oversizeThreshold = 50 * 1024 * 1024; // 50MB default, will be updated from server config
    this.websocketSizeLimit = 50 * 1024 * 1024; // 50MB WebSocket limit
    this.legacyUploadLimit = 10 * 1024 * 1024; // 10MB legacy upload limit
    this.setupFileListUpdates();
  }

  setupFileListUpdates() {
    // Enhanced fallback polling - always poll if WebSocket disconnected
    this.httpPollingInterval = setInterval(() => {
      if (this.ws.readyState !== WebSocket.OPEN) {
        this.fetchFileListViaHttp();
        console.log("WebSocket disconnected, using HTTP fallback for file list");
      }
    }, 5000);
    
    // Also poll immediately if WebSocket fails to connect within 5 seconds
    setTimeout(() => {
      if (this.ws.readyState !== WebSocket.OPEN) {
        console.warn("WebSocket failed to connect, enabling HTTP-only mode");
        this.enableHttpOnlyMode();
      }
    }, 5000);
  }
  
  enableHttpOnlyMode() {
    console.log("Enabling HTTP-only mode for file operations");
    // Start aggressive polling for file list updates
    clearInterval(this.httpPollingInterval);
    this.httpPollingInterval = setInterval(() => {
      this.fetchFileListViaHttp();
    }, 2000); // Poll every 2 seconds in HTTP-only mode
  }

  async fetchFileListViaHttp() {
    try {
      const response = await fetch('/api/files');
      if (response.ok) {
        const reqHeader = response.headers.get('REQ');
        if (reqHeader) {
          const decoded = JSON.parse(atob(reqHeader));
          if (decoded.success) {
            this.updateFileList(decoded.body.files);
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch file list via HTTP:', error);
    }
  }

  updateFileList(files) {
    this.files = files;
    this.renderFileTable();
  }

  renderFileTable() {
    const tbody = document.getElementById('fileTableBody');
    tbody.innerHTML = '';

    // Apply search filter
    const searchTerm = document.getElementById('fileSearchFilter').value.toLowerCase();
    const filteredFiles = this.files.filter(file =>
      file.displayName.toLowerCase().includes(searchTerm) ||
      file.hash.toLowerCase().includes(searchTerm) ||
      file.uploaderHostname.toLowerCase().includes(searchTerm)
    );

    filteredFiles.forEach(file => {
      const row = tbody.insertRow();
      row.innerHTML = `
        <td>${file.displayName}</td>
        <td>${this.formatFileSize(file.size)}</td>
        <td>${new Date(file.timestamp).toLocaleString()}</td>
        <td>${file.uploaderHostname}</td>
        <td class="hash-cell">${file.hash}</td>
        <td>
          <button class="download-btn" data-filename="${file.storedName}">Download</button>
        </td>
      `;

      // Add download button functionality
      const downloadBtn = row.querySelector('.download-btn');
      downloadBtn.addEventListener('click', () => {
        this.downloadFile(file.storedName);
      });

      // Right-click context menu
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.showContextMenu(e, file);
      });
    });
  }

  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  async handleDownloadAll() {
    const oversizeFiles = this.files.filter(f => f.size > this.oversizeThreshold);

    if (this.mode === 'client' && oversizeFiles.length > 0) {
      const proceed = await this.showOversizeDialog(oversizeFiles);
      if (!proceed) return;
    }

    // Download all files
    for (const file of this.files) {
      if (this.mode === 'client' && oversizeFiles.includes(file)) {
        // Check individual preference for oversize files
        const downloadThis = await this.showSingleFileDialog(file);
        if (!downloadThis) continue;
      }
      this.downloadFile(file.storedName);
    }
  }

  showOversizeDialog(files) {
    return new Promise((resolve) => {
      const dialog = document.createElement('div');
      dialog.className = 'oversize-dialog';
      dialog.innerHTML = `
        <div class="dialog-content">
          <h3>Large Files Detected</h3>
          <p>The following files exceed ${this.oversizeThreshold / 1024 / 1024}MB:</p>
          <ul>
            ${files.map(f => `<li>${f.displayName} (${this.formatFileSize(f.size)})</li>`).join('')}
          </ul>
          <div class="dialog-buttons">
            <button class="proceed-btn">Download Files Anyway</button>
            <button class="cancel-btn">Skip These Files</button>
          </div>
        </div>
      `;
      
      dialog.querySelector('.proceed-btn').onclick = () => {
        document.body.removeChild(dialog);
        resolve(true);
      };
      
      dialog.querySelector('.cancel-btn').onclick = () => {
        document.body.removeChild(dialog);
        resolve(false);
      };
      
      document.body.appendChild(dialog);
    });
  }

  showSingleFileDialog(file) {
    return new Promise((resolve) => {
      const dialog = document.createElement('div');
      dialog.className = 'oversize-dialog';
      dialog.innerHTML = `
        <div class="dialog-content">
          <h3>Large File</h3>
          <p>Download ${file.displayName} (${this.formatFileSize(file.size)})?</p>
          <div class="dialog-buttons">
            <button class="proceed-btn">Download</button>
            <button class="cancel-btn">Skip</button>
          </div>
        </div>
      `;
      
      dialog.querySelector('.proceed-btn').onclick = () => {
        document.body.removeChild(dialog);
        resolve(true);
      };
      
      dialog.querySelector('.cancel-btn').onclick = () => {
        document.body.removeChild(dialog);
        resolve(false);
      };
      
      document.body.appendChild(dialog);
    });
  }

  async uploadFile(file) {
    try {
      // Check file size - if > WebSocket limit, use streaming HTTP directly
      if (file.size > this.websocketSizeLimit) {
        console.log(`Large file detected (${this.formatFileSize(file.size)}), using streaming HTTP upload`);
        await this.uploadFileViaHttp(file);
        return;
      }

      // For smaller files, use memory-efficient chunked WebSocket upload
      const fileId = 'file_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      const chunkSize = 32768; // 32KB chunks for better memory management
      const totalChunks = Math.ceil(file.size / chunkSize);
      
      console.log(`Uploading ${file.name} via WebSocket: ${totalChunks} chunks of ${chunkSize} bytes`);
      
      for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, file.size);
        
        // Read chunk directly from file using slice() - no full file load
        const chunkBlob = file.slice(start, end);
        const chunkArrayBuffer = await chunkBlob.arrayBuffer();
        const chunkBase64 = btoa(String.fromCharCode(...new Uint8Array(chunkArrayBuffer)));
        
        const chunkMessage = {
          type: 'file_chunk',
          req: btoa(JSON.stringify({
            success: true,
            body: {
              fileId,
              chunkIndex: i,
              totalChunks,
              data: chunkBase64,
              metadata: {
                filename: file.name,
                totalSize: file.size
              }
            }
          }))
        };
        
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify(chunkMessage));
          
          // Add small delay to prevent overwhelming the connection
          if (i % 10 === 0) {
            await new Promise(resolve => setTimeout(resolve, 10));
          }
        } else {
          console.log('WebSocket disconnected during upload, falling back to HTTP');
          await this.uploadFileViaHttp(file);
          break;
        }
      }
      
      console.log(`File upload initiated: ${file.name} (${this.formatFileSize(file.size)})`);
    } catch (error) {
      console.error('File upload failed:', error);
      
      // Fallback to HTTP if WebSocket upload fails
      try {
        console.log('Attempting HTTP fallback upload...');
        await this.uploadFileViaHttp(file);
      } catch (httpError) {
        console.error('HTTP fallback also failed:', httpError);
      }
    }
  }

  async uploadFileViaHttp(file) {
    try {
      // Use streaming FormData upload instead of base64
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });
      
      if (response.ok) {
        const result = await response.json();
        console.log(`File uploaded via HTTP streaming: ${file.name}`, result);
      } else {
        console.error(`HTTP upload failed with status ${response.status}:`, await response.text());
      }
    } catch (error) {
      console.error('HTTP file upload failed:', error);
      
      // Fallback to legacy base64 upload
      console.log('Trying legacy base64 upload as fallback...');
      await this.uploadFileViaHttpLegacy(file);
    }
  }

  async uploadFileViaHttpLegacy(file) {
    try {
      // Only use legacy method for files under the configured limit to prevent memory crashes
      if (file.size > this.legacyUploadLimit) {
        console.error(`File too large for legacy upload: ${this.formatFileSize(file.size)} > ${this.formatFileSize(this.legacyUploadLimit)}`);
        throw new Error('File too large for legacy base64 upload');
      }

      const arrayBuffer = await file.arrayBuffer();
      const base64Data = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
      
      const response = await fetch('/api/upload-legacy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'REQ': btoa(JSON.stringify({
            success: true,
            body: {
              filename: file.name,
              data: base64Data
            }
          }))
        }
      });
      
      if (response.ok) {
        console.log(`File uploaded via legacy HTTP: ${file.name}`);
      } else {
        throw new Error(`Legacy upload failed with status ${response.status}`);
      }
    } catch (error) {
      console.error('Legacy HTTP file upload failed:', error);
      throw error;
    }
  }

  downloadFile(filename) {
    const link = document.createElement('a');
    link.href = `/api/download/${filename}`;
    link.download = filename;
    link.click();
  }

  showContextMenu(event, file) {
    const contextMenu = document.getElementById('contextMenu');
    contextMenu.style.left = event.pageX + 'px';
    contextMenu.style.top = event.pageY + 'px';
    contextMenu.classList.remove('hidden');
    
    // Remove existing event listeners
    const newContextMenu = contextMenu.cloneNode(true);
    contextMenu.parentNode.replaceChild(newContextMenu, contextMenu);
    
    // Add new event listeners
    newContextMenu.querySelector('#contextDownload').onclick = () => {
      this.downloadFile(file.storedName);
      newContextMenu.classList.add('hidden');
    };
    
    newContextMenu.querySelector('#contextSync').onclick = () => {
      this.downloadFile(file.storedName);
      newContextMenu.classList.add('hidden');
    };
    
    newContextMenu.querySelector('#contextDelete').onclick = () => {
      // TODO: Implement delete functionality
      console.log('Delete not implemented yet');
      newContextMenu.classList.add('hidden');
    };
    
    // Hide context menu when clicking elsewhere
    document.addEventListener('click', () => {
      newContextMenu.classList.add('hidden');
    }, { once: true });
  }
}

// ModeManager Class for client/peer mode switching
class ModeManager {
  constructor(fileHandler) {
    this.fileHandler = fileHandler;
    this.mode = 'client';
    this.isLocalConnection = this.detectLocalConnection();
    this.setupModeUI();
  }

  detectLocalConnection() {
    const hostname = window.location.hostname;
    return ['0.0.0.0', '127.0.0.1', 'localhost'].includes(hostname) ||
           hostname.match(/^10\./) || hostname.match(/^192\.168\./);
  }

  setupModeUI() {
    const modeBtn = document.getElementById('modeIndicator');
    const peerUI = document.getElementById('peerConnectUI');

    if (this.isLocalConnection) {
      modeBtn.classList.remove('client-mode');
      modeBtn.classList.add('peer-mode');
      modeBtn.disabled = false;
      modeBtn.textContent = 'Peer Mode';

      modeBtn.addEventListener('click', () => {
        peerUI.classList.toggle('hidden');
      });

      // Validate peer input
      const peerInput = document.getElementById('peerHostInput');
      const connectBtn = document.getElementById('peerConnectBtn');

      peerInput.addEventListener('input', () => {
        const valid = /^https?:\/\/[\w\.-]+:\d+$/.test(peerInput.value);
        connectBtn.disabled = !valid;
      });

      connectBtn.addEventListener('click', () => this.attemptPeerConnection());
    }
  }

  async attemptPeerConnection() {
    const peerUrl = document.getElementById('peerHostInput').value;

    try {
      const response = await fetch(`${peerUrl}/handshake`, {
        method: 'POST',
        headers: {
          'REQ': btoa(JSON.stringify({
            success: true,
            body: {
              action: 'peer_handshake',
              myHostname: window.location.hostname,
              myPort: window.location.port
            }
          }))
        }
      });

      if (response.ok) {
        this.mode = 'peer';
        this.fileHandler.mode = 'peer';
        const modeBtn = document.getElementById('modeIndicator');
        modeBtn.className = 'mode-indicator peer-connected';
        modeBtn.textContent = 'Connected to Peer';
        document.getElementById('downloadAllBtn').textContent = 'Sync All';

        // Start peer sync
        this.startPeerSync();
      }
    } catch (error) {
      console.error('Peer connection failed:', error);
    }
  }

  startPeerSync() {
    // In peer mode, sync all automatically downloads everything
    const downloadAllBtn = document.getElementById('downloadAllBtn');
    const newBtn = downloadAllBtn.cloneNode(true);
    downloadAllBtn.parentNode.replaceChild(newBtn, downloadAllBtn);
    
    newBtn.addEventListener('click', async () => {
      // No size prompts for peers - they must accept all
      for (const file of this.fileHandler.files) {
        await this.fileHandler.downloadFile(file.storedName);
      }
    });
  }
}

// TableSorter Class for sortable file table
class TableSorter {
  constructor(tableId) {
    this.table = document.getElementById(tableId);
    this.sortState = {};
    this.setupSorting();
  }

  setupSorting() {
    const headers = this.table.querySelectorAll('th.sortable');

    headers.forEach(header => {
      // Store original text for reliable restoration
      if (!header.dataset.originalText) {
        header.dataset.originalText = header.textContent.trim();
      }
      
      header.addEventListener('click', () => {
        const field = header.dataset.sort;
        const ascending = this.sortState[field] !== 'asc';
        this.sortState[field] = ascending ? 'asc' : 'desc';

        this.sortTable(field, ascending);
        this.updateSortIndicators(header, ascending);
      });
    });
  }

  sortTable(field, ascending) {
    const tbody = this.table.querySelector('tbody');
    const rows = Array.from(tbody.rows);

    rows.sort((a, b) => {
      const aVal = a.cells[this.getColumnIndex(field)].textContent;
      const bVal = b.cells[this.getColumnIndex(field)].textContent;

      if (field === 'size') {
        const aSize = this.parseFileSize(aVal);
        const bSize = this.parseFileSize(bVal);
        return ascending ? aSize - bSize : bSize - aSize;
      } else if (field === 'timestamp') {
        const aTime = new Date(aVal).getTime();
        const bTime = new Date(bVal).getTime();
        return ascending ? aTime - bTime : bTime - aTime;
      }

      return ascending ?
        aVal.localeCompare(bVal) :
        bVal.localeCompare(aVal);
    });

    rows.forEach(row => tbody.appendChild(row));
  }

  getColumnIndex(field) {
    const headerMap = {
      'displayName': 0,
      'size': 1,
      'timestamp': 2,
      'uploaderHostname': 3,
      'hash': 4
    };
    return headerMap[field] || 0;
  }

  parseFileSize(sizeStr) {
    const parts = sizeStr.split(' ');
    const value = parseFloat(parts[0]);
    const unit = parts[1];
    
    const multipliers = {
      'Bytes': 1,
      'KB': 1024,
      'MB': 1024 * 1024,
      'GB': 1024 * 1024 * 1024
    };
    
    return value * (multipliers[unit] || 1);
  }

  updateSortIndicators(activeHeader, ascending) {
    // Reset all headers to their original text only (no arrows)
    this.table.querySelectorAll('th.sortable').forEach(header => {
      const originalText = header.dataset.originalText || header.textContent.trim();
      header.textContent = originalText;
    });
    
    // Add direction arrow only to the active header
    const arrow = ascending ? ' ↑' : ' ↓';
    const originalActiveText = activeHeader.dataset.originalText || activeHeader.textContent.trim();
    activeHeader.textContent = originalActiveText + arrow;
  }
}