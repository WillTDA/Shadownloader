// P2P module exports
export { startP2PSend } from './send.js';
export { startP2PReceive } from './receive.js';
export { generateP2PCode, isP2PCodeLike, isLocalhostHostname, isSecureContextForP2P } from './utils.js';
export { buildPeerOptions, createPeerWithRetries, resolvePeerConfig } from './helpers.js';

// Re-export types
export type {
  // PeerJS types
  PeerConstructor,
  PeerInstance,
  PeerInstanceEvents,
  PeerOptions,
  DataConnection,
  DataConnectionEvents,
  // P2P config
  P2PServerConfig,
  // P2P event types
  P2PStatusEvent,
  P2PSendProgressEvent,
  P2PReceiveProgressEvent,
  P2PMetadataEvent,
  P2PReceiveCompleteEvent,
  // P2P options and sessions
  P2PSendOptions,
  P2PSendSession,
  P2PReceiveOptions,
  P2PReceiveSession,
} from './types.js';
