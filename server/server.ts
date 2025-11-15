#!/usr/bin/env bun
import { Stargate } from './stargate';

// Instantiate and start the server
const server = new Stargate();

// Start server with SSL certificate management
server.start().catch((error) => {
  console.error('Failed to start Stargate server:', error);
  process.exit(1);
});