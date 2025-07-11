import colors from 'colors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import shorthash from 'shorthash2';

// ES module compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Logging configuration
interface LoggingConfig {
  enableTrace: boolean;
  enableDebug: boolean;
  logsDir: string;
  accessLogPath: string;
  errorLogPath: string;
  debugLogPath: string;
}

const LOGGING_CONFIG: LoggingConfig = {
  enableTrace: process.env.TRACE_LOGGING === 'true' || false,
  enableDebug: process.env.DEBUG_LOGGING === 'true' || process.env.TRACE_LOGGING === 'true' || true,
  logsDir: path.join(__dirname, '../logs'),
  accessLogPath: path.join(__dirname, '../logs', 'access.log'),
  errorLogPath: path.join(__dirname, '../logs', 'error.log'),
  debugLogPath: path.join(__dirname, '../logs', 'debug.log')
};

// Ensure logs directory exists
if (!fs.existsSync(LOGGING_CONFIG.logsDir)) {
  fs.mkdirSync(LOGGING_CONFIG.logsDir, { recursive: true });
}

type LogType = 'SUCCESS' | 'FAILURE' | 'STATE' | 'INFO' | 'IMPORTANT' | 'CRITICAL' | 
              'EXCEPTION' | 'WARNING' | 'DEBUG' | 'ATTEMPT' | 'STARTING' | 'PROGRESS' | 
              'COMPLETED' | 'ERROR' | 'TRACE';

