import { DropgateValidationError, DropgateNetworkError } from '../errors.js';
import { sleep } from '../utils/network.js';
import type {
  P2PSendOptions,
  P2PSendSession,
  P2PSendState,
  DataConnection,
  P2PConnectionHealthEvent,
} from './types.js';
import { generateP2PCode } from './utils.js';
import { buildPeerOptions, createPeerWithRetries, resolvePeerConfig } from './helpers.js';
import {
  P2P_PROTOCOL_VERSION,
  P2P_CHUNK_SIZE,
  P2P_MAX_UNACKED_CHUNKS,
  P2P_END_ACK_TIMEOUT_MS,
  P2P_END_ACK_RETRIES,
  P2P_CLOSE_GRACE_PERIOD_MS,
  isP2PMessage,
  type P2PChunkAckMessage,
  type P2PEndAckMessage,
} from './protocol.js';

/**
 * Generate a unique session ID for transfer tracking.
 * Uses crypto.randomUUID if available, falls back to timestamp + random.
 */
function generateSessionId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Allowed state transitions to prevent invalid state changes.
 * This enforces a strict state machine where transitions only happen
 * in the expected order, preventing race conditions.
 */
const ALLOWED_TRANSITIONS: Record<P2PSendState, P2PSendState[]> = {
  initializing: ['listening', 'closed'],
  listening: ['handshaking', 'closed', 'cancelled'],
  handshaking: ['negotiating', 'closed', 'cancelled'],
  negotiating: ['transferring', 'closed', 'cancelled'],
  transferring: ['finishing', 'closed', 'cancelled'],
  finishing: ['awaiting_ack', 'closed', 'cancelled'],
  awaiting_ack: ['completed', 'closed', 'cancelled'],
  completed: ['closed'],
  cancelled: ['closed'],
  closed: [],
};

/**
 * Start a direct transfer (P2P) sender session.
 *
 * IMPORTANT: Consumer must provide the PeerJS Peer constructor.
 * This removes DOM coupling (no script injection).
 *
 * Protocol v2 features:
 * - Explicit version handshake
 * - Chunk-level acknowledgments for flow control
 * - Multiple end-ack retries for reliability
 * - Stream-through design for unlimited file sizes
 *
 * Example:
 * ```js
 * import Peer from 'peerjs';
 * import { startP2PSend } from '@dropgate/core/p2p';
 *
 * const session = await startP2PSend({
 *   file: myFile,
 *   Peer,
 *   host: 'dropgate.link',
 *   secure: true,
 *   onCode: (code) => console.log('Share this code:', code),
 *   onProgress: (evt) => console.log(`${evt.percent}% sent`),
 *   onComplete: () => console.log('Done!'),
 * });
 * ```
 */
