import { DropgateNetworkError } from '../errors.js';
import type { P2PCapabilities } from '../types.js';
import type { PeerInstance, PeerOptions, P2PServerConfig } from './types.js';

/**
 * Resolve P2P server configuration from user options and server capabilities.
 * User-provided values take precedence over server capabilities.
 */
export function resolvePeerConfig(
  userConfig: P2PServerConfig,
  serverCaps?: P2PCapabilities
): { path: string; iceServers: RTCIceServer[] } {
  return {
    path: userConfig.peerjsPath ?? serverCaps?.peerjsPath ?? '/peerjs',
    iceServers: userConfig.iceServers ?? serverCaps?.iceServers ?? [],
  };
}

/**
 * Build PeerJS connection options from P2P server configuration.
 */
export function buildPeerOptions(config: P2PServerConfig = {}): PeerOptions {
  const { host, port, peerjsPath = '/peerjs', secure = false, iceServers = [] } = config;

  const peerOpts: PeerOptions = {
    host,
    path: peerjsPath,
    secure,
    config: { iceServers },
    debug: 0,
  };

  if (port) {
    peerOpts.port = port;
  }

  return peerOpts;
}

export interface CreatePeerWithRetriesOptions {
  code?: string | null;
  codeGenerator: () => string;
  maxAttempts: number;
  buildPeer: (id: string) => PeerInstance;
  onCode?: (code: string, attempt: number) => void;
}

/**
 * Create a peer with retries if the code is already taken
 */
export async function createPeerWithRetries(
  opts: CreatePeerWithRetriesOptions
): Promise<{ peer: PeerInstance; code: string }> {
  const { code, codeGenerator, maxAttempts, buildPeer, onCode } = opts;

  let nextCode = code || codeGenerator();
  let peer: PeerInstance | null = null;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    onCode?.(nextCode, attempt);

    try {
      peer = await new Promise<PeerInstance>((resolve, reject) => {
        const instance = buildPeer(nextCode);
        instance.on('open', () => resolve(instance));
        instance.on('error', (err: Error) => {
          try {
            instance.destroy();
          } catch {
            // Ignore destroy errors
          }
          reject(err);
        });
      });

      return { peer, code: nextCode };
    } catch (err) {
      lastError = err as Error;
      nextCode = codeGenerator();
    }
  }

  throw lastError || new DropgateNetworkError('Could not establish PeerJS connection.');
}
