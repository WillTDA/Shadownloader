/**
 * Server upload capabilities returned from the server info endpoint.
 */
export interface UploadCapabilities {
  /** Whether hosted uploads are enabled on the server. */
  enabled: boolean;
  /** Maximum file size in megabytes (0 = unlimited). */
  maxSizeMB?: number;
  /** Maximum file lifetime in hours (0 = unlimited). */
  maxLifetimeHours?: number;
  /** Whether end-to-end encryption is supported. */
  e2ee?: boolean;
}

/**
 * Server P2P (direct transfer) capabilities.
 */
export interface P2PCapabilities {
  /** Whether P2P transfers are enabled on the server. */
  enabled: boolean;
  /** Path to the PeerJS signaling server. */
  peerjsPath?: string;
  /** ICE servers for WebRTC connectivity. */
  iceServers?: RTCIceServer[];
}

/**
 * Server Web UI capabilities.
 */
export interface WebUICapabilities {
  /** Whether the Web UI is enabled on the server. */
  enabled: boolean;
}

/**
 * Combined server capabilities object.
 */
export interface ServerCapabilities {
  /** Hosted upload capabilities. */
  upload?: UploadCapabilities;
  /** P2P transfer capabilities. */
  p2p?: P2PCapabilities;
  /** Web UI capabilities. */
  webUI?: WebUICapabilities;
}

/**
 * Server information returned from the /api/info endpoint.
 */
export interface ServerInfo {
  /** Display name of the server. */
  name?: string;
  /** Server version string. */
  version: string;
  /** Server capabilities. */
  capabilities?: ServerCapabilities;
}

/**
 * Base progress event with common fields for all transfer operations.
 * Provides a consistent interface for upload, download, and P2P progress tracking.
 */
export interface BaseProgressEvent {
  /** Completion percentage (0-100). */
  percent: number;
  /** Bytes processed so far (sent, received, or uploaded). */
  processedBytes: number;
  /** Total bytes expected (may be 0 if unknown). */
  totalBytes: number;
}

/**
 * Progress event emitted during upload operations.
 */
export interface UploadProgressEvent extends BaseProgressEvent {
  /** Current phase of the operation. */
  phase: 'server-info' | 'server-compat' | 'crypto' | 'init' | 'chunk' | 'complete' | 'done' | 'retry-wait' | 'retry';
  /** Human-readable status text. */
  text?: string;
  /** Current chunk index (0-based). */
  chunkIndex?: number;
  /** Total number of chunks. */
  totalChunks?: number;
}

/**
 * Result of a successful file upload.
 */
export interface UploadResult {
  /** Full download URL including encryption key fragment if encrypted. */
  downloadUrl: string;
  /** Unique file identifier on the server. */
  fileId: string;
  /** Upload session identifier. */
  uploadId: string;
  /** Server base URL used for the upload. */
  baseUrl: string;
  /** Base64-encoded encryption key (only present if encrypted). */
  keyB64?: string;
}

/**
 * Upload session with cancellation support.
 * Returned by uploadFile() to allow cancelling uploads in progress.
 */
export interface UploadSession {
  /** Promise that resolves with upload result when complete. */
  result: Promise<UploadResult>;
  /** Cancel the upload. */
  cancel: (reason?: string) => void;
  /** Get current upload status. */
  getStatus: () => 'initializing' | 'uploading' | 'completing' | 'completed' | 'cancelled' | 'error';
}

/**
 * Result of a client/server compatibility check.
 */
export interface CompatibilityResult {
  /** Whether the client and server versions are compatible. */
  compatible: boolean;
  /** Human-readable compatibility message. */
  message: string;
  /** Client version string. */
  clientVersion: string;
  /** Server version string. */
  serverVersion: string;
}

/**
 * Result of resolving a share target (code or URL).
 */
export interface ShareTargetResult {
  /** Whether the share target is valid. */
  valid: boolean;
  /** Type of share target (e.g., 'p2p', 'file'). */
  type?: string;
  /** Resolved target identifier. */
  target?: string;
  /** Reason for invalidity if not valid. */
  reason?: string;
}

/**
 * Crypto adapter interface compatible with the Web Crypto API.
 * Used for encryption operations and secure random generation.
 */
export interface CryptoAdapter {
  /** SubtleCrypto interface for cryptographic operations. */
  readonly subtle: SubtleCrypto;
  /** Fill an array with cryptographically secure random values. */
  getRandomValues<T extends ArrayBufferView | null>(array: T): T;
}

/**
 * Fetch function type compatible with the standard fetch API.
 * @param input - The URL or Request object to fetch.
 * @param init - Optional fetch configuration.
 * @returns A Promise that resolves to a Response.
 */
export type FetchFn = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

/**
 * Base64 adapter for environment-agnostic encoding/decoding.
 * Allows the library to work in both browser and Node.js environments.
 */
export interface Base64Adapter {
  /** Encode bytes to a base64 string. */
  encode(bytes: Uint8Array): string;
  /** Decode a base64 string to bytes. */
  decode(b64: string): Uint8Array;
}

/**
 * File source abstraction for cross-environment compatibility.
 * Works with browser File/Blob and can be implemented for Node.js streams.
 */
