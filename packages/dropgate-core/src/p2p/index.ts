// P2P module exports - internal functions (used by DropgateClient)
export { startP2PSend } from './send.js';
export { startP2PReceive } from './receive.js';
export { generateP2PCode, isP2PCodeLike, isLocalhostHostname, isSecureContextForP2P } from './utils.js';
export { buildPeerOptions, createPeerWithRetries, resolvePeerConfig } from './helpers.js';

// Protocol exports
export {
  P2P_PROTOCOL_VERSION,
  P2P_CHUNK_SIZE,
  P2P_MAX_UNACKED_CHUNKS,
  P2P_END_ACK_TIMEOUT_MS,
  P2P_END_ACK_RETRIES,
  isP2PMessage,
  isProtocolCompatible,
} from './protocol.js';

export type {
  P2PMessageType,
  P2PMessage,
  P2PMessageBase,
  P2PHelloMessage,
  P2PMetaMessage,
  P2PReadyMessage,
  P2PChunkMessage,
  P2PChunkAckMessage,
  P2PEndMessage,
  P2PEndAckMessage,
  P2PPingMessage,
  P2PPongMessage,
  P2PErrorMessage,
  P2PCancelledMessage,
  P2PResumeMessage,
  P2PResumeAckMessage,
} from './protocol.js';

// Re-export types
export type {
  // State machine types
  P2PSendState,
  P2PReceiveState,
  // PeerJS types
  PeerConstructor,
  PeerInstance,
  PeerInstanceEvents,
  PeerOptions,
  DataConnection,
  DataConnectionEvents,
  // P2P config (internal)
  P2PServerConfig,
  // P2P event types
  P2PStatusEvent,
  P2PSendProgressEvent,
  P2PReceiveProgressEvent,
  P2PMetadataEvent,
  P2PReceiveCompleteEvent,
  P2PConnectionHealthEvent,
  P2PResumeInfo,
  P2PCancellationEvent,
  // Internal P2P options (used by startP2PSend/startP2PReceive)
  P2PSendOptions,
  P2PReceiveOptions,
  // Sessions
  P2PSendSession,
  P2PReceiveSession,
  // Client P2P options (used by DropgateClient.p2pSend/p2pReceive)
  P2PSendFileOptions,
  P2PReceiveFileOptions,
} from './types.js';
