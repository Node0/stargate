// Browser-compatible version of Print() for frontend diagnostics
type LogType = 'SUCCESS' | 'FAILURE' | 'STATE' | 'INFO' | 'IMPORTANT' | 'CRITICAL' | 
              'EXCEPTION' | 'WARNING' | 'DEBUG' | 'ATTEMPT' | 'STARTING' | 'PROGRESS' | 
              'COMPLETED' | 'ERROR' | 'TRACE';

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
}