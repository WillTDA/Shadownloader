import type { FileSource, ServerInfo, CryptoAdapter, BaseProgressEvent } from '../types.js';

// ============================================================================
// Session State Machine Types
// ============================================================================

/**
 * Finite state machine states for P2P send sessions.
 * Prevents race conditions and ensures callbacks fire in correct order.
 */
export type P2PSendState =
  | 'initializing'  // Peer is being created
  | 'listening'     // Waiting for receiver to connect
  | 'negotiating'   // Connected, sending metadata, waiting for ready
  | 'transferring'  // Actively sending file data
  | 'finishing'     // Sent end message, waiting for ack
  | 'completed'     // Transfer successful
  | 'cancelled'     // Transfer cancelled by user
  | 'closed';       // Session ended (success, error, or stopped)

/**
 * Finite state machine states for P2P receive sessions.
 */
export type P2PReceiveState =
  | 'initializing'  // Peer is being created
  | 'connecting'    // Connecting to sender
  | 'negotiating'   // Connected, waiting for metadata
  | 'transferring'  // Actively receiving file data
  | 'completed'     // Transfer successful
  | 'cancelled'     // Transfer cancelled by user
  | 'closed';       // Session ended (success, error, or stopped)

// ============================================================================
// PeerJS Types
// ============================================================================

/**
 * PeerJS Peer constructor interface.
 * Consumer must provide this constructor to P2P functions.
 */
export interface PeerConstructor {
  new (id?: string, options?: PeerOptions): PeerInstance;
}

/**
 * PeerJS connection options.
 */
export interface PeerOptions {
  /** PeerJS server hostname. */
  host?: string;
  /** PeerJS server port. */
  port?: number;
  /** PeerJS server path. */
  path?: string;
  /** Whether to use secure WebSocket connection. */
  secure?: boolean;
  /** WebRTC configuration. */
  config?: {
    /** ICE servers for NAT traversal. */
    iceServers?: RTCIceServer[];
  };
  /** PeerJS debug level (0-3). */
  debug?: number;
}

/** Event handlers for PeerInstance. */
export interface PeerInstanceEvents {
  open: (id: string) => void;
  connection: (conn: DataConnection) => void;
  error: (err: Error) => void;
  close: () => void;
}

/**
 * PeerJS Peer instance interface.
 * Represents a connection to the PeerJS signaling server.
 */
export interface PeerInstance {
  /** Register an event handler. */
  on<K extends keyof PeerInstanceEvents>(event: K, callback: PeerInstanceEvents[K]): void;
  on(event: string, callback: (...args: unknown[]) => void): void;
  /** Connect to another peer by ID. */
  connect(peerId: string, options?: { reliable?: boolean }): DataConnection;
  /** Destroy this peer and close all connections. */
  destroy(): void;
}

/** Event handlers for DataConnection. */
export interface DataConnectionEvents {
  open: () => void;
  data: (data: unknown) => void;
  close: () => void;
  error: (err: Error) => void;
}

/**
 * PeerJS DataConnection interface.
 * Represents a WebRTC data channel connection between peers.
 */
export interface DataConnection {
  /** Register an event handler. */
  on<K extends keyof DataConnectionEvents>(event: K, callback: DataConnectionEvents[K]): void;
  on(event: string, callback: (...args: unknown[]) => void): void;
  /** Send data to the connected peer. */
  send(data: unknown): void;
  /** Close the data connection. */
  close(): void;
  /** Internal WebRTC data channel (for buffer monitoring). */
  _dc?: RTCDataChannel;
}

// ============================================================================
// P2P Server Configuration
// ============================================================================

/**
 * Common server configuration for P2P connections.
 */
export interface P2PServerConfig {
  /** PeerJS server host. */
  host?: string;
  /** PeerJS server port. */
  port?: number;
  /** PeerJS server path (default: /peerjs). */
  peerjsPath?: string;
  /** Whether to use secure connection. */
  secure?: boolean;
  /** ICE servers for WebRTC. */
  iceServers?: RTCIceServer[];
}

// ============================================================================
// P2P Event Types
// ============================================================================

/** Status event for P2P operations. */
export interface P2PStatusEvent {
  phase: string;
  message: string;
}

/** Progress event for P2P send operations. */
export interface P2PSendProgressEvent extends BaseProgressEvent {}

/** Progress event for P2P receive operations. */
export interface P2PReceiveProgressEvent extends BaseProgressEvent {}

/** Metadata event when receiving a file. */
export interface P2PMetadataEvent {
  name: string;
  total: number;
  /** Call this to signal the sender to begin transfer (when autoReady is false). */
  sendReady?: () => void;
}

/** Completion event for P2P receive operations. */
export interface P2PReceiveCompleteEvent {
  received: number;
  total: number;
}

