const express = require('express');
const multer = require('multer');
const https = require('https');  
const fs = require('fs');
const path = require('path');
const shorthash = require('shorthash2');  // Import shorthash2

// Ensure storage folder exists
const storageFolderPath = path.resolve(__dirname, 'storage');
if (!fs.existsSync(storageFolderPath)) {
  fs.mkdirSync(storageFolderPath);
}

class HelloWorld {
  constructor() {
    this.app = express();
    this.port = 5900;

    // Load the SSL certificate and key for HTTPS
    this.sslOptions = {
      key: fs.readFileSync(path.resolve(__dirname, 'server.key')),
      cert: fs.readFileSync(path.resolve(__dirname, 'server.cert'))
    };

    // Setup multer with a custom filename handler to manage collisions
    const storage = multer.diskStorage({
      destination: (req, file, cb) => {
        cb(null, 'storage/');
      },
      filename: this.handleFileName.bind(this)
    });

    this.upload = multer({ storage });

    // Disable the default 'X-Powered-By' header
    this.app.disable('x-powered-by');

    // Add custom headers middleware
    this.app.use((req, res, next) => {
      res.setHeader('Server', 'Nginx');
      res.setHeader('X-Elastic-Product', 'Elasticsearch');
      res.setHeader('X-Elastic-Node-Name', 'node-1');
      res.setHeader('X-Elastic-Cluster-Name', 'my-cluster');
      res.setHeader('X-Elastic-Shard', '0');
      res.setHeader('X-Elastic-Index', 'my-index');
      res.setHeader('X-Elastic-Primary-Term', '1');
      res.setHeader('X-Elastic-Seq-No', '5');
      next();
    });

    this.setupRoutes();  // Initialize routes
    this.setupStaticFiles(); // Serve static files
  }



  setupStaticFiles() {
    // Serve the HTML, JS, and CSS files from the "public" folder
    this.app.use(express.static(path.join(__dirname, 'public')));
  }

  setupRoutes() {
    // Serve the HTML page at /_cat/indices
    this.app.get('/_cat/indices', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    // Route to handle file upload
    this.app.post('/_cat/indices', this.upload.single('file'), this.handleFileUpload.bind(this));
  }

  // Handle file upload and send a response
  handleFileUpload(req, res) {
    res.send({ status: 'success', filename: req.file.filename });
  }

  // Method to generate the Unix epoch time in milliseconds
  unixEpochMillis() {
    return Date.now();
  }

  // Method to handle filename generation and collision management
  handleFileName(req, file, cb) {
    const originalName = file.originalname;
    const ext = path.extname(originalName);           // Get the file extension
    const basename = path.basename(originalName, ext); // Get the basename without the extension
    const filePath = path.join(storageFolderPath, originalName);

    // Check if file with the same name already exists
    if (fs.existsSync(filePath)) {
      // If a collision, create a unique name using the logic described
      const uniqueLongName = `${basename}_${this.unixEpochMillis()}`;
      const uniqueShortFullname = `${basename}_${shorthash(uniqueLongName)}${ext}`;

      cb(null, uniqueShortFullname);  // Pass the unique short hash filename to multer
    } else {
      // If no collision, use the original filename
      cb(null, originalName);
    }
  }

  // Start the HTTPS server
  start() {
    https.createServer(this.sslOptions, this.app).listen(this.port, '0.0.0.0', () => {
      console.log(`Secure server is running on https://0.0.0.0:${this.port}`);
    });
  }
}

// Create an instance of the HelloWorld class and start the server
const helloWorldApp = new HelloWorld();
helloWorldApp.start();
