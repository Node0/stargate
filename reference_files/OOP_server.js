const express = require('express');
const https = require('https');   // Import https module
const fs = require('fs');         // Import fs module to read the cert files
const path = require('path');     // For resolving file paths
// Obviously import ws and any other deps here...


class HelloWorld {
  constructor() {
    this.app = express();
    this.port = 5900; //obviously don't repeat this mindlessly, use the argparse way and call argparse from a class method.

    // Read the SSL certificate and key files
    this.sslOptions = {
      key: fs.readFileSync(path.resolve(__dirname, 'server.key')),   // Path to your key file
      cert: fs.readFileSync(path.resolve(__dirname, 'server.cert')), // Path to your cert file
    };

    this.setupRoutes(); // Initialize routes
  }

  // Method to set up the route handlers
  setupRoutes() {
    this.app.get('/hello-world', this.handleHelloWorld.bind(this));
  }

  // Route handler method for /hello-world
  handleHelloWorld(req, res) {
    res.send('Hello, World over HTTPS!');
  }

  // Method to start the server with HTTPS
  start() {
    https.createServer(this.sslOptions, this.app).listen(this.port, '0.0.0.0', () => {
      console.log(`Secure server is running on https://0.0.0.0:${this.port}`);
    });
  }
}



// Export class for testing and other purposes
module.exports = HelloWorld;


// Instantiate and start the server if executed directly
if (require.main === module) {
  // Create an instance of the HelloWorld class and start the server
  const helloWorldApp = new HelloWorld();
  helloWorldApp.start();
}




