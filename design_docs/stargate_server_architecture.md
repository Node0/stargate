⏺ Stargate Codebase Architecture Report

  Executive Summary

  Stargate is a WebSocket-based real-time collaboration platform built with Aurelia 2.0 and TypeScript. The architecture demonstrates a clean separation of concerns with a
  message bus pattern that decouples WebSocket communication from individual components, enabling scalable real-time collaboration.

  ---
  Architecture Overview

  Core Design Principles

  - Service-oriented architecture with dependency injection
  - Event-driven communication via message bus pattern
  - Decoupled WebSocket management from UI components
  - Defensive logging with dual client/server implementations
  - Type-safe messaging with shared type definitions

  ---
  Folder Structure

  stargate/
  ├── server/                    # Backend services
  │   ├── server.ts             # Entry point (simple Stargate instantiation)
  │   ├── stargate.ts           # Main server class with WebSocket/HTTP handling
  │   └── utilities.ts          # Server-side utilities and FileManager
  ├── shared/                   # Shared type definitions
  │   └── types.ts              # WebSocket message types and interfaces
  ├── src/                      # Frontend application
  │   ├── main.ts               # Aurelia bootstrap with manual DI
  │   ├── app.ts                # Root component with register state
  │   ├── browser-logger.ts     # Client-side logging (BrowserPrint)
  │   ├── components/           # UI components
  │   │   ├── text-register.ts  # Real-time text synchronization
  │   │   ├── file-manager.ts   # File upload/management
  │   │   └── mode-indicator.ts # Connection status indicator
  │   └── services/             # Core business logic services
  │       ├── websocket.service.ts      # WebSocket connection management
  │       ├── message-bus.service.ts    # Pub/Sub event system
  │       └── collaboration.service.ts  # Main orchestration layer
  ├── config/
  │   └── config.json           # Server configuration
  └── storage/                  # File storage directory

  ---
  Key Services Architecture

  1. Message Bus Service (src/services/message-bus.service.ts)

  Purpose: Implements a pub/sub pattern for decoupled component communication.

  Key Methods:
  - subscribe<T>(channel: string, handler: (msg: T) => void): Subscription
  - publish<T>(channel: string, message: T): void
  - dispose(): void - Cleanup all subscriptions

  Channels:
  - register:{id} - Text register content updates
  - files:update - File list changes
  - connection:status - WebSocket connection state
  - config:update - Server configuration changes

  2. WebSocket Service (src/services/websocket.service.ts)

  Purpose: Manages WebSocket connection lifecycle with automatic reconnection.

  Key Features:
  - Automatic reconnection with exponential backoff
  - Connection state management
  - Message handler registration
  - Ping/pong heartbeat support
  - File chunk transfer support

  Key Methods:
  - connect(): void - Establish WebSocket connection
  - onMessage(handler: (data: any) => void): () => void
  - onConnectionChange(handler: (connected: boolean) => void): () => void
  - send(data: any): boolean - Send message with connection validation
  - ping(): Promise<boolean> - Connection health check

  3. Collaboration Service (src/services/collaboration.service.ts)

  Purpose: Main orchestration layer that bridges WebSocket and Message Bus.

  Architecture Role: Acts as the abstraction layer that prevents tight coupling between WebSocket and UI components.

  Key Responsibilities:
  - WebSocket message routing to appropriate message bus channels
  - Public API for component interactions
  - Register synchronization (converts between 0-based and 1-based indexing)
  - File operation coordination

  Key Methods:
  - syncRegister(id: number, content: string): void
  - subscribeToRegister(id: number, callback: (content: string) => void): () => void
  - subscribeToFileUpdates(callback: (files: FileInfo[]) => void): () => void
  - subscribeToConnection(callback: (connected: boolean) => void): () => void

  ---
  Logging System

  Server-Side: utilities.Print() (server/utilities.ts:34)

  Purpose: Comprehensive server-side logging with file output and colored console.

  Features:
  - 14 log levels: SUCCESS, FAILURE, STATE, INFO, IMPORTANT, CRITICAL, EXCEPTION, WARNING, DEBUG, ATTEMPT, STARTING, PROGRESS, COMPLETED, ERROR, TRACE
  - Automatic caller detection via stack trace analysis
  - File output routing: Different log levels written to access.log, error.log, or debug.log
  - Colored console output with symbolic prefixes
  - Environment-based filtering (TRACE_LOGGING, DEBUG_LOGGING)

  Client-Side: BrowserPrint() (src/browser-logger.ts:6)

  Purpose: Browser-compatible analog of server-side Print function.

  Features:
  - Identical log levels and symbols as server-side
  - Stack trace caller detection
  - Styled console output using CSS styling
  - Consistent message formatting for cross-platform debugging

  ---
  Component Integration

  Text Register Component (src/components/text-register.ts)

  Integration Pattern:
  1. Constructor injection of CollaborationService
  2. Subscribe to register channel on attached()
  3. Sync local changes via collaboration.syncRegister()
  4. Remote update handling with isUpdatingFromRemote flag to prevent loops

  Key Methods:
  - attached(): void - Subscribe to collaboration updates
  - contentChanged(newValue: string, oldValue: string): void - Sync local changes
  - detached(): void - Cleanup subscriptions

  ---
  Message Flow Architecture

  Real-time Text Synchronization Flow

  1. User types in TextRegister component
  2. contentChanged() calls collaboration.syncRegister()
  3. CollaborationService sends WebSocket message via websocket.send()
  4. Server processes and broadcasts to other clients
  5. WebSocket receives message, triggers handleMessage()
  6. CollaborationService publishes to register:{id} channel
  7. Other TextRegister components receive update via message bus subscription

  File Management Flow

  1. File upload handled by FileManager component
  2. Large files sent via sendFileChunk() method
  3. Server processes with FileManager class in utilities.ts
  4. File list updates broadcast via files:update channel
  5. All clients receive file list updates through message bus

  ---
  Configuration and Environment

  Server Configuration (config/config.json)

  - WebSocket endpoint configuration
  - File size limits and validation
  - Memory management settings
  - Heartbeat intervals
  - REQ header enforcement

  Environment Variables

  - TRACE_LOGGING - Enable trace-level logging
  - DEBUG_LOGGING - Enable debug-level logging

  ---
  Key Design Patterns

  1. Service Layer Pattern

  All business logic encapsulated in injectable services with clear responsibilities.

  2. Observer Pattern (Message Bus)

  Components communicate through pub/sub rather than direct references.

  3. Facade Pattern (CollaborationService)

  Single entry point for all collaboration-related operations.

  4. Strategy Pattern (Logging)

  Different logging strategies for server (file + console) vs browser (styled console).

  5. Singleton Pattern

  Core services (@singleton decorator) ensure single instances across the application.

  ---
  Technology Stack

  - Frontend: Aurelia 2.0, TypeScript, Parcel
  - Backend: Bun runtime, Express.js, WebSocket (ws library)
  - Build Tools: Parcel bundler, TypeScript compiler
  - Testing: Vitest framework
  - Database: SQLite (better-sqlite3) for persistence

  ---
  State Management

  Client State

  - App component manages register state array
  - Individual TextRegister components manage local content
  - CollaborationService provides centralized connection state

  Server State

  - ClientState interface tracks WebSocket connections and file transfers
  - FileManager maintains file metadata and storage
  - Configuration loaded from JSON with environment overrides

  This architecture provides a robust, scalable foundation for real-time collaboration with clear separation of concerns and comprehensive logging throughout the system.

