const colors = require('colors'); // Importing the colors library

function Print(logType, message) {
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

  if (methodMatch) {
    functionName = methodMatch[1]; // Captures 'ClassName.methodName'
  } else if (constructorMatch) {
    functionName = `${constructorMatch[1]}.constructor`; // Captures 'ClassName.constructor'
  } else if (anonymousMatch) {
    functionName = `${anonymousMatch[1]} (anonymous)`; // Captures and marks anonymous function calls
  }

  // Padding lengths for alignment
  const logTypePadding = 10;
  const functionNamePadding = 40;

  // Determine the formatted message based on the log type with colors library
  let formattedMessage;
  switch (logType.toUpperCase()) {
    case 'INFO':
      formattedMessage = colors.blue(`<<< ${message} >>>`); // Blue for INFO
      break;
    case 'WARNING':
      formattedMessage = colors.yellow.underline(`>>> ${message} <<<`); // Yellow and underlined for WARNING
      break;
    case 'ERROR':
      formattedMessage = colors.red.bold(`### ${message} ###`); // Red and bold for ERROR
      break;
    case 'EXCEPTION':
      formattedMessage = colors.magenta(`!!! ${message} !!!`); // Magenta for EXCEPTION
      break;
    default:
      formattedMessage = message; // No color for unknown log types
  }

  // Get the current timestamp
  const timestamp = new Date().toISOString();

  // Pad the log type and function name to align the symbols on the left
  const paddedLogType = logType.toUpperCase().padEnd(logTypePadding);
  const paddedFunctionName = functionName.padEnd(functionNamePadding);

  // Log the message
  console.log(`${paddedLogType}: ${timestamp} - ${paddedFunctionName} - ${formattedMessage}`);
}

module.exports = { Print };

