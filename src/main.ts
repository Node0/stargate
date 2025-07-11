import { BrowserPrint, initializeBrowserLogger } from './browser-logger';
import Aurelia, { Registration } from 'aurelia';
import { App } from './app';

// Import services
import { WebSocketService } from './services/websocket.service';
import { MessageBusService } from './services/message-bus.service';
import { CollaborationService } from './services/collaboration.service';
import { AppStateService } from './services/app-state.service';
import { TimelineCoordinatorService } from './services/timeline-coordinator.service';

// Import components
import { TextRegister } from './components/text-register';
import { FileManager } from './components/file-manager';
import { ModeIndicator } from './components/mode-indicator';
import { TimeMap } from './components/timemap';
import { DayScrubber } from './components/day-scrubber';

// Import value converters
import { FileSizeValueConverter } from './resources/value-converters/file-size';
import { DateFormatValueConverter } from './resources/value-converters/date-format';

BrowserPrint('STARTING', 'Main.ts executing - beginning Aurelia bootstrap sequence');

// Initialize browser logger WebSocket connection
initializeBrowserLogger();

try {
  BrowserPrint('INFO', 'Starting Aurelia with manual service instantiation');
  
  // Create services manually to avoid DI issues
  const messageBus = new MessageBusService();
  const websocket = new WebSocketService();
  const collaboration = new CollaborationService(websocket, messageBus);
  const appState = new AppStateService(messageBus);
  const timelineCoordinator = new TimelineCoordinatorService(messageBus, collaboration);
  
  Aurelia
    .register(
      // Components
      TextRegister,
      FileManager,
      ModeIndicator,
      TimeMap,
      DayScrubber,
      // Value converters
      FileSizeValueConverter,
      DateFormatValueConverter,
      // Register service instances using Registration.instance
      Registration.instance(MessageBusService, messageBus),
      Registration.instance(WebSocketService, websocket),
      Registration.instance(CollaborationService, collaboration),
      Registration.instance(AppStateService, appState),
      Registration.instance(TimelineCoordinatorService, timelineCoordinator)
    )
    .app(App)
    .start();
    
  BrowserPrint('SUCCESS', 'Aurelia bootstrap completed successfully');
} catch (err) {
  BrowserPrint('CRITICAL', `Aurelia startup failed: ${err.message}`);
  BrowserPrint('DEBUG', `Error stack: ${err.stack}`);
}