export async function startP2PSend(opts: P2PSendOptions): Promise<P2PSendSession> {
  const {
    file,
    Peer,
    serverInfo,
    host,
    port,
    peerjsPath,
    secure = false,
    iceServers,
    codeGenerator,
    cryptoObj,
    maxAttempts = 4,
    chunkSize = P2P_CHUNK_SIZE,
    endAckTimeoutMs = P2P_END_ACK_TIMEOUT_MS,
    bufferHighWaterMark = 8 * 1024 * 1024,
    bufferLowWaterMark = 2 * 1024 * 1024,
    heartbeatIntervalMs = 5000,
    chunkAcknowledgments = true,
    maxUnackedChunks = P2P_MAX_UNACKED_CHUNKS,
    onCode,
    onStatus,
    onProgress,
    onComplete,
    onError,
    onDisconnect,
    onCancel,
    onConnectionHealth,
  } = opts;

  // Validate required options
  if (!file) {
    throw new DropgateValidationError('File is missing.');
  }

  if (!Peer) {
    throw new DropgateValidationError(
      'PeerJS Peer constructor is required. Install peerjs and pass it as the Peer option.'
    );
  }

  // Check P2P capabilities if serverInfo is provided
  const p2pCaps = serverInfo?.capabilities?.p2p;
  if (serverInfo && !p2pCaps?.enabled) {
    throw new DropgateValidationError('Direct transfer is disabled on this server.');
  }

  // Resolve config from user options and server capabilities
  const { path: finalPath, iceServers: finalIceServers } = resolvePeerConfig(
    { peerjsPath, iceServers },
    p2pCaps
  );

  // Build peer options
  const peerOpts = buildPeerOptions({
    host,
    port,
    peerjsPath: finalPath,
    secure,
    iceServers: finalIceServers,
  });

  // Create the code generator
  const finalCodeGenerator = codeGenerator || (() => generateP2PCode(cryptoObj));

  // Create peer with retries
  const buildPeer = (id: string) => new Peer(id, peerOpts);
  const { peer, code } = await createPeerWithRetries({
    code: null,
    codeGenerator: finalCodeGenerator,
    maxAttempts,
    buildPeer,
    onCode,
  });

  // Generate unique session ID for this transfer
  const sessionId = generateSessionId();

  // State machine - replaces boolean flags to prevent race conditions
  let state: P2PSendState = 'listening';
  let activeConn: DataConnection | null = null;
  let sentBytes = 0;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  let lastActivityTime = Date.now();

  // Chunk acknowledgment tracking
  const unackedChunks = new Map<number, { offset: number; size: number; sentAt: number }>();
  let nextSeq = 0;
  let ackResolvers: Array<() => void> = [];

  /**
   * Attempt a state transition. Returns true if transition was valid.
   * Logs a warning for invalid transitions but doesn't throw.
   */
  const transitionTo = (newState: P2PSendState): boolean => {
    if (!ALLOWED_TRANSITIONS[state].includes(newState)) {
      console.warn(`[P2P Send] Invalid state transition: ${state} -> ${newState}`);
      return false;
    }
    state = newState;
    return true;
  };

  const reportProgress = (data: { received: number; total: number }): void => {
    const safeTotal =
      Number.isFinite(data.total) && data.total > 0 ? data.total : file.size;
    const safeReceived = Math.min(Number(data.received) || 0, safeTotal || 0);
    const percent = safeTotal ? (safeReceived / safeTotal) * 100 : 0;
    onProgress?.({ processedBytes: safeReceived, totalBytes: safeTotal, percent });
  };

  // Safe error handler - prevents calling onError after completion or cancellation
  const safeError = (err: Error): void => {
    if (state === 'closed' || state === 'completed' || state === 'cancelled') return;
    transitionTo('closed');
    onError?.(err);
    cleanup();
  };

  // Safe complete handler - only fires from awaiting_ack state
  const safeComplete = (): void => {
    if (state !== 'awaiting_ack' && state !== 'finishing') return;
    transitionTo('completed');
    onComplete?.();
    cleanup();
  };

  // Cleanup all resources
  const cleanup = (): void => {
    // Clear heartbeat timer
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }

    // Clear health check timer
    if (healthCheckTimer) {
      clearInterval(healthCheckTimer);
      healthCheckTimer = null;
    }

    // Clear any pending ack resolvers
    ackResolvers.forEach((resolve) => resolve());
    ackResolvers = [];
    unackedChunks.clear();

    // Remove beforeunload listener if in browser
    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', handleUnload);
    }

    try {
      activeConn?.close();
    } catch {
      // Ignore close errors
    }
    try {
      peer.destroy();
    } catch {
      // Ignore destroy errors
    }
  };

  // Handle browser tab close/refresh
  const handleUnload = (): void => {
    try {
      activeConn?.send({ t: 'error', message: 'Sender closed the connection.' });
    } catch {
      // Best effort
    }
    stop();
  };

  // Add beforeunload listener if in browser
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', handleUnload);
  }

  const stop = (): void => {
    if (state === 'closed' || state === 'cancelled') return;

    const wasActive = state === 'transferring' || state === 'finishing' || state === 'awaiting_ack';
    transitionTo('cancelled');

    // Notify peer before cleanup
    try {
      // @ts-expect-error - open property may exist on PeerJS connections
      if (activeConn && activeConn.open) {
        activeConn.send({ t: 'cancelled', message: 'Sender cancelled the transfer.' });
      }
    } catch {
      // Best effort
    }

    if (wasActive && onCancel) {
      onCancel({ cancelledBy: 'sender' });
    }

    cleanup();
  };

  // Helper to check if session is stopped - bypasses TypeScript narrowing
  // which doesn't understand state can change asynchronously
  const isStopped = (): boolean => state === 'closed' || state === 'cancelled';

  // Connection health monitoring
  const startHealthMonitoring = (conn: DataConnection): void => {
    if (!onConnectionHealth) return;

    healthCheckTimer = setInterval(() => {
      const dc = conn._dc;
      if (!dc) return;

      // Note: iceConnectionState is on RTCPeerConnection, not RTCDataChannel
      // We can only report bufferedAmount and readyState from the data channel
      const health: P2PConnectionHealthEvent = {
        iceConnectionState: (dc.readyState === 'open' ? 'connected' : 'disconnected') as P2PConnectionHealthEvent['iceConnectionState'],
        bufferedAmount: dc.bufferedAmount,
        lastActivityMs: Date.now() - lastActivityTime,
      };

      onConnectionHealth(health);
    }, 2000);
  };

  // Handle chunk acknowledgment
  const handleChunkAck = (msg: P2PChunkAckMessage): void => {
    lastActivityTime = Date.now();
    unackedChunks.delete(msg.seq);
    reportProgress({ received: msg.received, total: file.size });

    // Resolve any pending waitForAck promises
    const resolver = ackResolvers.shift();
    if (resolver) resolver();
  };

  // Wait for chunk acknowledgment when too many unacked
  const waitForAck = (): Promise<void> => {
    return new Promise((resolve) => {
      ackResolvers.push(resolve);
    });
  };

  // Send chunk with sequence tracking
  const sendChunk = async (conn: DataConnection, data: ArrayBuffer, offset: number): Promise<void> => {
    // Wait if too many unacknowledged chunks (flow control)
    if (chunkAcknowledgments) {
      while (unackedChunks.size >= maxUnackedChunks) {
        await Promise.race([
          waitForAck(),
          sleep(1000), // Timeout to prevent deadlock
        ]);
        if (isStopped()) return;
      }
    }

    const seq = nextSeq++;
    if (chunkAcknowledgments) {
      unackedChunks.set(seq, { offset, size: data.byteLength, sentAt: Date.now() });
    }

    // Send chunk header then binary data
    conn.send({ t: 'chunk', seq, offset, size: data.byteLength, total: file.size });
    conn.send(data);
    sentBytes += data.byteLength;

    // Legacy flow control using buffer thresholds
    const dc = conn._dc;
    if (dc && bufferHighWaterMark > 0) {
      while (dc.bufferedAmount > bufferHighWaterMark) {
        await new Promise<void>((resolve) => {
          const fallback = setTimeout(resolve, 60);
          try {
            dc.addEventListener(
              'bufferedamountlow',
              () => {
                clearTimeout(fallback);
                resolve();
              },
              { once: true }
            );
          } catch {
            // Fallback only
          }
        });
        if (isStopped()) return;
      }
    }
  };

  // Robust end-ack with retries
  const waitForEndAck = async (
    conn: DataConnection,
    ackPromise: Promise<P2PEndAckMessage>
  ): Promise<P2PEndAckMessage> => {
    const baseTimeout = endAckTimeoutMs;

    for (let attempt = 0; attempt < P2P_END_ACK_RETRIES; attempt++) {
      conn.send({ t: 'end', attempt });

      const timeout = baseTimeout * Math.pow(1.5, attempt);
      const result = await Promise.race([
        ackPromise,
        sleep(timeout).then(() => null as P2PEndAckMessage | null),
      ]);

      if (result && result.t === 'end_ack') {
        return result;
      }

      // Check if connection is still alive
      if (isStopped()) {
        throw new DropgateNetworkError('Connection closed during completion.');
      }
    }

    throw new DropgateNetworkError('Receiver did not confirm completion after retries.');
  };

  peer.on('connection', (conn: DataConnection) => {
    if (state === 'closed') return;

    // Connection replacement logic - allow new connections if old one is dead
    if (activeConn) {
      // Check if existing connection is actually still open
      // @ts-expect-error - open property may exist on PeerJS connections
      const isOldConnOpen = activeConn.open !== false;

      if (isOldConnOpen && state === 'transferring') {
        // Actively transferring, reject new connection
        try {
          conn.send({ t: 'error', message: 'Transfer already in progress.' });
        } catch {
          // Ignore send errors
        }
        try {
          conn.close();
        } catch {
          // Ignore close errors
        }
        return;
      } else if (!isOldConnOpen) {
        // Old connection is dead, clean it up and accept new one
        try {
          activeConn.close();
        } catch {
          // Ignore
        }
        activeConn = null;
        // Reset state to allow new transfer
        state = 'listening';
        sentBytes = 0;
        nextSeq = 0;
        unackedChunks.clear();
      } else {
        // Connection exists but not transferring (maybe in negotiating state)
        // Reject to avoid confusion
        try {
          conn.send({ t: 'error', message: 'Another receiver is already connected.' });
        } catch {
          // Ignore send errors
        }
        try {
          conn.close();
        } catch {
          // Ignore close errors
        }
        return;
      }
    }

    activeConn = conn;
    transitionTo('handshaking');
    onStatus?.({ phase: 'connected', message: 'Receiver connected. Exchanging protocol version...' });
    lastActivityTime = Date.now();

    let helloResolve: ((version: number) => void) | null = null;
    let readyResolve: (() => void) | null = null;
    let endAckResolve: ((msg: P2PEndAckMessage) => void) | null = null;

    const helloPromise = new Promise<number>((resolve) => {
      helloResolve = resolve;
    });

    const readyPromise = new Promise<void>((resolve) => {
      readyResolve = resolve;
    });

    const endAckPromise = new Promise<P2PEndAckMessage>((resolve) => {
      endAckResolve = resolve;
    });

    conn.on('data', (data: unknown) => {
      lastActivityTime = Date.now();

      // Handle binary data (we don't expect binary from receiver)
      if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
        return;
      }

      if (!isP2PMessage(data)) return;

      const msg = data;

      switch (msg.t) {
        case 'hello':
          helloResolve?.(msg.protocolVersion);
          break;

        case 'ready':
          onStatus?.({ phase: 'transferring', message: 'Receiver accepted. Starting transfer...' });
          readyResolve?.();
          break;

        case 'chunk_ack':
          handleChunkAck(msg as P2PChunkAckMessage);
          break;

        case 'end_ack':
          endAckResolve?.(msg as P2PEndAckMessage);
          break;

        case 'pong':
          // Heartbeat response received, connection is alive
          break;

        case 'progress':
          // v1 compatibility: receiver sends progress updates
          reportProgress({ received: msg.received || 0, total: msg.total || 0 });
          break;

        case 'error':
          safeError(new DropgateNetworkError(msg.message || 'Receiver reported an error.'));
          break;

        case 'cancelled':
          if (state === 'cancelled' || state === 'closed' || state === 'completed') return;
          transitionTo('cancelled');
          onCancel?.({ cancelledBy: 'receiver', message: msg.reason });
          cleanup();
          break;
      }
    });

    conn.on('open', async () => {
      try {
        if (isStopped()) return;

        // Start health monitoring
        startHealthMonitoring(conn);

        // Protocol v2: Send hello first
        conn.send({
          t: 'hello',
          protocolVersion: P2P_PROTOCOL_VERSION,
          sessionId,
        });

        // Wait for receiver's hello (with timeout)
        const receiverVersion = await Promise.race([
          helloPromise,
          sleep(10000).then(() => null as number | null),
        ]);

        if (isStopped()) return;

        if (receiverVersion === null) {
          // Receiver didn't respond with hello - might be v1 client
          // Fall back to v1 behaviour (skip handshake)
          console.warn('[P2P Send] Receiver did not send hello, assuming v1 protocol');
        } else if (receiverVersion !== P2P_PROTOCOL_VERSION) {
          throw new DropgateNetworkError(
            `Protocol version mismatch: sender v${P2P_PROTOCOL_VERSION}, receiver v${receiverVersion}`
          );
        }

        transitionTo('negotiating');
        onStatus?.({ phase: 'waiting', message: 'Connected. Waiting for receiver to accept...' });

        // Send metadata with sessionId
        conn.send({
          t: 'meta',
          sessionId,
          name: file.name,
          size: file.size,
          mime: file.type || 'application/octet-stream',
        });

        const total = file.size;
        const dc = conn._dc;

        if (dc && Number.isFinite(bufferLowWaterMark)) {
          try {
            dc.bufferedAmountLowThreshold = bufferLowWaterMark;
          } catch {
            // Ignore threshold setting errors
          }
        }

        // Wait for ready signal
        await readyPromise;
        if (isStopped()) return;

        // Start heartbeat for long transfers
        if (heartbeatIntervalMs > 0) {
          heartbeatTimer = setInterval(() => {
            if (state === 'transferring' || state === 'finishing' || state === 'awaiting_ack') {
              try {
                conn.send({ t: 'ping', timestamp: Date.now() });
              } catch {
                // Ignore ping errors
              }
            }
          }, heartbeatIntervalMs);
        }

        transitionTo('transferring');

        // Send file in chunks
        for (let offset = 0; offset < total; offset += chunkSize) {
          if (isStopped()) return;

          const slice = file.slice(offset, offset + chunkSize);
          const buf = await slice.arrayBuffer();
          if (isStopped()) return;

          await sendChunk(conn, buf, offset);
        }

        if (isStopped()) return;

        transitionTo('finishing');
        transitionTo('awaiting_ack');

        // Wait for end acknowledgment with retries
        const ackResult = await waitForEndAck(conn, endAckPromise);

        if (isStopped()) return;

        const ackTotal = Number(ackResult.total) || file.size;
        const ackReceived = Number(ackResult.received) || 0;

        if (ackTotal && ackReceived < ackTotal) {
          throw new DropgateNetworkError('Receiver reported an incomplete transfer.');
        }

        reportProgress({ received: ackReceived || ackTotal, total: ackTotal });
        safeComplete();
      } catch (err) {
        safeError(err as Error);
      }
    });

    conn.on('error', (err: Error) => {
      safeError(err);
    });

    conn.on('close', () => {
      if (state === 'closed' || state === 'completed' || state === 'cancelled') {
        // Clean shutdown or already cancelled, ensure full cleanup
        cleanup();
        return;
      }

      // Special handling for awaiting_ack state - give grace period
      if (state === 'awaiting_ack') {
        // Connection closed while waiting for end_ack
        // Give a grace period for the ack to have been processed
        setTimeout(() => {
          if (state === 'awaiting_ack') {
            // Still waiting, treat as failure
            safeError(new DropgateNetworkError('Connection closed while awaiting confirmation.'));
          }
        }, P2P_CLOSE_GRACE_PERIOD_MS);
        return;
      }

      if (state === 'transferring' || state === 'finishing') {
        // Connection closed during active transfer — the receiver either cancelled
        // or disconnected. Treat as a receiver-initiated cancellation so the UI
        // can reset cleanly instead of showing a raw error.
        transitionTo('cancelled');
        onCancel?.({ cancelledBy: 'receiver' });
        cleanup();
      } else {
        // Disconnected before transfer started (during waiting/negotiating phase)
        // Reset state to allow reconnection
        activeConn = null;
        state = 'listening';
        sentBytes = 0;
        nextSeq = 0;
        unackedChunks.clear();
        onDisconnect?.();
      }
    });
  });

  return {
    peer,
    code,
    sessionId,
    stop,
    getStatus: () => state,
    getBytesSent: () => sentBytes,
    getConnectedPeerId: () => {
      if (!activeConn) return null;
      // @ts-expect-error - peer property exists on PeerJS DataConnection
      return activeConn.peer || null;
    },
  };
}
