// Constants
export {
  DEFAULT_CHUNK_SIZE,
  AES_GCM_IV_BYTES,
  AES_GCM_TAG_BYTES,
  ENCRYPTION_OVERHEAD_PER_CHUNK,
} from './constants.js';

// Errors
export {
  DropgateError,
  DropgateValidationError,
  DropgateNetworkError,
  DropgateProtocolError,
  DropgateAbortError,
  DropgateTimeoutError,
} from './errors.js';
export type { DropgateErrorOptions } from './errors.js';

// Types
export type {
  UploadCapabilities,
  P2PCapabilities,
  WebUICapabilities,
  ServerCapabilities,
  ServerInfo,
  BaseProgressEvent,
  UploadProgressEvent,
  UploadResult,
  CompatibilityResult,
  ShareTargetResult,
  CryptoAdapter,
  FetchFn,
  Base64Adapter,
  FileSource,
  DropgateClientOptions,
  ServerTarget,
  UploadFileOptions,
  GetServerInfoOptions,
  ConnectOptions,
  ValidateUploadOptions,
  FileMetadata,
  DownloadProgressEvent,
  DownloadFileOptions,
  DownloadResult,
} from './types.js';

// Upload session type (not in types.ts, part of UploadSession)
export type { UploadSession } from './types.js';

// Utils - Base64
export { bytesToBase64, arrayBufferToBase64, base64ToBytes } from './utils/base64.js';

// Utils - Lifetime
export { lifetimeToMs } from './utils/lifetime.js';

// Utils - Semver
export { parseSemverMajorMinor } from './utils/semver.js';
export type { SemverParts } from './utils/semver.js';

// Utils - Filename
export { validatePlainFilename } from './utils/filename.js';

// Utils - Network (internal helpers, but exported for advanced use)
export { sleep, makeAbortSignal, fetchJson, buildBaseUrl, parseServerUrl } from './utils/network.js';
export type { AbortSignalWithCleanup, FetchJsonResult, FetchJsonOptions } from './utils/network.js';

// Crypto
export {
  sha256Hex,
  generateAesGcmKey,
  exportKeyBase64,
  importKeyFromBase64,
  decryptChunk,
  decryptFilenameFromBase64,
} from './crypto/index.js';
export { encryptToBlob, encryptFilenameToBase64 } from './crypto/encrypt.js';

// Client
export { DropgateClient, estimateTotalUploadSizeBytes, getServerInfo } from './client/DropgateClient.js';

// Adapters
export { getDefaultBase64, getDefaultCrypto, getDefaultFetch } from './adapters/defaults.js';

// P2P - Utility functions still useful for consumers
export {
  generateP2PCode,
  isP2PCodeLike,
  isLocalhostHostname,
  isSecureContextForP2P,
} from './p2p/index.js';

// P2P Types - Consumer-facing types for client methods and sessions
export type {
  // State machine types
  P2PSendState,
  P2PReceiveState,
  // PeerJS types (needed by consumers who provide Peer constructor)
  PeerConstructor,
  PeerInstance,
  PeerInstanceEvents,
  PeerOptions,
  DataConnection,
  DataConnectionEvents,
  // P2P event types
  P2PStatusEvent,
  P2PSendProgressEvent,
  P2PReceiveProgressEvent,
  P2PMetadataEvent,
  P2PReceiveCompleteEvent,
  P2PConnectionHealthEvent,
  P2PResumeInfo,
  P2PCancellationEvent,
  // Client P2P options and sessions
  P2PSendFileOptions,
  P2PReceiveFileOptions,
  P2PSendSession,
  P2PReceiveSession,
} from './p2p/index.js';
