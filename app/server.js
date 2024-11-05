const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { ArgumentParser } = require('argparse');
const { Print } = require('./utilities');

class Stargate {
  constructor() {
    this.app = express();
    this.args = this.parseArguments();
    this.config = {};

    // Load SSL options
    this.sslOptions = {
      key: fs.readFileSync(path.resolve(__dirname, 'server.key')),
      cert: fs.readFileSync(path.resolve(__dirname, 'server.cert')),
    };

    // Create HTTPS server before setupRoutes
    this.server = https.createServer(this.sslOptions, this.app);
    this.wss = new WebSocket.Server({ noServer: true }); // WebSocket server without direct binding

    // Load configuration and set up routes
    this.loadConfig();
    this.setupRoutes();

    Print('INFO', 'Stargate instantiated');
  }

  // Parse command-line arguments
  parseArguments() {
    const parser = new ArgumentParser({
      description: 'Collaborative Register WebSocket Server',
    });
    parser.add_argument('--hostname', { help: 'Hostname for the server', default: '0.0.0.0' });
    parser.add_argument('--port', { help: 'Port for the server', type: 'int', default: 5900 });
    return parser.parse_args();
  }

  // Load configuration from config.json
  loadConfig() {
    try {
      const configPath = path.resolve(__dirname, '../app/conf/config.json');
      const configData = fs.readFileSync(configPath, 'utf8');
      this.config = JSON.parse(configData);
      Print('INFO', 'Configuration loaded successfully');
    } catch (error) {
      Print('ERROR', `Failed to load config: ${error.message}`);
      process.exit(1);
    }
  }

  // Set up routes using configuration
  setupRoutes() {
    this.app.use(express.static(path.join(__dirname, 'public')));

    // Route for initial availability check
    const availabilityEndpoint = this.config.prog.initial_wss_availability_url.endpoint;
    this.app.get(availabilityEndpoint, this.handleNewClient.bind(this));

    // Handle WebSocket upgrade requests on the specified endpoint
    this.server.on('upgrade', (req, socket, head) => {
      const wsEndpoint = this.config.prog.websocket_server_url.endpoint;
      if (req.url === wsEndpoint) {
        this.handleNewWebsocketConnection(req, socket, head);
      }
    });
  }

  // Initial HTTP response to indicate WebSocket availability
  handleNewClient(req, res) {
    const responseText = this.config.prog.initial_wss_availability_url.response_text;
    Print('INFO', `Accessed ${req.url} - Responding with availability`);
    res.send(responseText);
  }

  // WebSocket upgrade and handling method
  handleNewWebsocketConnection(req, socket, head) {
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      Print('INFO', 'WebSocket connection established at websocket_server_url');
      this.wss.emit('connection', ws, req);
    });

    // Set up WebSocket communication
    this.wss.on('connection', (ws) => {
      Print('INFO', 'Client connected to WebSocket');

      ws.on('message', (message) => {
        Print('INFO', `Received message: ${message}`);
        // Broadcast to all clients
        this.wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(message);
          }
        });
      });

      ws.on('close', () => Print('INFO', 'Client disconnected from WebSocket'));
    });
  }

  // Start the HTTPS and WebSocket server
  start() {
    this.server.listen(this.args.port, this.args.hostname, () => {
      Print('INFO', `Server running at https://${this.args.hostname}:${this.args.port}`);
    });
  }
}

// Export Stargate for testing or external usage
module.exports = Stargate;

// Instantiate and start the server if executed directly
if (require.main === module) {
  const stargateServer = new Stargate();
  stargateServer.start();
}
