import { DropgateValidationError, DropgateNetworkError } from '../errors.js';
import { sleep } from '../utils/network.js';
import type { P2PSendOptions, P2PSendSession, DataConnection } from './types.js';
import { generateP2PCode } from './utils.js';
import { buildPeerOptions, createPeerWithRetries, resolvePeerConfig } from './helpers.js';

/**
 * Start a direct transfer (P2P) sender session.
 *
 * IMPORTANT: Consumer must provide the PeerJS Peer constructor.
 * This removes DOM coupling (no script injection).
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
    chunkSize = 256 * 1024,
    endAckTimeoutMs = 15000,
    bufferHighWaterMark = 8 * 1024 * 1024,
    bufferLowWaterMark = 2 * 1024 * 1024,
    onCode,
    onStatus,
    onProgress,
    onComplete,
    onError,
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

  let stopped = false;
  let activeConn: DataConnection | null = null;
  let transferActive = false;
  let transferCompleted = false;

  const reportProgress = (data: { received: number; total: number }): void => {
    const safeTotal =
      Number.isFinite(data.total) && data.total > 0 ? data.total : file.size;
    const safeReceived = Math.min(Number(data.received) || 0, safeTotal || 0);
    const percent = safeTotal ? (safeReceived / safeTotal) * 100 : 0;
    onProgress?.({ sent: safeReceived, total: safeTotal, percent });
  };

  const stop = (): void => {
    stopped = true;
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

  peer.on('connection', (conn: DataConnection) => {
    if (stopped) return;

    if (activeConn) {
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

    activeConn = conn;
    onStatus?.({ phase: 'connected', message: 'Connected. Starting transfer...' });

    let readyResolve: (() => void) | null = null;
    let ackResolve: ((data: unknown) => void) | null = null;

    const readyPromise = new Promise<void>((resolve) => {
      readyResolve = resolve;
    });

    const ackPromise = new Promise<unknown>((resolve) => {
      ackResolve = resolve;
    });

    conn.on('data', (data: unknown) => {
      if (
        !data ||
        typeof data !== 'object' ||
        data instanceof ArrayBuffer ||
        ArrayBuffer.isView(data)
      ) {
        return;
      }

      const msg = data as { t?: string; received?: number; total?: number; phase?: string; message?: string };
      if (!msg.t) return;

      if (msg.t === 'ready') {
        readyResolve?.();
        return;
      }

      if (msg.t === 'progress') {
        reportProgress({ received: msg.received || 0, total: msg.total || 0 });
        return;
      }

      if (msg.t === 'ack' && msg.phase === 'end') {
        ackResolve?.(msg);
        return;
      }

      if (msg.t === 'error') {
        onError?.(new DropgateNetworkError(msg.message || 'Receiver reported an error.'));
        stop();
      }
    });

    conn.on('open', async () => {
      try {
        transferActive = true;
        if (stopped) return;

        conn.send({
          t: 'meta',
          name: file.name,
          size: file.size,
          mime: file.type || 'application/octet-stream',
        });

        let sent = 0;
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

        // Send file in chunks
        for (let offset = 0; offset < total; offset += chunkSize) {
          if (stopped) return;

          const slice = file.slice(offset, offset + chunkSize);
          const buf = await slice.arrayBuffer();
          conn.send(buf);
          sent += buf.byteLength;

          // Flow control
          if (dc) {
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
            }
          }
        }

        if (stopped) return;
        conn.send({ t: 'end' });

        // Wait for acknowledgment
        const ackTimeoutMs = Number.isFinite(endAckTimeoutMs)
          ? Math.max(endAckTimeoutMs, Math.ceil(file.size / (1024 * 1024)) * 1000)
          : null;

        const ackResult = await Promise.race([
          ackPromise,
          sleep(ackTimeoutMs || 15000).catch(() => null),
        ]);

        if (!ackResult || typeof ackResult !== 'object') {
          throw new DropgateNetworkError('Receiver did not confirm completion.');
        }

        const ackData = ackResult as { total?: number; received?: number };
        const ackTotal = Number(ackData.total) || file.size;
        const ackReceived = Number(ackData.received) || 0;

        if (ackTotal && ackReceived < ackTotal) {
          throw new DropgateNetworkError('Receiver reported an incomplete transfer.');
        }

        reportProgress({ received: ackReceived || ackTotal, total: ackTotal });
        transferCompleted = true;
        transferActive = false;
        onComplete?.();
        stop();
      } catch (err) {
        onError?.(err as Error);
        stop();
      }
    });

    conn.on('error', (err: Error) => {
      onError?.(err);
      stop();
    });

    conn.on('close', () => {
      if (!transferCompleted && transferActive && !stopped) {
        onError?.(
          new DropgateNetworkError('Receiver disconnected before transfer completed.')
        );
      }
      stop();
    });
  });

  return { peer, code, stop };
}
