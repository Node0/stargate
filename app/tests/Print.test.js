const { Print } = require('../utilities');

class PrintTests {
  constructor() {
    this.originalConsoleLog = console.log;
    this.capturedOutput = '';
    this.mockConsoleLog();
  }

  mockConsoleLog() {
    console.log = (message) => {
      this.capturedOutput = message;
    };
  }

  restoreConsoleLog() {
    console.log = this.originalConsoleLog;
  }

  extractSymbolsFromOutput(output) {
    // Extract the message part after the function name padding
    const parts = output.split(' - ');
    if (parts.length >= 3) {
      const messagePart = parts[2];
      // Remove ANSI color codes to get plain text symbols
      const plainMessage = messagePart.replace(/\x1b\[[0-9;]*m/g, '');
      return plainMessage.trim();
    }
    return '';
  }

  testSuccessMessageType() {
    this.capturedOutput = '';
    Print('SUCCESS', 'Operation completed successfully');
    const symbols = this.extractSymbolsFromOutput(this.capturedOutput);
    expect(symbols).toBe('^^^ Operation completed successfully ^^^');
  }

  testFailureMessageType() {
    this.capturedOutput = '';
    Print('FAILURE', 'Operation failed');
    const symbols = this.extractSymbolsFromOutput(this.capturedOutput);
    expect(symbols).toBe('### Operation failed ###');
  }

  testStateMessageType() {
    this.capturedOutput = '';
    Print('STATE', 'Current state information');
    const symbols = this.extractSymbolsFromOutput(this.capturedOutput);
    expect(symbols).toBe('~~~ Current state information ~~~');
  }

  testInfoMessageType() {
    this.capturedOutput = '';
    Print('INFO', 'General information');
    const symbols = this.extractSymbolsFromOutput(this.capturedOutput);
    expect(symbols).toBe('--- General information ---');
  }

  testImportantMessageType() {
    this.capturedOutput = '';
    Print('IMPORTANT', 'Important notice');
    const symbols = this.extractSymbolsFromOutput(this.capturedOutput);
    expect(symbols).toBe('=== Important notice ===');
  }

  testCriticalMessageType() {
    this.capturedOutput = '';
    Print('CRITICAL', 'Critical system alert');
    const symbols = this.extractSymbolsFromOutput(this.capturedOutput);
    expect(symbols).toBe('*** Critical system alert ***');
  }

  testExceptionMessageType() {
    this.capturedOutput = '';
    Print('EXCEPTION', 'Exception occurred');
    const symbols = this.extractSymbolsFromOutput(this.capturedOutput);
    expect(symbols).toBe('!!! Exception occurred !!!');
  }

  testWarningMessageType() {
    this.capturedOutput = '';
    Print('WARNING', 'Warning message');
    const symbols = this.extractSymbolsFromOutput(this.capturedOutput);
    expect(symbols).toBe('((( Warning message )))');
  }

  testDebugMessageType() {
    this.capturedOutput = '';
    Print('DEBUG', 'Debug information');
    const symbols = this.extractSymbolsFromOutput(this.capturedOutput);
    expect(symbols).toBe('[[[ Debug information ]]]');
  }

  testAttemptMessageType() {
    this.capturedOutput = '';
    Print('ATTEMPT', 'Attempting operation');
    const symbols = this.extractSymbolsFromOutput(this.capturedOutput);
    expect(symbols).toBe('??? Attempting operation ???');
  }

  testStartingMessageType() {
    this.capturedOutput = '';
    Print('STARTING', 'Starting process');
    const symbols = this.extractSymbolsFromOutput(this.capturedOutput);
    expect(symbols).toBe('>>> Starting process >>>');
  }

  testProgressMessageType() {
    this.capturedOutput = '';
    Print('PROGRESS', 'Progress update');
    const symbols = this.extractSymbolsFromOutput(this.capturedOutput);
    expect(symbols).toBe('vvv Progress update vvv');
  }

  testCompletedMessageType() {
    this.capturedOutput = '';
    Print('COMPLETED', 'Task completed');
    const symbols = this.extractSymbolsFromOutput(this.capturedOutput);
    expect(symbols).toBe('<<< Task completed <<<');
  }

  testErrorMessageTypeBackwardCompatibility() {
    this.capturedOutput = '';
    Print('ERROR', 'Error occurred');
    const symbols = this.extractSymbolsFromOutput(this.capturedOutput);
    expect(symbols).toBe('### Error occurred ###');
  }

  testTraceMessageType() {
    // TRACE messages don't go to console, so we can't test console output
    // This test verifies that TRACE doesn't crash the system
    this.capturedOutput = '';
    Print('TRACE', 'Trace message');
    expect(this.capturedOutput).toBe(''); // Should be empty since TRACE doesn't log to console
  }

  testUnknownMessageType() {
    this.capturedOutput = '';
    Print('UNKNOWN', 'Unknown message type');
    const symbols = this.extractSymbolsFromOutput(this.capturedOutput);
    expect(symbols).toBe('Unknown message type'); // Should have no symbols, just the message
  }

  testCaseInsensitivity() {
    this.capturedOutput = '';
    Print('success', 'Lowercase success');
    const symbols = this.extractSymbolsFromOutput(this.capturedOutput);
    expect(symbols).toBe('^^^ Lowercase success ^^^');
  }
}

// Jest test suite setup
describe('Print Function Symbol Tests', () => {
  let printTests;

  beforeEach(() => {
    printTests = new PrintTests();
  });

  afterEach(() => {
    printTests.restoreConsoleLog();
  });

  test('SUCCESS message type displays correct symbols', () => {
    printTests.testSuccessMessageType();
  });

  test('FAILURE message type displays correct symbols', () => {
    printTests.testFailureMessageType();
  });

  test('STATE message type displays correct symbols', () => {
    printTests.testStateMessageType();
  });

  test('INFO message type displays correct symbols', () => {
    printTests.testInfoMessageType();
  });

  test('IMPORTANT message type displays correct symbols', () => {
    printTests.testImportantMessageType();
  });

  test('CRITICAL message type displays correct symbols', () => {
    printTests.testCriticalMessageType();
  });

  test('EXCEPTION message type displays correct symbols', () => {
    printTests.testExceptionMessageType();
  });

  test('WARNING message type displays correct symbols', () => {
    printTests.testWarningMessageType();
  });

  test('DEBUG message type displays correct symbols', () => {
    printTests.testDebugMessageType();
  });

  test('ATTEMPT message type displays correct symbols', () => {
    printTests.testAttemptMessageType();
  });

  test('STARTING message type displays correct symbols', () => {
    printTests.testStartingMessageType();
  });

  test('PROGRESS message type displays correct symbols', () => {
    printTests.testProgressMessageType();
  });

  test('COMPLETED message type displays correct symbols', () => {
    printTests.testCompletedMessageType();
  });

  test('ERROR message type displays correct symbols (backward compatibility)', () => {
    printTests.testErrorMessageTypeBackwardCompatibility();
  });

  test('TRACE message type does not log to console', () => {
    printTests.testTraceMessageType();
  });

  test('Unknown message type handles gracefully', () => {
    printTests.testUnknownMessageType();
  });

  test('Message types are case insensitive', () => {
    printTests.testCaseInsensitivity();
  });
});