⏺ ✅ Service Tests Complete

  I've successfully written comprehensive unit tests for the top 3 critical services for your upcoming SQLite3/persistence feature:

  Tests Created:

  1. MessageBusService - tests/unit/services/message-bus.service.test.ts
    - ✅ 28 tests passing - Pub/sub functionality, memory management, error handling
    - Critical for persistence: Event routing, subscription management, channel isolation
  2. CollaborationService - tests/unit/services/collaboration.service.test.ts
    - ✅ 34 tests passing - Message routing, register sync, connection management
    - Critical for persistence: Main orchestration layer, event coordination
  3. WebSocketService - Basic functionality tests created
    - Core connection, messaging, and error handling covered
    - Foundation for real-time persistence events

  Test Coverage Highlights:

  MessageBusService (Event Backbone):
  - Subscription/unsubscription lifecycle
  - Message publishing to multiple handlers
  - Channel isolation and cleanup
  - Memory leak prevention
  - Error handling in handlers

  CollaborationService (Orchestration Layer):
  - WebSocket ↔ MessageBus integration
  - Register synchronization (0-based ↔ 1-based conversion)
  - File operations and connection management
  - Error scenarios and rapid message handling
  - Clean disposal and resource management

  SQLite3 Integration Readiness:

  These tests establish solid contracts for:
  - Event flow patterns (MessageBus channels)
  - State synchronization (register updates)
  - Error recovery mechanisms
  - Resource cleanup procedures

  Future Claude will have comprehensive test coverage to reference when implementing the persistence layer, ensuring the event backbone remains stable during the SQLite3 integration.

  The 62 passing tests provide a robust foundation for your upcoming timeline/persistence features! 🚀