export function Print(logType: LogType, message: string): void {
  const upperLogType = logType.toUpperCase() as LogType;

  // Check if we should log this level
  if (upperLogType === 'TRACE' && !LOGGING_CONFIG.enableTrace) return;
  if (upperLogType === 'DEBUG' && !LOGGING_CONFIG.enableDebug) return;

  const stack = new Error().stack;
  const stackLines = stack?.split("\n") || [];

  const callerLine = stackLines[2] ? stackLines[2].trim() : 'Unknown Caller Line';

  let functionName = 'Unknown Caller';

  const methodMatch = callerLine.match(/at (\S+) \(/);
  const constructorMatch = callerLine.match(/at new (\S+) \(/);
  const anonymousMatch = callerLine.match(/at (\S+) \(<anonymous>/);

  if (methodMatch) {
    functionName = methodMatch[1];
  } else if (constructorMatch) {
    functionName = `${constructorMatch[1]}.constructor`;
  } else if (anonymousMatch) {
    functionName = `${anonymousMatch[1]} (anonymous)`;
  }

  const logTypePadding = 10;
  const functionNamePadding = 40;

  const logTypeSymbols: Record<LogType, [string, string]> = {
    'SUCCESS': ['^^^', '^^^'],
    'FAILURE': ['###', '###'],
    'STATE': ['~~~', '~~~'],
    'INFO': ['---', '---'],
    'IMPORTANT': ['===', '==='],
    'CRITICAL': ['***', '***'],
    'EXCEPTION': ['!!!', '!!!'],
    'WARNING': ['(((', ')))'],
    'DEBUG': ['[[[', ']]]'],
    'ATTEMPT': ['???', '???'],
    'STARTING': ['>>>', '>>>'],
    'PROGRESS': ['vvv', 'vvv'],
    'COMPLETED': ['<<<', '<<<'],
    'ERROR': ['###', '###'],
    'TRACE': ['...', '...']
  };

  const logTypeColors: Record<LogType, (text: string) => string> = {
    'SUCCESS': colors.green,
    'FAILURE': colors.red.bold,
    'STATE': colors.cyan,
    'INFO': colors.blue,
    'IMPORTANT': colors.magenta,
    'CRITICAL': colors.red.bold,
    'EXCEPTION': colors.red.bold,
    'WARNING': colors.yellow,
    'DEBUG': colors.white,
    'ATTEMPT': colors.cyan,
    'STARTING': colors.green,
    'PROGRESS': colors.blue,
    'COMPLETED': colors.green,
    'ERROR': colors.red.bold,
    'TRACE': colors.gray
  };

  const symbols = logTypeSymbols[upperLogType] || ['', ''];
  const colorFunc = logTypeColors[upperLogType] || ((text: string) => text);
  const [beforeSymbol, afterSymbol] = symbols;

  const formattedMessage = colorFunc(`${beforeSymbol} ${message} ${afterSymbol}`);

  const timestamp = new Date().toISOString();

  const paddedLogType = upperLogType.padEnd(logTypePadding);
  const paddedFunctionName = functionName.padEnd(functionNamePadding);

  if (upperLogType !== 'TRACE') {
    console.log(`${paddedLogType}: ${timestamp} - ${paddedFunctionName} - ${formattedMessage}`);
  }

  const plainLogMessage = `${paddedLogType}: ${timestamp} - ${paddedFunctionName} - ${beforeSymbol} ${message} ${afterSymbol}`;

  writeToLogFiles(upperLogType, plainLogMessage);
}

function writeToLogFiles(logType: LogType, message: string): void {
  try {
    switch (logType) {
      case 'INFO':
      case 'WARNING':
      case 'STATE':
      case 'STARTING':
      case 'PROGRESS':
      case 'COMPLETED':
      case 'SUCCESS':
        fs.appendFileSync(LOGGING_CONFIG.accessLogPath, message + '\n');
        break;

      case 'ERROR':
      case 'EXCEPTION':
      case 'FAILURE':
      case 'CRITICAL':
        fs.appendFileSync(LOGGING_CONFIG.errorLogPath, message + '\n');
        break;

      case 'DEBUG':
      case 'TRACE':
      case 'ATTEMPT':
      case 'IMPORTANT':
        fs.appendFileSync(LOGGING_CONFIG.debugLogPath, message + '\n');
        break;
    }
  } catch (e) {
    console.error(`Failed to write to log file: ${(e as Error).message}`);
  }
}

export function ErrorInterceptor(): void {
  process.on('uncaughtException', (error: Error) => {
    Print('EXCEPTION', `Uncaught exception: ${error.message}`);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
    Print('EXCEPTION', `Unhandled promise rejection: ${reason}`);
    console.error('At Promise:', promise);
  });

  process.on('warning', (warning: NodeJS.ProcessWarning) => {
    Print('WARNING', `Node.js warning: ${warning.name} - ${warning.message}`);
    console.warn(warning.stack);
  });

  process.on('exit', (code: number) => {
    Print('INFO', `Process exiting with code: ${code}`);
  });

  process.on('SIGINT', () => {
    Print('INFO', 'Received SIGINT. Gracefully shutting down...');
    process.exit(0);
  });
}

export class RequestEncoder {
  static encode(success: boolean, body: any): string {
    return Buffer.from(JSON.stringify({ success, body })).toString('base64');
  }

  static decode(reqHeader: string): { success: boolean; body: any } {
    try {
      return JSON.parse(Buffer.from(reqHeader, 'base64').toString());
    } catch (e) {
      return { success: false, body: { error: 'Invalid REQ header' } };
    }
  }

  static validateSize(reqHeader: string): boolean {
    return reqHeader.length <= 2048;
  }
}

interface FileMetadata {
  filename: string;
  hostname: string;
  size?: number;
}

interface FileInfo {
  displayName: string;
  storedName: string;
  timestamp: number;
  uploaderHostname: string;
  size: number;
  hash: string;
}

interface Config {
  prog: {
    file_validation?: {
      max_size_mb?: number;
      max_concurrent_uploads?: number;
    };
    memory_management?: {
      max_temp_files?: number;
      cleanup_interval_ms?: number;
      max_temp_file_age_ms?: number;
    };
  };
}

export class FileManager {
  private storageDir: string;
  private config: Config;
  private fileMetadata: Map<string, FileInfo>;

  constructor(storageDir: string, config: Config) {
    this.storageDir = storageDir;
    this.config = config;
    this.fileMetadata = new Map();

    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
      Print('INFO', `Created storage directory: ${this.storageDir}`);
    }
  }

  async handleFileUpload(fileData: Buffer, metadata: FileMetadata): Promise<FileInfo> {
    try {
      const fileId = this.generateUniqueFileId(metadata.filename);
      const storedFilename = this.createFilenameWithId(metadata.filename, fileId);

      const fileInfo: FileInfo = {
        displayName: metadata.filename,
        storedName: storedFilename,
        timestamp: Date.now(),
        uploaderHostname: metadata.hostname,
        size: fileData.length,
        hash: fileId
      };

      await fs.promises.writeFile(path.join(this.storageDir, storedFilename), fileData);
      this.fileMetadata.set(storedFilename, fileInfo);

      Print('INFO', `File uploaded: ${metadata.filename} -> ${storedFilename} (ID: ${fileId})`);
      return fileInfo;
    } catch (error) {
      Print('ERROR', `File upload failed: ${(error as Error).message}`);
      throw error;
    }
  }

  async handleFileUploadStreaming(tempFilePath: string, metadata: FileMetadata): Promise<FileInfo> {
    try {
      const fileId = this.generateUniqueFileId(metadata.filename);
      const storedFilename = this.createFilenameWithId(metadata.filename, fileId);
      const finalPath = path.join(this.storageDir, storedFilename);

      const fileInfo: FileInfo = {
        displayName: metadata.filename,
        storedName: storedFilename,
        timestamp: Date.now(),
        uploaderHostname: metadata.hostname,
        size: metadata.size || 0,
        hash: fileId
      };

      await fs.promises.rename(tempFilePath, finalPath);
      this.fileMetadata.set(storedFilename, fileInfo);

      Print('INFO', `File streamed: ${metadata.filename} -> ${storedFilename} (ID: ${fileId}, ${this.formatFileSize(metadata.size || 0)})`);
      return fileInfo;
    } catch (error) {
      Print('ERROR', `Streaming file upload failed: ${(error as Error).message}`);

      try {
        await fs.promises.unlink(tempFilePath);
      } catch (cleanupError) {
        Print('DEBUG', `Temp file cleanup failed: ${(cleanupError as Error).message}`);
      }

      throw error;
    }
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  generateUniqueFileId(filename: string): string {
    const uniqueString = `${filename}_${Date.now()}_${Math.random()}`;
    return shorthash(uniqueString);
  }

  createFilenameWithId(originalFilename: string, fileId: string): string {
    const ext = path.extname(originalFilename);
    const basename = path.basename(originalFilename, ext);

    const filenameWithId = `${basename}_${fileId}${ext}`;

    Print('DEBUG', `Created filename with ID: ${originalFilename} -> ${filenameWithId}`);
    return filenameWithId;
  }

  getFileList(): FileInfo[] {
    return Array.from(this.fileMetadata.values());
  }

  fileExists(filename: string): boolean {
    return fs.existsSync(path.join(this.storageDir, filename));
  }

  async deleteFile(filename: string): Promise<boolean> {
    try {
      const filePath = path.join(this.storageDir, filename);
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
        this.fileMetadata.delete(filename);
        Print('INFO', `File deleted: ${filename}`);
        return true;
      }
      return false;
    } catch (error) {
      Print('ERROR', `File deletion failed: ${(error as Error).message}`);
      throw error;
    }
  }

  async getFileData(filename: string): Promise<Buffer> {
    try {
      const filePath = path.join(this.storageDir, filename);
      return await fs.promises.readFile(filePath);
    } catch (error) {
      Print('ERROR', `File read failed: ${(error as Error).message}`);
      throw error;
    }
  }
}