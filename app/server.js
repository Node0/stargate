#!/usr/bin/env node

// Entry point for Stargate server
// This file stays at the app root for convenient startup

const Stargate = require('./backend/stargate');

// Instantiate and start the server
const stargateServer = new Stargate();
stargateServer.start();