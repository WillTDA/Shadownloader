<div align="center">
   <img alt="Dropgate Logo" src="./dropgate.png" style="width:100px;height:auto;margin-bottom:1rem;" />

   # @dropgate/core

   <p style="margin-bottom:1rem;">A headless, environment-agnostic TypeScript library for Dropgate file sharing operations.</p>
</div>

<div align="center">

![license](https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square)
![version](https://img.shields.io/badge/version-3.0.0-brightgreen?style=flat-square)
![typescript](https://img.shields.io/badge/TypeScript-5.0+-blue?style=flat-square)

[![discord](https://img.shields.io/discord/667479986214666272?logo=discord&logoColor=white&style=flat-square)](https://diamonddigital.dev/discord)
[![buy me a coffee](https://img.shields.io/badge/-Buy%20Me%20a%20Coffee-ffdd00?logo=Buy%20Me%20A%20Coffee&logoColor=000000&style=flat-square)](https://www.buymeacoffee.com/willtda)

</div>

## Overview

**@dropgate/core** is the universal client library for Dropgate. It provides all the core functionality for:

- Uploading files to Dropgate servers (with optional E2EE)
- Downloading files from Dropgate servers
- Direct peer-to-peer file transfers (P2P)
- Server capability detection and version checking
- Utility functions for lifetime conversions, base64 encoding, and more

This package is **headless** and **environment-agnostic** — it contains no DOM manipulation, no browser-specific APIs, and no Node.js-specific code. All environment-specific concerns (loading PeerJS, handling file streams, etc.) are handled by the consumer.

## Installation

```bash
npm install @dropgate/core
```

## Builds

The package ships with multiple build targets:

| Format | File | Use Case |
| --- | --- | --- |
| ESM | `dist/index.js` | Modern bundlers, Node.js 18+ |
| CJS | `dist/index.cjs` | Legacy Node.js, CommonJS |
| Browser IIFE | `dist/index.browser.js` | `<script>` tag, exposes `DropgateCore` global |

## Quick Start

### Configure Once, Use Everywhere

All operations go through a single `DropgateClient` instance. Server connection details are specified once in the constructor:

```javascript
import { DropgateClient } from '@dropgate/core';

const client = new DropgateClient({
  clientVersion: '3.0.0',
  server: 'https://dropgate.link', // URL string or { host, port?, secure? }
  fallbackToHttp: true,             // auto-retry HTTP if HTTPS fails (optional)
});
```

### Connecting to the Server

`connect()` fetches server info, checks version compatibility, and caches the result. All methods call `connect()` internally, so explicit calls are optional — useful for "Test Connection" buttons or eager validation.

```javascript
const { serverInfo, compatible, message } = await client.connect({ timeoutMs: 5000 });

console.log('Server version:', serverInfo.version);
console.log('Compatible:', compatible);
console.log('Upload enabled:', serverInfo.capabilities?.upload?.enabled);
console.log('P2P enabled:', serverInfo.capabilities?.p2p?.enabled);
```

### Uploading a File

```javascript
const session = await client.uploadFile({
  file: myFile, // File or Blob (implements FileSource)
  lifetimeMs: 3600000, // 1 hour
  maxDownloads: 5,
  encrypt: true,
  onProgress: ({ phase, text, percent }) => {
    console.log(`${phase}: ${text} (${percent ?? 0}%)`);
  },
});

const result = await session.result;
console.log('Download URL:', result.downloadUrl);

// Cancel an in-progress upload:
// session.cancel('User cancelled');
```

### Downloading a File

```javascript
// Download with streaming (for large files)
const result = await client.downloadFile({
  fileId: 'abc123',
  keyB64: 'base64-key-from-url-hash', // Required for encrypted files
  onProgress: ({ phase, percent, processedBytes, totalBytes }) => {
    console.log(`${phase}: ${percent}% (${processedBytes}/${totalBytes})`);
  },
  onData: async (chunk) => {
    await writer.write(chunk);
  },
});

console.log('Downloaded:', result.filename);

// Or download to memory (for small files — omit onData)
const memoryResult = await client.downloadFile({ fileId: 'abc123' });
console.log('File size:', memoryResult.data?.length);
```

### P2P File Transfer (Sender)

```javascript
const Peer = await loadPeerJS(); // Your loader function

const session = await client.p2pSend({
  file: myFile,
  Peer,
  onCode: (code) => console.log('Share this code:', code),
  onProgress: ({ processedBytes, totalBytes, percent }) => {
    console.log(`Sending: ${percent.toFixed(1)}%`);
  },
  onComplete: () => console.log('Transfer complete!'),
  onError: (err) => console.error('Error:', err),
  onCancel: ({ cancelledBy }) => console.log(`Cancelled by ${cancelledBy}`),
  onDisconnect: () => console.log('Receiver disconnected'),
});

// Session control
console.log('Status:', session.getStatus());
console.log('Bytes sent:', session.getBytesSent());
session.stop(); // Cancel
```

### P2P File Transfer (Receiver)

```javascript
const Peer = await loadPeerJS();

const session = await client.p2pReceive({
  code: 'ABCD-1234',
  Peer,
  onMeta: ({ name, total }) => {
    console.log(`Receiving: ${name} (${total} bytes)`);
  },
  onData: async (chunk) => {
    await writer.write(chunk);
  },
  onProgress: ({ processedBytes, totalBytes, percent }) => {
    console.log(`Receiving: ${percent.toFixed(1)}%`);
  },
  onComplete: ({ received, total }) => console.log(`Complete! ${received}/${total}`),
  onCancel: ({ cancelledBy }) => console.log(`Cancelled by ${cancelledBy}`),
  onError: (err) => console.error('Error:', err),
  onDisconnect: () => console.log('Sender disconnected'),
});

session.stop(); // Cancel
```

### P2P with File Preview (Receiver)

Use `autoReady: false` to show a file preview before starting the transfer:

```javascript
const session = await client.p2pReceive({
  code: 'ABCD-1234',
  Peer,
  autoReady: false,
  onMeta: ({ name, total, sendReady }) => {
    console.log(`File: ${name} (${total} bytes)`);
    showPreviewUI(name, total);

    confirmButton.onclick = () => {
      writer = createWriteStream(name);
      sendReady(); // Signal sender to begin transfer
    };
  },
  onData: async (chunk) => {
    await writer.write(chunk);
  },
  onComplete: () => {
    writer.close();
    console.log('Transfer complete!');
  },
});
```

### Standalone Server Info

For one-off checks before constructing a client:

```javascript
import { getServerInfo } from '@dropgate/core';

const { serverInfo } = await getServerInfo({
  server: 'https://dropgate.link',
  timeoutMs: 5000,
});

console.log('Server version:', serverInfo.version);
```

## API Reference

### DropgateClient

The main client class for interacting with Dropgate servers.

#### Constructor Options

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `clientVersion` | `string` | Yes | Client version for compatibility checking |
| `server` | `string \| ServerTarget` | Yes | Server URL or `{ host, port?, secure? }` |
| `fallbackToHttp` | `boolean` | No | Auto-retry with HTTP if HTTPS fails in `connect()` |
| `chunkSize` | `number` | No | Upload chunk size fallback (default: 5MB). The server's configured chunk size (from `/api/info`) takes precedence when available. |
| `fetchFn` | `FetchFn` | No | Custom fetch implementation |
| `cryptoObj` | `CryptoAdapter` | No | Custom crypto implementation |
| `base64` | `Base64Adapter` | No | Custom base64 encoder/decoder |

#### Properties

| Property | Type | Description |
| --- | --- | --- |
| `baseUrl` | `string` | Resolved server base URL (may change if HTTP fallback occurs) |
| `serverTarget` | `ServerTarget` | Derived `{ host, port, secure }` from `baseUrl` |

#### Methods

| Method | Description |
| --- | --- |
| `connect(opts?)` | Fetch server info, check compatibility, cache result |
| `uploadFile(opts)` | Upload a file with optional encryption |
| `downloadFile(opts)` | Download a file with optional decryption |
| `p2pSend(opts)` | Start a P2P send session |
| `p2pReceive(opts)` | Start a P2P receive session |
| `validateUploadInputs(opts)` | Validate file and settings before upload |
| `resolveShareTarget(value, opts?)` | Resolve a sharing code via the server |

### P2P Utility Functions

| Function | Description |
| --- | --- |
| `generateP2PCode(cryptoObj?)` | Generate a secure sharing code |
| `isP2PCodeLike(code)` | Check if a string looks like a P2P code |
| `isSecureContextForP2P(hostname, isSecureContext)` | Check if P2P is allowed |
| `isLocalhostHostname(hostname)` | Check if hostname is localhost |

### Utility Functions

| Function | Description |
| --- | --- |
| `getServerInfo(opts)` | Fetch server info and capabilities (standalone) |
| `lifetimeToMs(value, unit)` | Convert lifetime to milliseconds |
| `estimateTotalUploadSizeBytes(...)` | Estimate upload size with encryption overhead |
| `bytesToBase64(bytes)` | Convert bytes to base64 |
| `base64ToBytes(b64)` | Convert base64 to bytes |

### Error Classes

| Class | Description |
| --- | --- |
| `DropgateError` | Base error class |
| `DropgateValidationError` | Input validation errors |
| `DropgateNetworkError` | Network/connection errors |
| `DropgateProtocolError` | Server protocol errors |
| `DropgateAbortError` | Operation aborted |
| `DropgateTimeoutError` | Operation timed out |

## Browser Usage

For browser environments, you can use the IIFE bundle:

```html
<script src="/path/to/dropgate-core.browser.js"></script>
<script>
  const { DropgateClient } = DropgateCore;
  const client = new DropgateClient({ clientVersion: '3.0.0', server: location.origin });
  // ...
</script>
```

Or as an ES module:

```html
<script type="module">
  import { DropgateClient } from '/path/to/dropgate-core.js';
  const client = new DropgateClient({ clientVersion: '3.0.0', server: location.origin });
  // ...
</script>
```

## P2P Consumer Responsibilities

The P2P methods are **headless**. The consumer is responsible for:

1. **Loading PeerJS**: Provide the `Peer` constructor to `p2pSend`/`p2pReceive`
2. **File Writing**: Handle received chunks via `onData` callback (e.g., using streamSaver)
3. **UI Updates**: React to callbacks (`onProgress`, `onStatus`, etc.)

This design allows the library to work in any environment (browser, Electron, Node.js with WebRTC).

### Large File Support

The P2P implementation is designed for **unlimited file sizes** with constant memory usage:

- **Stream-through architecture**: Chunks flow immediately to `onData`, no buffering
- **Flow control**: Sender pauses when receiver's write queue backs up
- **WebRTC reliability**: SCTP provides reliable, ordered, checksum-verified delivery

> **Note**: For large files, always use the `onData` callback approach rather than buffering in memory.

## License

Licensed under the **Apache-2.0 License**.
See the [LICENSE](./LICENSE) file for details.

## Acknowledgements

* Logo designed by [TheFuturisticIdiot](https://youtube.com/TheFuturisticIdiot)
* Built with [TypeScript](https://www.typescriptlang.org/)
* Inspired by the growing need for privacy-respecting, open file transfer tools

## Contact Us

* **Need help or want to chat?** [Join our Discord Server](https://diamonddigital.dev/discord)
* **Found a bug?** [Open an issue](https://github.com/WillTDA/Dropgate/issues)
* **Have a suggestion?** [Submit a feature request](https://github.com/WillTDA/Dropgate/issues/new?labels=enhancement)

<div align="center">
  <a href="https://diamonddigital.dev/">
  <strong>Created and maintained by</strong>
  <img align="center" alt="Diamond Digital Development Logo" src="https://diamonddigital.dev/img/png/ddd_logo_text_transparent.png" style="width:25%;height:auto" /></a>
</div>