/** Cancellation event for P2P operations. */
export interface P2PCancellationEvent {
  /** Who cancelled the transfer ('sender' or 'receiver'). */
  cancelledBy: 'sender' | 'receiver';
  /** Optional cancellation message. */
  message?: string;
}

// ============================================================================
// P2P Send Options
// ============================================================================

/**
 * Options for starting a P2P send session.
 */
export interface P2PSendOptions extends P2PServerConfig {
  /** File to send. */
  file: FileSource;
  /** PeerJS Peer constructor - REQUIRED. */
  Peer: PeerConstructor;
  /** Server info (optional, for capability checking). */
  serverInfo?: ServerInfo;
  /** Custom code generator function. */
  codeGenerator?: (cryptoObj?: CryptoAdapter) => string;
  /** Crypto object for secure code generation. */
  cryptoObj?: CryptoAdapter;
  /** Max attempts to register a peer ID. */
  maxAttempts?: number;
  /** Chunk size for data transfer. */
  chunkSize?: number;
  /** Timeout waiting for end acknowledgment. */
  endAckTimeoutMs?: number;
  /** Buffer high water mark for flow control. */
  bufferHighWaterMark?: number;
  /** Buffer low water mark for flow control. */
  bufferLowWaterMark?: number;
  /** Heartbeat interval in ms for long transfers (default: 5000, 0 to disable). */
  heartbeatIntervalMs?: number;
  /** Callback when code is generated. */
  onCode?: (code: string, attempt: number) => void;
  /** Callback for status updates. */
  onStatus?: (evt: P2PStatusEvent) => void;
  /** Callback for progress updates. */
  onProgress?: (evt: P2PSendProgressEvent) => void;
  /** Callback when transfer completes. */
  onComplete?: () => void;
  /** Callback on error. */
  onError?: (err: Error) => void;
  /** Callback when receiver disconnects. */
  onDisconnect?: () => void;
  /** Callback when transfer is cancelled by either party. */
  onCancel?: (evt: P2PCancellationEvent) => void;
}

/**
 * Return value from startP2PSend containing session control.
 */
export interface P2PSendSession {
  /** The PeerJS peer instance. */
  peer: PeerInstance;
  /** The generated sharing code. */
  code: string;
  /** The unique session ID for this transfer. */
  sessionId: string;
  /** Stop the session and clean up resources. */
  stop: () => void;
  /** Get the current session state. */
  getStatus: () => P2PSendState;
  /** Get the number of bytes sent so far. */
  getBytesSent: () => number;
  /** Get the connected receiver's peer ID (if connected). */
  getConnectedPeerId: () => string | null;
}

// ============================================================================
// P2P Receive Options
// ============================================================================

/**
 * Options for starting a P2P receive session.
 */
export interface P2PReceiveOptions extends P2PServerConfig {
  /** Sharing code to connect to. */
  code: string;
  /** PeerJS Peer constructor - REQUIRED. */
  Peer: PeerConstructor;
  /** Server info (optional, for capability checking). */
  serverInfo?: ServerInfo;
  /**
   * Whether to automatically send the "ready" signal after receiving metadata.
   * Default: true.
   * Set to false to show a preview and manually control when the transfer starts.
   * When false, call the sendReady function passed to onMeta to start the transfer.
   */
  autoReady?: boolean;
  /**
   * Timeout in ms for detecting dead connections (no data received).
   * Default: 15000 (15 seconds). Set to 0 to disable.
   */
  watchdogTimeoutMs?: number;
  /** Callback for status updates. */
  onStatus?: (evt: P2PStatusEvent) => void;
  /**
   * Callback when file metadata is received.
   * When autoReady is false, this callback receives a sendReady function
   * that must be called to signal the sender to begin the transfer.
   */
  onMeta?: (evt: P2PMetadataEvent) => void;
  /** Callback when data chunk is received - consumer handles file writing. */
  onData?: (chunk: Uint8Array) => Promise<void> | void;
  /** Callback for progress updates. */
  onProgress?: (evt: P2PReceiveProgressEvent) => void;
  /** Callback when transfer completes. */
  onComplete?: (evt: P2PReceiveCompleteEvent) => void;
  /** Callback on error. */
  onError?: (err: Error) => void;
  /** Callback when sender disconnects. */
  onDisconnect?: () => void;
  /** Callback when transfer is cancelled by either party. */
  onCancel?: (evt: P2PCancellationEvent) => void;
}

/**
 * Return value from startP2PReceive containing session control.
 */
export interface P2PReceiveSession {
  /** The PeerJS peer instance. */
  peer: PeerInstance;
  /** Stop the session and clean up resources. */
  stop: () => void;
  /** Get the current session state. */
  getStatus: () => P2PReceiveState;
  /** Get the number of bytes received so far. */
  getBytesReceived: () => number;
  /** Get the expected total bytes (0 if metadata not received). */
  getTotalBytes: () => number;
  /** Get the current session ID (if received from sender). */
  getSessionId: () => string | null;
}
