import { resolve } from 'aurelia';
import { IFileService, IRequestEncoderService } from './contracts';
import type { FileInfo } from '../../shared/types';

export class FileService implements IFileService {
  constructor(
    private reqEncoder: IRequestEncoderService = resolve(IRequestEncoderService)
  ) {}

  async getFileList(): Promise<FileInfo[]> {
    try {
      const response = await fetch('/api/files');
      const reqHeader = response.headers.get('REQ');
      
      if (reqHeader) {
        const decoded = this.reqEncoder.decode<{ files: FileInfo[] }>(reqHeader);
        if (decoded.success) {
          return decoded.body.files;
        }
      }
      
      throw new Error('Failed to get file list');
    } catch (error) {
      console.error('File list request failed:', error);
      return [];
    }
  }

  async uploadFile(file: File): Promise<void> {
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
      }

      console.log('File uploaded successfully:', file.name);
    } catch (error) {
      console.error('File upload failed:', error);
      throw error;
    }
  }

  downloadFile(filename: string): void {
    const downloadUrl = `/api/download/${encodeURIComponent(filename)}`;
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  async deleteFile(filename: string): Promise<boolean> {
    try {
      const response = await fetch(`/api/delete/${encodeURIComponent(filename)}`, {
        method: 'DELETE'
      });

      return response.ok;
    } catch (error) {
      console.error('File deletion failed:', error);
      return false;
    }
  }
}