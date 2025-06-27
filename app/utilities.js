const colors = require('colors'); // Importing the colors library
const fs = require('fs');
const path = require('path');
const shorthash = require('shorthash2');

// Logging configuration
const LOGGING_CONFIG = {
  enableTrace: process.env.TRACE_LOGGING === 'true' || false,
  enableDebug: process.env.DEBUG_LOGGING === 'true' || process.env.TRACE_LOGGING === 'true' || true, // Default to debug
  logsDir: path.join(__dirname, 'logs'),
  accessLogPath: path.join(__dirname, 'logs', 'access.log'),
  errorLogPath: path.join(__dirname, 'logs', 'error.log'),
  debugLogPath: path.join(__dirname, 'logs', 'debug.log')
};

// Ensure logs directory exists
if (!fs.existsSync(LOGGING_CONFIG.logsDir)) {
  fs.mkdirSync(LOGGING_CONFIG.logsDir, { recursive: true });
}

function Print(logType, message)
{
  const upperLogType = logType.toUpperCase();

  // Check if we should log this level
  if (upperLogType === 'TRACE' && !LOGGING_CONFIG.enableTrace) return;
  if (upperLogType === 'DEBUG' && !LOGGING_CONFIG.enableDebug) return;

  const stack = new Error().stack;
  const stackLines = stack.split("\n");

  // Check if the expected stack frame exists
  const callerLine = stackLines[2] ? stackLines[2].trim() : 'Unknown Caller Line';

  // Initial default functionName in case parsing fails
  let functionName = 'Unknown Caller';

  // Regex to match different types of function calls
  const methodMatch = callerLine.match(/at (\S+) \(/); // Matches 'at ClassName.methodName ('
  const constructorMatch = callerLine.match(/at new (\S+) \(/); // Matches 'at new ClassName ('
  const anonymousMatch = callerLine.match(/at (\S+) \(<anonymous>/); // Matches anonymous functions

  if (methodMatch)
  {
    functionName = methodMatch[1]; // Captures 'ClassName.methodName'
  } else if (constructorMatch)
  {
    functionName = `${constructorMatch[1]}.constructor`; // Captures 'ClassName.constructor'
  } else if (anonymousMatch)
  {
    functionName = `${anonymousMatch[1]} (anonymous)`; // Captures and marks anonymous function calls
  }

  // Padding lengths for alignment
  const logTypePadding = 10;
  const functionNamePadding = 40;


/* Mapping of logType to symbols
*  Note: Uses [head, tail] array design to support asymmetric symbol pairs
*  like ((( ))) for WARNING, [[[ ]]] for DEBUG, and potential {{{ }}} patterns.
*  This allows proper opening/closing symbol semantics rather than just duplicating.
*/
  const logTypeSymbols = {
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
    'ERROR': ['###', '###'], // Keep ERROR for backward compatibility
    'TRACE': ['...', '...']  // Add TRACE support
  };

  // Mapping of logType to colors
  const logTypeColors = {
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
    'ERROR': colors.red.bold, // Keep ERROR for backward compatibility
    'TRACE': colors.gray
  };

  // Get symbols and color for the log type
  const symbols = logTypeSymbols[upperLogType] || ['', ''];
  const colorFunc = logTypeColors[upperLogType] || ((text) => text);
  const [beforeSymbol, afterSymbol] = symbols;

  // Create formatted message with symbols
  const formattedMessage = colorFunc(`${beforeSymbol} ${message} ${afterSymbol}`);

  // Get the current timestamp
  const timestamp = new Date().toISOString();

  // Pad the log type and function name to align the symbols on the left
  const paddedLogType = upperLogType.padEnd(logTypePadding);
  const paddedFunctionName = functionName.padEnd(functionNamePadding);

  // Log to console (with colors) - except TRACE which only goes to file
  if (upperLogType !== 'TRACE') {
    console.log(`${paddedLogType}: ${timestamp} - ${paddedFunctionName} - ${formattedMessage}`);
  }

  // Create the plain message for file logging (without colors)
  const plainLogMessage = `${paddedLogType}: ${timestamp} - ${paddedFunctionName} - ${beforeSymbol} ${message} ${afterSymbol}`;

  // Write to appropriate log files
  writeToLogFiles(upperLogType, plainLogMessage);
}

function writeToLogFiles(logType, message)
{
  try {
    // Always write to appropriate specialized log
    switch (logType) {
      case 'INFO':
      case 'WARNING':
      case 'STATE':
      case 'STARTING':
      case 'PROGRESS':
      case 'COMPLETED':
      case 'SUCCESS':
        // Operational events go to access.log
        fs.appendFileSync(LOGGING_CONFIG.accessLogPath, message + '\n');
        break;

      case 'ERROR':
      case 'EXCEPTION':
      case 'FAILURE':
      case 'CRITICAL':
        // Errors go to error.log
        fs.appendFileSync(LOGGING_CONFIG.errorLogPath, message + '\n');
        break;

      case 'DEBUG':
      case 'TRACE':
      case 'ATTEMPT':
      case 'IMPORTANT':
        // Debug/trace go to debug.log
        fs.appendFileSync(LOGGING_CONFIG.debugLogPath, message + '\n');
        break;
    }
  } catch (e) {
    // Ignore file logging errors to prevent infinite loops
    console.error(`Failed to write to log file: ${e.message}`);
  }
}

function ErrorInterceptor()
{
  process.on('uncaughtException', (error) =>
  {
    Print('EXCEPTION', `Uncaught exception: ${error.message}`);
    console.error('Stack trace:', error.stack);
    process.exit(1); // Ensures app restarts with error logged
  });

  process.on('unhandledRejection', (reason, promise) =>
  {
    Print('EXCEPTION', `Unhandled promise rejection: ${reason}`);
    console.error('At Promise:', promise);
  });

  process.on('warning', (warning) =>
  {
    Print('WARNING', `Node.js warning: ${warning.name} - ${warning.message}`);
    console.warn(warning.stack);
  });

  process.on('exit', (code) =>
  {
    Print('INFO', `Process exiting with code: ${code}`);
  });

  process.on('SIGINT', () =>
  {
    Print('INFO', 'Received SIGINT. Gracefully shutting down...');
    process.exit(0);
  });

}

// RequestEncoder utility class for REQ header pattern
class RequestEncoder
{
  static encode(success, body)
  {
    return Buffer.from(JSON.stringify({ success, body })).toString('base64');
  }

  static decode(reqHeader)
  {
    try
    {
      return JSON.parse(Buffer.from(reqHeader, 'base64').toString());
    }
    catch (e)
    {
      return { success: false, body: { error: 'Invalid REQ header' } };
    }
  }

  static validateSize(reqHeader)
  {
    return reqHeader.length <= 2048;
  }
}

// FileManager class for handling file uploads with collision avoidance
class FileManager
{
  constructor(storageDir, config)
  {
    this.storageDir = storageDir;
    this.config = config;
    this.fileMetadata = new Map();

    // Ensure storage directory exists
    if (!fs.existsSync(this.storageDir))
    {
      fs.mkdirSync(this.storageDir, { recursive: true });
      Print('INFO', `Created storage directory: ${this.storageDir}`);
    }
  }

  async handleFileUpload(fileData, metadata)
  {
    try
    {
      // Generate unique ID for this file (every file gets an ID)
      const fileId = this.generateUniqueFileId(metadata.filename);
      const storedFilename = this.createFilenameWithId(metadata.filename, fileId);

      const fileInfo = {
        displayName: metadata.filename,
        storedName: storedFilename,
        timestamp: Date.now(),
        uploaderHostname: metadata.hostname,
        size: fileData.length,
        hash: fileId  // Hash matches filename suffix
      };

      await fs.promises.writeFile(path.join(this.storageDir, storedFilename), fileData);
      this.fileMetadata.set(storedFilename, fileInfo);

      Print('INFO', `File uploaded: ${metadata.filename} -> ${storedFilename} (ID: ${fileId})`);
      return fileInfo;
    }
    catch (error)
    {
      Print('ERROR', `File upload failed: ${error.message}`);
      throw error;
    }
  }

  // Streaming file upload - moves file without loading into memory
  async handleFileUploadStreaming(tempFilePath, metadata)
  {
    try
    {
      // Generate unique ID for this file (every file gets an ID)
      const fileId = this.generateUniqueFileId(metadata.filename);
      const storedFilename = this.createFilenameWithId(metadata.filename, fileId);
      const finalPath = path.join(this.storageDir, storedFilename);

      const fileInfo = {
        displayName: metadata.filename,
        storedName: storedFilename,
        timestamp: Date.now(),
        uploaderHostname: metadata.hostname,
        size: metadata.size,  // Size from multer, no need to read file
        hash: fileId  // Hash matches filename suffix
      };

      // Move file directly without reading into memory
      await fs.promises.rename(tempFilePath, finalPath);
      this.fileMetadata.set(storedFilename, fileInfo);

      Print('INFO', `File streamed: ${metadata.filename} -> ${storedFilename} (ID: ${fileId}, ${this.formatFileSize(metadata.size)})`);
      return fileInfo;
    }
    catch (error)
    {
      Print('ERROR', `Streaming file upload failed: ${error.message}`);

      // Clean up temp file on error
      try {
        await fs.promises.unlink(tempFilePath);
      } catch (cleanupError) {
        Print('DEBUG', `Temp file cleanup failed: ${cleanupError.message}`);
      }

      throw error;
    }
  }

  // Helper to format file sizes
  formatFileSize(bytes)
  {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Generate unique file ID (every file gets an ID - no collision detection needed)
  generateUniqueFileId(filename)
  {
    // Use filename + high-resolution timestamp + random for guaranteed uniqueness
    // This avoids reading file content which causes memory issues with large files
    const uniqueString = `${filename}_${Date.now()}_${Math.random()}`;
    return shorthash(uniqueString);
  }

  // Create filename with ID suffix (every file gets an ID suffix)
  createFilenameWithId(originalFilename, fileId)
  {
    const ext = path.extname(originalFilename);
    const basename = path.basename(originalFilename, ext);

    // Every file gets the ID suffix - ensures trackability across systems
    const filenameWithId = `${basename}_${fileId}${ext}`;

    Print('DEBUG', `Created filename with ID: ${originalFilename} -> ${filenameWithId}`);
    return filenameWithId;
  }

  // Get list of all files with metadata
  getFileList()
  {
    return Array.from(this.fileMetadata.values());
  }

  // Check if file exists
  fileExists(filename)
  {
    return fs.existsSync(path.join(this.storageDir, filename));
  }

  // Delete file
  async deleteFile(filename)
  {
    try
    {
      const filePath = path.join(this.storageDir, filename);
      if (fs.existsSync(filePath))
      {
        await fs.promises.unlink(filePath);
        this.fileMetadata.delete(filename);
        Print('INFO', `File deleted: ${filename}`);
        return true;
      }
      return false;
    }
    catch (error)
    {
      Print('ERROR', `File deletion failed: ${error.message}`);
      throw error;
    }
  }

  // Get file data
  async getFileData(filename)
  {
    try
    {
      const filePath = path.join(this.storageDir, filename);
      return await fs.promises.readFile(filePath);
    }
    catch (error)
    {
      Print('ERROR', `File read failed: ${error.message}`);
      throw error;
    }
  }
}

module.exports = { Print, ErrorInterceptor, RequestEncoder, FileManager };

