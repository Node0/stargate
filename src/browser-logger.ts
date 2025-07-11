// Browser-compatible version of Print() for frontend diagnostics
type LogType = 'SUCCESS' | 'FAILURE' | 'STATE' | 'INFO' | 'IMPORTANT' | 'CRITICAL' | 
              'EXCEPTION' | 'WARNING' | 'DEBUG' | 'ATTEMPT' | 'STARTING' | 'PROGRESS' | 
              'COMPLETED' | 'ERROR' | 'TRACE';

// Interface for sending logs to server
interface LogMessage {
  type: 'browser_log';
  logType: LogType;
  message: string;
  timestamp: string;
  functionName: string;
  url: string;
  userAgent: string;
}

// Global WebSocket reference for sending logs
let logWebSocket: WebSocket | null = null;

// Initialize WebSocket connection for logging
export function initializeBrowserLogger(): void {
  try {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/_data_stream/app_logging_data`;
    
    logWebSocket = new WebSocket(wsUrl);
    
    logWebSocket.onopen = () => {
      console.log('🔗 Browser logger WebSocket connected');
    };
    
    logWebSocket.onclose = () => {
      console.log('❌ Browser logger WebSocket disconnected');
      logWebSocket = null;
    };
    
    logWebSocket.onerror = (error) => {
      console.error('⚠️ Browser logger WebSocket error:', error);
    };
  } catch (error) {
    console.error('Failed to initialize browser logger WebSocket:', error);
  }
}

// Send log message to server
function sendLogToServer(logType: LogType, message: string, functionName: string, timestamp: string): void {
  if (!logWebSocket || logWebSocket.readyState !== WebSocket.OPEN) {
    // Try to reconnect if not connected
    if (!logWebSocket) {
      initializeBrowserLogger();
    }
    return;
  }
  
  try {
    const logMessage: LogMessage = {
      type: 'browser_log',
      logType,
      message,
      timestamp,
      functionName,
      url: window.location.href,
      userAgent: navigator.userAgent
    };
    
    logWebSocket.send(JSON.stringify(logMessage));
  } catch (error) {
    // Fail silently to avoid infinite loops
    console.error('Failed to send log to server:', error);
  }
}

export function BrowserPrint(logType: LogType, message: string): void {
  const timestamp = new Date().toISOString();
  
  // Get caller information from stack trace
  const stack = new Error().stack;
  const stackLines = stack?.split("\n") || [];
  const callerLine = stackLines[2] ? stackLines[2].trim() : 'Unknown Caller';
  
  let functionName = 'Unknown Caller';
  const methodMatch = callerLine.match(/at (\S+) \(/);
  if (methodMatch) {
    functionName = methodMatch[1];
  }
  
  const paddedLogType = logType.padEnd(10);
  const paddedFunctionName = functionName.padEnd(40);
  
  // Map log types to console methods and symbols (matching server-side Print function)
  const logTypeConfig = {
    'SUCCESS': { method: 'log', beforeSymbol: '^^^', afterSymbol: '^^^', style: 'color: green; font-weight: bold' },
    'FAILURE': { method: 'error', beforeSymbol: '###', afterSymbol: '###', style: 'color: red; font-weight: bold' },
    'STATE': { method: 'info', beforeSymbol: '~~~', afterSymbol: '~~~', style: 'color: cyan' },
    'INFO': { method: 'info', beforeSymbol: '---', afterSymbol: '---', style: 'color: blue' },
    'IMPORTANT': { method: 'warn', beforeSymbol: '===', afterSymbol: '===', style: 'color: magenta; font-weight: bold' },
    'CRITICAL': { method: 'error', beforeSymbol: '***', afterSymbol: '***', style: 'color: red; font-weight: bold' },
    'EXCEPTION': { method: 'error', beforeSymbol: '!!!', afterSymbol: '!!!', style: 'color: red; font-weight: bold' },
    'WARNING': { method: 'warn', beforeSymbol: '(((', afterSymbol: ')))', style: 'color: orange' },
    'DEBUG': { method: 'log', beforeSymbol: '[[[', afterSymbol: ']]]', style: 'color: gray' },
    'ATTEMPT': { method: 'log', beforeSymbol: '???', afterSymbol: '???', style: 'color: cyan' },
    'STARTING': { method: 'log', beforeSymbol: '>>>', afterSymbol: '>>>', style: 'color: green' },
    'PROGRESS': { method: 'log', beforeSymbol: 'vvv', afterSymbol: 'vvv', style: 'color: blue' },
    'COMPLETED': { method: 'log', beforeSymbol: '<<<', afterSymbol: '<<<', style: 'color: green' },
    'ERROR': { method: 'error', beforeSymbol: '###', afterSymbol: '###', style: 'color: red; font-weight: bold' },
    'TRACE': { method: 'log', beforeSymbol: '...', afterSymbol: '...', style: 'color: lightgray' }
  } as const;
  
  const config = logTypeConfig[logType] || logTypeConfig['INFO'];
  const formattedMessage = `%c${paddedLogType}: ${timestamp} - ${paddedFunctionName} - ${config.beforeSymbol} ${message} ${config.afterSymbol}`;
  
  // Use appropriate console method
  (console as any)[config.method](formattedMessage, config.style);
  
  // Also send to server for logging
  sendLogToServer(logType, message, functionName, timestamp);
}