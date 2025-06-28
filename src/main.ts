import { BrowserPrint } from './browser-logger';
import Aurelia from 'aurelia';
import { App } from './app';

// Import components
import { TextRegister } from './components/text-register';
import { FileManager } from './components/file-manager';
import { ModeIndicator } from './components/mode-indicator';

// Import services
import { WebSocketService } from './services/websocket.service';

// Import value converters
import { FileSizeValueConverter } from './resources/value-converters/file-size';
import { DateFormatValueConverter } from './resources/value-converters/date-format';

BrowserPrint('STARTING', 'Main.ts executing - beginning Aurelia bootstrap sequence');

try {
  Aurelia
    .register(
      // Components
      TextRegister,
      FileManager,
      ModeIndicator,
      // Services
      WebSocketService,
      // Value converters
      FileSizeValueConverter,
      DateFormatValueConverter
    )
    .app(App)
    .start();
  BrowserPrint('SUCCESS', 'Aurelia bootstrap completed successfully');
} catch (err) {
  BrowserPrint('CRITICAL', `Aurelia startup failed: ${err.message}`);
  BrowserPrint('DEBUG', `Error stack: ${err.stack}`);
}