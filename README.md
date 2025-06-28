# Stargate
### A Real-time WebSocket Collaboration Server

Stargate is a NodeJS server running on the bun engine, designed for collaborative text editing across machines in a local network. It provides a workspace where users can share files and code seamlessly through resizable text areas, making collaboration efficient and straightforward.

## Basic Installation & Startup

1. Clone this repository:

   ```bash
   git clone <repository-url>
   ```

2. Navigate to the `app` directory:

   ```bash
   cd stargate/app
   ```

3. Install the required dependencies:

   ```bash
   npm install
   ```

### Command Line Arguments

Stargate allows for configurable startup parameters via command-line arguments:

- `--hostname`: Specify the hostname for the server (default: `0.0.0.0`).
- `--port`: Specify the port for the server (default: `5900`).

### Unit Tests
#### (For developers)

4. Run the Unit Test Suite and Generate Code Coverage Reports:

   ```bash
   npm run coverage
   ```

#### General Folder structure & location of SSL (cert & key) files
**Note: User must create and supply the SSL files**
```
├── LICENSE
├── README.md
├── app
│   ├── server.js          # Entry point
│   ├── backend/
│   │   ├── stargate.js    # Main server class
│   │   └── utilities.js   # Shared utilities
│   ├── frontend/
│   │   ├── file-manager-ui.js
│   │   └── styles.css
│   ├── templates/
│   │   └── index.template.html
│   ├── conf/
│   │   └── config.json
│   ├── logs/
│   ├── storage/
│   ├── tests/
│   ├── server.cert
│   ├── server.key
│   ├── package.json
│   └── package-lock.json
└── reference_files
```


### Operation
5. Start the server:

   ```bash
   node server.js --hostname="0.0.0.0" --port="8080"
   ```

Upon starting, the server will listen for WebSocket connections and serve the collaborative editing interface at the route detailed below.

##### Stargate features configurable routes for both the collab interface and the websocket upgrade route

<br>

**To configure or use the collab interface route please see:**
`config.json -> prog.collab_interface_url.route`



**To configure or use the websocket upgrade route please see:**
`config.json -> prog.websocket_server_url.route`

<br>

## Swagger Documentation
`TODO: Implement Swagger docs`

### Configuration

The server configuration is defined in `app/conf/config.json`. Adjust the settings to customize the server's behavior, including logging levels and WebSocket routes.

Example `config.json`:

```json
{
  "prog": {
    "logging_level": "debug",
    "collab_interface_url": { "route": "/_cat/indices", "response_text": "WebSocket Service available" },
    "websocket_server_url": { "route": "/_data_stream/app_logging_data" }
  }
}
```

### Client Interface

The client interface is served through `public/index.html`, providing a user-friendly layout with multiple text areas for collaborative input. The styling is handled through `public/styles.css`.

### Contributions

Contributions are welcome! If you have suggestions or improvements, feel free to open an issue or submit a pull request.

### License

This project is licensed under the GPLv2 License. See the `LICENSE` file for details.

### Author

This project was created and is maintained by Joe Hacobian.
