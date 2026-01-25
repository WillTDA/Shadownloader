import type { FileSource, ServerInfo, CryptoAdapter } from '../types.js';

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

/**
 * PeerJS Peer instance interface.
 * Represents a connection to the PeerJS signaling server.
 */
export interface PeerInstance {
  /** Register an event handler. */
  on(event: 'open', callback: (id: string) => void): void;
  on(event: 'connection', callback: (conn: DataConnection) => void): void;
  on(event: 'error', callback: (err: Error) => void): void;
  on(event: 'close', callback: () => void): void;
  on(event: string, callback: (...args: unknown[]) => void): void;
  /** Connect to another peer by ID. */
  connect(peerId: string, options?: { reliable?: boolean }): DataConnection;
  /** Destroy this peer and close all connections. */
  destroy(): void;
}

/**
 * PeerJS DataConnection interface.
 * Represents a WebRTC data channel connection between peers.
 */
export interface DataConnection {
  /** Register an event handler. */
  on(event: 'open', callback: () => void): void;
  on(event: 'data', callback: (data: unknown) => void): void;
  on(event: 'close', callback: () => void): void;
  on(event: 'error', callback: (err: Error) => void): void;
  on(event: string, callback: (...args: unknown[]) => void): void;
  /** Send data to the connected peer. */
  send(data: unknown): void;
  /** Close the data connection. */
  close(): void;
  /** Internal WebRTC data channel (for buffer monitoring). */
  _dc?: RTCDataChannel;
}

/**
 * Options for starting a P2P send session.
 */
export interface P2PSendOptions {
  /** File to send */
  file: FileSource;
  /** PeerJS Peer constructor - REQUIRED */
  Peer: PeerConstructor;
  /** Server info (optional, for capability checking) */
  serverInfo?: ServerInfo;
  /** PeerJS server host */
  host?: string;
  /** PeerJS server port */
  port?: number;
  /** PeerJS server path (default: /peerjs) */
  peerjsPath?: string;
  /** Whether to use secure connection */
  secure?: boolean;
  /** ICE servers for WebRTC */
  iceServers?: RTCIceServer[];
  /** Custom code generator function */
  codeGenerator?: (cryptoObj?: CryptoAdapter) => string;
  /** Crypto object for secure code generation */
  cryptoObj?: CryptoAdapter;
  /** Max attempts to register a peer ID */
  maxAttempts?: number;
  /** Chunk size for data transfer */
  chunkSize?: number;
  /** Timeout waiting for receiver ready signal */
  readyTimeoutMs?: number;
  /** Timeout waiting for end acknowledgment */
  endAckTimeoutMs?: number;
  /** Buffer high water mark for flow control */
  bufferHighWaterMark?: number;
  /** Buffer low water mark for flow control */
  bufferLowWaterMark?: number;
  /** Callback when code is generated */
  onCode?: (code: string, attempt: number) => void;
  /** Callback for status updates */
  onStatus?: (evt: { phase: string; message: string }) => void;
  /** Callback for progress updates */
  onProgress?: (evt: { sent: number; total: number; percent: number }) => void;
  /** Callback when transfer completes */
  onComplete?: () => void;
  /** Callback on error */
  onError?: (err: Error) => void;
}

/**
 * Return value from startP2PSend containing session control.
 */
export interface P2PSendSession {
  /** The PeerJS peer instance. */
  peer: PeerInstance;
  /** The generated sharing code. */
  code: string;
  /** Stop the session and clean up resources. */
  stop: () => void;
}

/**
 * Options for starting a P2P receive session.
 */
export interface P2PReceiveOptions {
  /** Sharing code to connect to */
  code: string;
  /** PeerJS Peer constructor - REQUIRED */
  Peer: PeerConstructor;
  /** Server info (optional, for capability checking) */
  serverInfo?: ServerInfo;
  /** PeerJS server host */
  host?: string;
  /** PeerJS server port */
  port?: number;
  /** PeerJS server path (default: /peerjs) */
  peerjsPath?: string;
  /** Whether to use secure connection */
  secure?: boolean;
  /** ICE servers for WebRTC */
  iceServers?: RTCIceServer[];
  /**
   * Whether to automatically send the "ready" signal after receiving metadata.
   * Default: true
   * Set to false to show a preview and manually control when the transfer starts.
   * When false, call the sendReady function passed to onMeta to start the transfer.
   */
  autoReady?: boolean;
  /** Callback for status updates */
  onStatus?: (evt: { phase: string; message: string }) => void;
  /**
   * Callback when file metadata is received.
   * When autoReady is false, this callback receives a sendReady function
   * that must be called to signal the sender to begin the transfer.
   */
  onMeta?: (evt: { name: string; total: number; sendReady?: () => void }) => void;
  /** Callback when data chunk is received - consumer handles file writing */
  onData?: (chunk: Uint8Array) => Promise<void> | void;
  /** Callback for progress updates */
  onProgress?: (evt: { received: number; total: number; percent: number }) => void;
  /** Callback when transfer completes */
  onComplete?: (evt: { received: number; total: number }) => void;
  /** Callback on error */
  onError?: (err: Error) => void;
  /** Callback when sender disconnects */
  onDisconnect?: () => void;
}

/**
 * Return value from startP2PReceive containing session control.
 */
export interface P2PReceiveSession {
  /** The PeerJS peer instance. */
  peer: PeerInstance;
  /** Stop the session and clean up resources. */
  stop: () => void;
}
