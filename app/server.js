const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { ArgumentParser } = require('argparse');
const { Print } = require('./utilities');

class Stargate
{
  constructor()
  {
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
    this.wss = new WebSocket.Server({ noServer: true }); // Initialize WebSocket server without direct binding

    // Load configuration and set up routes
    this.loadConfig();
    this.setupRoutes();

    Print('INFO', 'Stargate instantiated');
  }

  // Parse command-line arguments
  parseArguments()
  {
    const parser = new ArgumentParser({
      description: 'Collaborative Register WebSocket Server',
    });
    parser.add_argument('--hostname', { help: 'Hostname for the server', default: '0.0.0.0' });
    parser.add_argument('--port', { help: 'Port for the server', type: 'int', default: 5900 });
    return parser.parse_args();
  }

  // Load configuration from config.json
  loadConfig()
  {
    try
    {
      const configPath = path.resolve(__dirname, '../app/conf/config.json');
      const configData = fs.readFileSync(configPath, 'utf8');
      this.config = JSON.parse(configData);
      Print('INFO', 'Configuration loaded successfully');
    }
    catch (error)
    {
      Print('ERROR', `Failed to load config: ${error.message}`);
      process.exit(1);
    }
  }

  // Set up routes using configuration
  setupRoutes()
  {
    this.app.use(express.static(path.join(__dirname, 'public')));

    // Serve the initial WebSocket availability check route
    const availabilityUrlRoute = this.config.prog.collab_interface_url.route;
    this.app.get(availabilityUrlRoute, this.handleNewClient.bind(this));

    // Handle WebSocket upgrade requests selectively based on the configured endpoint
    this.server.on('upgrade', (req, socket, head) =>
    {
      const wsUrlRoute = this.config.prog.websocket_server_url.route;

      if (req.url === wsUrlRoute)
      {
        Print('INFO', `Received WebSocket upgrade request at ${req.url}`);
        this.handleNewWebsocketConnection(req, socket, head);
      } else
      {
        Print('WARNING', `Unexpected WebSocket upgrade request at ${req.url} - Closing socket`);
        socket.destroy(); // Reject if the request does not match any valid WebSocket route
      }
    });
  }

  // Serve index.html and inject WebSocket url route
  handleNewClient(req, res)
  {
    const responseText = this.config.prog.collab_interface_url.response_text;
    const indexPath = path.join(__dirname, 'public', 'index.html');

    fs.readFileSync(indexPath, 'utf8', (err, data) =>
    {
      if (err)
      {
        Print('ERROR', `Failed to load index.html: ${err.message}`);
        res.status(500).send('Server error');
        return;
      }

      // Inject only the WebSocket upgrade route from config.json
      const websocketUpgradeRoute = `${this.config.prog.websocket_server_url.route}`;
      Print('INFO', `The original websocket route as assembled from config.json is: ${websocketUpgradeRoute}`)

      const modifiedData = data.replace('[[WEBSOCKET_UPGRADE_ROUTE]]', websocketUpgradeRoute);
      Print('INFO', `index.html as modified with the injected websocket route is: \n${modifiedData}`)

      res.setHeader('Content-Type', 'text/html');
      res.send(modifiedData);
      Print('INFO', `Served index.html with WebSocket route injected for availability check at ${req.url}`);
    });
  }

  // WebSocket upgrade and handling method for specific route
  handleNewWebsocketConnection(req, socket, head)
  {
    this.wss.handleUpgrade(req, socket, head, (ws) =>
    {
      Print('INFO', 'WebSocket connection established for app logging data stream');
      this.wss.emit('connection', ws, req);
    });

    this.wss.on('connection', (ws) =>
    {
      Print('INFO', 'Client connected to WebSocket');

      ws.on('message', (message) =>
      {
        Print('INFO', `Received message: ${message}`);

        // Try to parse incoming message as JSON
        try
        {
          const data = JSON.parse(message); // Parse incoming message as JSON

          // Broadcast the parsed message as JSON string to all clients
          const jsonMessage = JSON.stringify(data);

          // Send to all connected WebSocket clients
          this.wss.clients.forEach((client) =>
          {
            if (client.readyState === WebSocket.OPEN)
            {
              client.send(jsonMessage); // Send JSON-serialized message
            }
          });
        }
        catch (error)
        {
          Print('ERROR', `Failed to parse WebSocket message as JSON: ${error.message}`);
        }
      });

      ws.on('close', () => Print('INFO', 'Client disconnected from WebSocket'));
    });
  }


  // Start the HTTPS and WebSocket server
  start()
  {
    this.server.listen(this.args.port, this.args.hostname, () =>
    {
      Print('INFO', `Server running at https://${this.args.hostname}:${this.args.port}`);
    });
  }
}

// Export Stargate for testing or external usage
module.exports = Stargate;

// Instantiate and start the server if executed directly
if (require.main === module)
{
  const stargateServer = new Stargate();
  stargateServer.start();
}
