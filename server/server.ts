#!/usr/bin/env bun
import { Stargate } from './stargate';

// Instantiate and start the server
const server = new Stargate();
server.start();