export interface FileSource {
  /** File name. */
  readonly name: string;
  /** File size in bytes. */
  readonly size: number;
  /** MIME type of the file. */
  readonly type?: string;
  /** Extract a slice of the file. */
  slice(start: number, end: number): FileSource;
  /** Read the entire file as an ArrayBuffer. */
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * Logger function type for debug and diagnostic output.
 * @param level - Log level (debug, info, warn, error).
 * @param message - Log message.
 * @param meta - Optional metadata object.
 */
export type LoggerFn = (
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  meta?: unknown
) => void;

/**
 * Options for constructing a DropgateClient instance.
 */
export interface DropgateClientOptions {
  /** Client version string for compatibility checking with the server. */
  clientVersion: string;
  /** Upload chunk size in bytes (default: 5MB). */
  chunkSize?: number;
  /** Custom fetch implementation (uses global fetch by default). */
  fetchFn?: FetchFn;
  /** Custom crypto implementation (uses global crypto by default). */
  cryptoObj?: CryptoAdapter;
  /** Custom base64 encoder/decoder. */
  base64?: Base64Adapter;
  /** Custom logger function for debug output. */
  logger?: LoggerFn;
}

/**
 * Common server target options specifying the server to connect to.
 */
export interface ServerTarget {
  /** Server hostname (e.g., 'dropgate.link'). */
  host: string;
  /** Server port number (omit for default 80/443). */
  port?: number;
  /** Whether to use HTTPS (default: true). */
  secure?: boolean;
}

/**
 * Options for uploading a file to the server.
 */
export interface UploadOptions extends ServerTarget {
  /** File to upload. */
  file: FileSource;
  /** File lifetime in milliseconds (0 = server default). */
  lifetimeMs: number;
  /** Whether to encrypt the file with E2EE. */
  encrypt: boolean;
  /** Override the filename sent to the server. */
  filenameOverride?: string;
  /** Callback for progress updates. */
  onProgress?: (evt: UploadProgressEvent) => void;
  /** Callback when upload is cancelled by user. */
  onCancel?: () => void;
  /** AbortSignal to cancel the upload. */
  signal?: AbortSignal;
  /** Timeout settings for various upload phases. */
  timeouts?: {
    /** Timeout for fetching server info (default: 5000ms). */
    serverInfoMs?: number;
    /** Timeout for upload initialization (default: 15000ms). */
    initMs?: number;
    /** Timeout for each chunk upload (default: 60000ms). */
    chunkMs?: number;
    /** Timeout for upload completion (default: 30000ms). */
    completeMs?: number;
  };
  /** Retry settings for failed chunk uploads. */
  retry?: {
    /** Maximum number of retries per chunk (default: 5). */
    retries?: number;
    /** Initial backoff delay in milliseconds (default: 1000ms). */
    backoffMs?: number;
    /** Maximum backoff delay in milliseconds (default: 30000ms). */
    maxBackoffMs?: number;
  };
}

/**
 * Options for fetching server information.
 */
export interface GetServerInfoOptions extends ServerTarget {
  /** Request timeout in milliseconds (default: 5000ms). */
  timeoutMs?: number;
  /** AbortSignal to cancel the request. */
  signal?: AbortSignal;
  /** Custom fetch implementation (uses global fetch by default). */
  fetchFn?: FetchFn;
}

/**
 * Options for validating upload inputs before starting an upload.
 */
export interface ValidateUploadOptions {
  /** File to validate. */
  file: FileSource;
  /** Requested file lifetime in milliseconds. */
  lifetimeMs: number;
  /** Whether encryption will be used. */
  encrypt: boolean;
  /** Server info containing capabilities to validate against. */
  serverInfo: ServerInfo;
}

/**
 * File metadata returned from the server.
 */
export interface FileMetadata {
  /** Whether the file is encrypted. */
  isEncrypted: boolean;
  /** File size in bytes (encrypted size if encrypted). */
  sizeBytes: number;
  /** Original filename (only for unencrypted files). */
  filename?: string;
  /** Encrypted filename (only for encrypted files). */
  encryptedFilename?: string;
}

/**
 * Download progress event.
 */
export interface DownloadProgressEvent extends BaseProgressEvent {
  /** Current phase of the download. */
  phase: 'server-info' | 'server-compat' | 'metadata' | 'downloading' | 'decrypting' | 'complete';
  /** Human-readable status text. */
  text?: string;
}

/**
 * Options for downloading a file.
 */
export interface DownloadOptions extends ServerTarget {
  /** File ID to download. */
  fileId: string;
  /** Base64-encoded decryption key (required for encrypted files). */
  keyB64?: string;
  /** Callback for progress updates. */
  onProgress?: (evt: DownloadProgressEvent) => void;
  /** Callback for received data chunks. Consumer handles file writing. */
  onData?: (chunk: Uint8Array) => Promise<void> | void;
  /** AbortSignal to cancel the download. */
  signal?: AbortSignal;
  /** Request timeout in milliseconds (default: 60000ms). */
  timeoutMs?: number;
}

/**
 * Result of a file download.
 */
export interface DownloadResult {
  /** Decrypted filename. */
  filename: string;
  /** Total bytes received. */
  receivedBytes: number;
  /** Whether the file was encrypted. */
  wasEncrypted: boolean;
  /** The file data (only if onData callback was not provided). */
  data?: Uint8Array;
}
