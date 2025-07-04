import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { Print, ErrorInterceptor, RequestEncoder, FileManager } from '../../../server/utilities';

// Mock fs module
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    appendFileSync: vi.fn(),
    promises: {
      writeFile: vi.fn(),
      rename: vi.fn(),
      unlink: vi.fn(),
      readFile: vi.fn(),
    },
  },
}));

// Mock console methods
const mockConsole = {
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
};

describe('utilities.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock console methods
    vi.spyOn(console, 'log').mockImplementation(mockConsole.log);
    vi.spyOn(console, 'error').mockImplementation(mockConsole.error);
    vi.spyOn(console, 'warn').mockImplementation(mockConsole.warn);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Print() function', () => {
    it('should handle SUCCESS log type', () => {
      Print('SUCCESS', 'Test success message');
      
      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('SUCCESS')
      );
      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('^^^ Test success message ^^^')
      );
    });

    it('should handle FAILURE log type', () => {
      Print('FAILURE', 'Test failure message');
      
      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('FAILURE')
      );
      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('### Test failure message ###')
      );
    });

    it('should handle STATE log type', () => {
      Print('STATE', 'Test state message');
      
      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('STATE')
      );
      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('~~~ Test state message ~~~')
      );
    });

    it('should handle INFO log type', () => {
      Print('INFO', 'Test info message');
      
      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('INFO')
      );
      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('--- Test info message ---')
      );
    });

    it('should handle IMPORTANT log type', () => {
      Print('IMPORTANT', 'Test important message');
      
      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('IMPORTANT')
      );
      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('=== Test important message ===')
      );
    });

    it('should handle CRITICAL log type', () => {
      Print('CRITICAL', 'Test critical message');
      
      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('CRITICAL')
      );
      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('*** Test critical message ***')
      );
    });

    it('should handle EXCEPTION log type', () => {
      Print('EXCEPTION', 'Test exception message');
      
      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('EXCEPTION')
      );
      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('!!! Test exception message !!!')
      );
    });

    it('should handle WARNING log type', () => {
      Print('WARNING', 'Test warning message');
      
      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('WARNING')
      );
      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('((( Test warning message )))')
      );
    });

    it('should handle DEBUG log type', () => {
      Print('DEBUG', 'Test debug message');
      
      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('DEBUG')
      );
      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('[[[ Test debug message ]]]')
      );
    });

    it('should handle ATTEMPT log type', () => {
      Print('ATTEMPT', 'Test attempt message');
      
      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('ATTEMPT')
      );
      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('??? Test attempt message ???')
      );
    });

    it('should handle STARTING log type', () => {
      Print('STARTING', 'Test starting message');
      
      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('STARTING')
      );
      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('>>> Test starting message >>>')
      );
    });

    it('should handle PROGRESS log type', () => {
      Print('PROGRESS', 'Test progress message');
      
      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('PROGRESS')
      );
      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('vvv Test progress message vvv')
      );
    });

    it('should handle COMPLETED log type', () => {
      Print('COMPLETED', 'Test completed message');
      
      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('COMPLETED')
      );
      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('<<< Test completed message <<<')
      );
    });

    it('should handle ERROR log type', () => {
      Print('ERROR', 'Test error message');
      
      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('ERROR')
      );
      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringContaining('### Test error message ###')
      );
    });

    it('should handle TRACE log type and not log to console by default', () => {
      Print('TRACE', 'Test trace message');
      
      // TRACE logs should not appear in console output
      expect(mockConsole.log).not.toHaveBeenCalled();
    });

    it('should write to appropriate log files', () => {
      const mockAppendFileSync = vi.mocked(fs.appendFileSync);
      
      Print('INFO', 'Test info message');
      Print('ERROR', 'Test error message');
      Print('DEBUG', 'Test debug message');
      
      // Should write to access.log for INFO
      expect(mockAppendFileSync).toHaveBeenCalledWith(
        expect.stringContaining('access.log'),
        expect.stringContaining('Test info message')
      );
      
      // Should write to error.log for ERROR
      expect(mockAppendFileSync).toHaveBeenCalledWith(
        expect.stringContaining('error.log'),
        expect.stringContaining('Test error message')
      );
      
      // Should write to debug.log for DEBUG
      expect(mockAppendFileSync).toHaveBeenCalledWith(
        expect.stringContaining('debug.log'),
        expect.stringContaining('Test debug message')
      );
    });

    it('should include timestamp in log output', () => {
      Print('INFO', 'Test message');
      
      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringMatching(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/)
      );
    });

    it('should handle file write errors gracefully', () => {
      const mockAppendFileSync = vi.mocked(fs.appendFileSync);
      mockAppendFileSync.mockImplementation(() => {
        throw new Error('File write failed');
      });
      
      // Should not throw error
      expect(() => Print('INFO', 'Test message')).not.toThrow();
      
      // Should log error to console
      expect(mockConsole.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to write to log file')
      );
    });
  });

  describe('RequestEncoder class', () => {
    describe('encode() method', () => {
      it('should encode success response correctly', () => {
        const result = RequestEncoder.encode(true, { data: 'test' });
        const decoded = JSON.parse(Buffer.from(result, 'base64').toString());
        
        expect(decoded).toEqual({
          success: true,
          body: { data: 'test' }
        });
      });

      it('should encode failure response correctly', () => {
        const result = RequestEncoder.encode(false, { error: 'failed' });
        const decoded = JSON.parse(Buffer.from(result, 'base64').toString());
        
        expect(decoded).toEqual({
          success: false,
          body: { error: 'failed' }
        });
      });

      it('should handle null body', () => {
        const result = RequestEncoder.encode(true, null);
        const decoded = JSON.parse(Buffer.from(result, 'base64').toString());
        
        expect(decoded).toEqual({
          success: true,
          body: null
        });
      });
    });

    describe('decode() method', () => {
      it('should decode valid base64 REQ header correctly', () => {
        const encoded = RequestEncoder.encode(true, { test: 'data' });
        const result = RequestEncoder.decode(encoded);
        
        expect(result).toEqual({
          success: true,
          body: { test: 'data' }
        });
      });

      it('should handle invalid base64 gracefully', () => {
        const result = RequestEncoder.decode('invalid-base64');
        
        expect(result).toEqual({
          success: false,
          body: { error: 'Invalid REQ header' }
        });
      });

      it('should handle non-JSON base64 gracefully', () => {
        const invalidJson = Buffer.from('not-json').toString('base64');
        const result = RequestEncoder.decode(invalidJson);
        
        expect(result).toEqual({
          success: false,
          body: { error: 'Invalid REQ header' }
        });
      });
    });

    describe('validateSize() method', () => {
      it('should validate headers within size limit', () => {
        const shortHeader = RequestEncoder.encode(true, { data: 'test' });
        expect(RequestEncoder.validateSize(shortHeader)).toBe(true);
      });

      it('should reject headers exceeding size limit', () => {
        const longData = 'x'.repeat(3000);
        const longHeader = RequestEncoder.encode(true, { data: longData });
        expect(RequestEncoder.validateSize(longHeader)).toBe(false);
      });

      it('should handle empty string', () => {
        expect(RequestEncoder.validateSize('')).toBe(true);
      });
    });
  });

  describe('FileManager class', () => {
    let fileManager: FileManager;
    const mockConfig = {
      prog: {
        file_validation: {
          max_size_mb: 10,
          max_concurrent_uploads: 5
        }
      }
    };

    beforeEach(() => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      fileManager = new FileManager('/test/storage', mockConfig);
    });

    describe('constructor', () => {
      it('should create storage directory if it does not exist', () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);
        
        new FileManager('/test/storage', mockConfig);
        
        expect(fs.mkdirSync).toHaveBeenCalledWith('/test/storage', { recursive: true });
      });

      it('should not create directory if it already exists', () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        
        new FileManager('/test/storage', mockConfig);
        
        expect(fs.mkdirSync).not.toHaveBeenCalled();
      });
    });

    describe('generateUniqueFileId() method', () => {
      it('should generate unique file IDs', () => {
        const id1 = fileManager.generateUniqueFileId('test.txt');
        const id2 = fileManager.generateUniqueFileId('test.txt');
        
        expect(id1).not.toBe(id2);
        expect(typeof id1).toBe('string');
        expect(id1.length).toBeGreaterThan(0);
      });
    });

    describe('createFilenameWithId() method', () => {
      it('should create filename with ID correctly', () => {
        const result = fileManager.createFilenameWithId('test.txt', 'abc123');
        
        expect(result).toBe('test_abc123.txt');
      });

      it('should handle files without extension', () => {
        const result = fileManager.createFilenameWithId('README', 'abc123');
        
        expect(result).toBe('README_abc123');
      });

      it('should handle files with multiple dots', () => {
        const result = fileManager.createFilenameWithId('test.min.js', 'abc123');
        
        expect(result).toBe('test.min_abc123.js');
      });
    });

    describe('formatFileSize() method', () => {
      it('should format bytes correctly', () => {
        expect(fileManager.formatFileSize(0)).toBe('0 Bytes');
        expect(fileManager.formatFileSize(1024)).toBe('1 KB');
        expect(fileManager.formatFileSize(1048576)).toBe('1 MB');
        expect(fileManager.formatFileSize(1073741824)).toBe('1 GB');
      });

      it('should handle decimal values', () => {
        expect(fileManager.formatFileSize(1536)).toBe('1.5 KB');
        expect(fileManager.formatFileSize(1572864)).toBe('1.5 MB');
      });
    });

    describe('handleFileUpload() method', () => {
      it('should handle file upload successfully', async () => {
        const mockBuffer = Buffer.from('test file content');
        const mockMetadata = {
          filename: 'test.txt',
          hostname: 'localhost',
          size: mockBuffer.length
        };

        vi.mocked(fs.promises.writeFile).mockResolvedValue(undefined);

        const result = await fileManager.handleFileUpload(mockBuffer, mockMetadata);

        expect(result.displayName).toBe('test.txt');
        expect(result.size).toBe(mockBuffer.length);
        expect(result.uploaderHostname).toBe('localhost');
        expect(result.storedName).toContain('test_');
        expect(result.storedName).toContain('.txt');
      });

      it('should handle file upload errors', async () => {
        const mockBuffer = Buffer.from('test file content');
        const mockMetadata = {
          filename: 'test.txt',
          hostname: 'localhost'
        };

        vi.mocked(fs.promises.writeFile).mockRejectedValue(new Error('Write failed'));

        await expect(fileManager.handleFileUpload(mockBuffer, mockMetadata)).rejects.toThrow('Write failed');
      });
    });

    describe('handleFileUploadStreaming() method', () => {
      it('should handle streaming upload successfully', async () => {
        const mockMetadata = {
          filename: 'large-file.txt',
          hostname: 'localhost',
          size: 1048576
        };

        vi.mocked(fs.promises.rename).mockResolvedValue(undefined);

        const result = await fileManager.handleFileUploadStreaming('/tmp/temp-file', mockMetadata);

        expect(result.displayName).toBe('large-file.txt');
        expect(result.size).toBe(1048576);
        expect(result.uploaderHostname).toBe('localhost');
        expect(fs.promises.rename).toHaveBeenCalledWith(
          '/tmp/temp-file',
          expect.stringContaining('large-file_')
        );
      });

      it('should cleanup temp file on error', async () => {
        const mockMetadata = {
          filename: 'test.txt',
          hostname: 'localhost'
        };

        vi.mocked(fs.promises.rename).mockRejectedValue(new Error('Rename failed'));
        vi.mocked(fs.promises.unlink).mockResolvedValue(undefined);

        await expect(fileManager.handleFileUploadStreaming('/tmp/temp-file', mockMetadata)).rejects.toThrow('Rename failed');
        expect(fs.promises.unlink).toHaveBeenCalledWith('/tmp/temp-file');
      });
    });

    describe('fileExists() method', () => {
      it('should check if file exists', () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        
        expect(fileManager.fileExists('test.txt')).toBe(true);
        expect(fs.existsSync).toHaveBeenCalledWith(
          expect.stringContaining('test.txt')
        );
      });

      it('should return false for non-existent files', () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);
        
        expect(fileManager.fileExists('nonexistent.txt')).toBe(false);
      });
    });

    describe('deleteFile() method', () => {
      it('should delete existing file', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.promises.unlink).mockResolvedValue(undefined);
        
        const result = await fileManager.deleteFile('test.txt');
        
        expect(result).toBe(true);
        expect(fs.promises.unlink).toHaveBeenCalledWith(
          expect.stringContaining('test.txt')
        );
      });

      it('should return false for non-existent files', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);
        
        const result = await fileManager.deleteFile('nonexistent.txt');
        
        expect(result).toBe(false);
        expect(fs.promises.unlink).not.toHaveBeenCalled();
      });

      it('should handle deletion errors', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.promises.unlink).mockRejectedValue(new Error('Delete failed'));
        
        await expect(fileManager.deleteFile('test.txt')).rejects.toThrow('Delete failed');
      });
    });

    describe('getFileData() method', () => {
      it('should read file data successfully', async () => {
        const mockBuffer = Buffer.from('file content');
        vi.mocked(fs.promises.readFile).mockResolvedValue(mockBuffer);
        
        const result = await fileManager.getFileData('test.txt');
        
        expect(result).toBe(mockBuffer);
        expect(fs.promises.readFile).toHaveBeenCalledWith(
          expect.stringContaining('test.txt')
        );
      });

      it('should handle read errors', async () => {
        vi.mocked(fs.promises.readFile).mockRejectedValue(new Error('Read failed'));
        
        await expect(fileManager.getFileData('test.txt')).rejects.toThrow('Read failed');
      });
    });

    describe('getFileList() method', () => {
      it('should return empty array initially', () => {
        const result = fileManager.getFileList();
        expect(result).toEqual([]);
      });

      it('should return files after upload', async () => {
        const mockBuffer = Buffer.from('test content');
        const mockMetadata = {
          filename: 'test.txt',
          hostname: 'localhost'
        };

        vi.mocked(fs.promises.writeFile).mockResolvedValue(undefined);
        
        await fileManager.handleFileUpload(mockBuffer, mockMetadata);
        const result = fileManager.getFileList();
        
        expect(result).toHaveLength(1);
        expect(result[0].displayName).toBe('test.txt');
      });
    });
  });

  describe('ErrorInterceptor() function', () => {
    it('should call ErrorInterceptor without throwing', () => {
      expect(() => ErrorInterceptor()).not.toThrow();
    });

    it('should set up process event listeners', () => {
      const mockOn = vi.fn();
      const originalOn = process.on;
      process.on = mockOn;
      
      ErrorInterceptor();
      
      expect(mockOn).toHaveBeenCalledWith('uncaughtException', expect.any(Function));
      expect(mockOn).toHaveBeenCalledWith('unhandledRejection', expect.any(Function));
      expect(mockOn).toHaveBeenCalledWith('warning', expect.any(Function));
      expect(mockOn).toHaveBeenCalledWith('exit', expect.any(Function));
      expect(mockOn).toHaveBeenCalledWith('SIGINT', expect.any(Function));
      
      process.on = originalOn;
    });
  });
});