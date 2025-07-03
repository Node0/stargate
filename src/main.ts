import { BrowserPrint } from './browser-logger';
import Aurelia, { Registration } from 'aurelia';
import { App } from './app';

// Import services
import { WebSocketService } from './services/websocket.service';
import { MessageBusService } from './services/message-bus.service';
import { CollaborationService } from './services/collaboration.service';

// Import components
import { TextRegister } from './components/text-register';
import { FileManager } from './components/file-manager';
import { ModeIndicator } from './components/mode-indicator';

// Import value converters
import { FileSizeValueConverter } from './resources/value-converters/file-size';
import { DateFormatValueConverter } from './resources/value-converters/date-format';

BrowserPrint('STARTING', 'Main.ts executing - beginning Aurelia bootstrap sequence');

try {
  BrowserPrint('INFO', 'Starting Aurelia with manual service instantiation');
  
  // Create services manually to avoid DI issues
  const messageBus = new MessageBusService();
  const websocket = new WebSocketService();
  const collaboration = new CollaborationService(websocket, messageBus);
  
  Aurelia
    .register(
      // Components
      TextRegister,
      FileManager,
      ModeIndicator,
      // Value converters
      FileSizeValueConverter,
      DateFormatValueConverter,
      // Register service instances using Registration.instance
      Registration.instance(MessageBusService, messageBus),
      Registration.instance(WebSocketService, websocket),
      Registration.instance(CollaborationService, collaboration)
    )
    .app(App)
    .start();
    
  BrowserPrint('SUCCESS', 'Aurelia bootstrap completed successfully');
} catch (err) {
  BrowserPrint('CRITICAL', `Aurelia startup failed: ${err.message}`);
  BrowserPrint('DEBUG', `Error stack: ${err.stack}`);
}