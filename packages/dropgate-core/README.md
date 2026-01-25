<div align="center">
   <img alt="Dropgate Logo" src="./dropgate.png" style="width:100px;height:auto;margin-bottom:1rem;" />

   # @dropgate/core

   <p style="margin-bottom:1rem;">A headless, environment-agnostic TypeScript library for Dropgate file sharing operations.</p>
</div>

<div align="center">

![license](https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square)
![version](https://img.shields.io/badge/version-2.1.0-brightgreen?style=flat-square)
![typescript](https://img.shields.io/badge/TypeScript-5.0+-blue?style=flat-square)

[![discord](https://img.shields.io/discord/667479986214666272?logo=discord&logoColor=white&style=flat-square)](https://diamonddigital.dev/discord)
[![buy me a coffee](https://img.shields.io/badge/-Buy%20Me%20a%20Coffee-ffdd00?logo=Buy%20Me%20A%20Coffee&logoColor=000000&style=flat-square)](https://www.buymeacoffee.com/willtda)

</div>

## 🌍 Overview

**@dropgate/core** is the universal client library for Dropgate. It provides all the core functionality for:

- Uploading files to Dropgate servers (with optional E2EE)
- Downloading files from Dropgate servers
- Direct peer-to-peer file transfers (P2P)
- Server capability detection and version checking
- Utility functions for URL parsing/building, lifetime conversions, and more

This package is **headless** and **environment-agnostic** — it contains no DOM manipulation, no browser-specific APIs, and no Node.js-specific code. All environment-specific concerns (loading PeerJS, handling file streams, etc.) are handled by the consumer.

## 📦 Installation

```bash
npm install @dropgate/core
```

## 🔨 Builds

The package ships with multiple build targets:

| Format | File | Use Case |
| --- | --- | --- |
| ESM | `dist/index.js` | Modern bundlers, Node.js 18+ |
| CJS | `dist/index.cjs` | Legacy Node.js, CommonJS |
| Browser IIFE | `dist/index.browser.js` | `<script>` tag, exposes `DropgateCore` global |

## 🚀 Quick Start

### ⬆️ Uploading a File

```javascript
import { DropgateClient } from '@dropgate/core';

const client = new DropgateClient({ clientVersion: '2.1.0' });

const result = await client.uploadFile({
  host: 'dropgate.link',
  port: 443,
  secure: true,
  file: myFile, // File or Blob
  lifetimeMs: 3600000, // 1 hour
  encrypt: true,
  onProgress: ({ phase, text, percent }) => {
    console.log(`${phase}: ${text} (${percent ? percent : 0}%)`);
  },
});

console.log('Download URL:', result.downloadUrl);
```

### ℹ️ Getting Server Info

```javascript
import { DropgateClient } from '@dropgate/core';

const client = new DropgateClient({ clientVersion: '2.1.0' });

const { serverInfo } = await client.getServerInfo({
  host: 'dropgate.link',
  secure: true,
  timeoutMs: 5000,
});

console.log('Server version:', serverInfo.version);
console.log('Upload enabled:', serverInfo.capabilities?.upload?.enabled);
console.log('P2P enabled:', serverInfo.capabilities?.p2p?.enabled);
```

### 📤 P2P File Transfer (Sender)

```javascript
import { startP2PSend } from '@dropgate/core';

// Consumer must provide PeerJS Peer constructor
const Peer = await loadPeerJS(); // Your loader function

const session = await startP2PSend({
  file: myFile,
  Peer,
  host: 'dropgate.link',
  port: 443,
  secure: true,
  onCode: (code) => console.log('Share this code:', code),
  onProgress: ({ sent, total, percent }) => {
    console.log(`Sending: ${percent.toFixed(1)}%`);
  },
  onComplete: () => console.log('Transfer complete!'),
  onError: (err) => console.error('Error:', err),
});

// To cancel:
// session.stop();
```

### 📥 P2P File Transfer (Receiver)

```javascript
import { startP2PReceive } from '@dropgate/core';

const Peer = await loadPeerJS();

const session = await startP2PReceive({
  code: 'ABCD-1234',
  Peer,
  host: 'dropgate.link',
  port: 443,
  secure: true,
  onMeta: ({ name, total }) => {
    console.log(`Receiving: ${name} (${total} bytes)`);
  },
  onData: async (chunk) => {
    // Consumer handles file writing (e.g., streamSaver, fs.write)
    await writer.write(chunk);
  },
  onProgress: ({ received, total, percent }) => {
    console.log(`Receiving: ${percent.toFixed(1)}%`);
  },
  onComplete: () => console.log('Transfer complete!'),
});
```

### 📥 P2P File Transfer with Preview (Receiver)

Use `autoReady: false` to show a file preview before starting the transfer:

```javascript
import { startP2PReceive } from '@dropgate/core';

const Peer = await loadPeerJS();
let writer;

const session = await startP2PReceive({
  code: 'ABCD-1234',
  Peer,
  host: 'dropgate.link',
  secure: true,
  autoReady: false, // Don't start transfer automatically
  onMeta: ({ name, total, sendReady }) => {
    // Show file preview to user
    console.log(`File: ${name} (${total} bytes)`);
    showPreviewUI(name, total);

    // When user confirms, create writer and start transfer
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

### ⬇️ Downloading a File

```javascript
import { DropgateClient } from '@dropgate/core';

const client = new DropgateClient({ clientVersion: '2.1.0' });

// Download with streaming (for large files)
const result = await client.downloadFile({
  host: 'dropgate.link',
  port: 443,
  secure: true,
  fileId: 'abc123',
  keyB64: 'base64-key-from-url-hash', // Required for encrypted files
  onProgress: ({ phase, percent, receivedBytes, totalBytes }) => {
    console.log(`${phase}: ${percent}% (${receivedBytes}/${totalBytes})`);
  },
  onData: async (chunk) => {
    // Consumer handles file writing (e.g., fs.write, streamSaver)
    await writer.write(chunk);
  },
});

console.log('Downloaded:', result.filename);

// Or download to memory (for small files)
const memoryResult = await client.downloadFile({
  host: 'dropgate.link',
  secure: true,
  fileId: 'abc123',
});

// memoryResult.data contains the complete file as Uint8Array
console.log('File size:', memoryResult.data?.length);
```

## 📚 API Reference

### 🔌 DropgateClient

The main client class for interacting with Dropgate servers.

#### ⚙️ Constructor Options

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `clientVersion` | `string` | Yes | Client version for compatibility checking |
| `chunkSize` | `number` | No | Upload chunk size (default: 5MB) |
| `fetchFn` | `FetchFn` | No | Custom fetch implementation |
| `cryptoObj` | `CryptoAdapter` | No | Custom crypto implementation |
| `base64` | `Base64Adapter` | No | Custom base64 encoder/decoder |
| `logger` | `LoggerFn` | No | Custom logger function |

#### 🛠️ Methods

| Method | Description |
| --- | --- |
| `getServerInfo(opts)` | Fetch server info and capabilities |
| `uploadFile(opts)` | Upload a file with optional encryption |
| `downloadFile(opts)` | Download a file with optional decryption |
| `checkCompatibility(serverInfo)` | Check client/server version compatibility |
| `validateUploadInputs(opts)` | Validate file and settings before upload |
| `resolveShareTarget(value, opts)` | Resolve a sharing code via the server |

### 🔄 P2P Functions

| Function | Description |
| --- | --- |
| `startP2PSend(opts)` | Start a P2P send session |
| `startP2PReceive(opts)` | Start a P2P receive session |
| `generateP2PCode(cryptoObj?)` | Generate a secure sharing code |
| `isP2PCodeLike(code)` | Check if a string looks like a P2P code |
| `isSecureContextForP2P(hostname, isSecureContext)` | Check if P2P is allowed |
| `isLocalhostHostname(hostname)` | Check if hostname is localhost |

### 🧰 Utility Functions

| Function | Description |
| --- | --- |
| `parseServerUrl(urlStr)` | Parse a URL string into host/port/secure |
| `buildBaseUrl(opts)` | Build a URL from host/port/secure |
| `lifetimeToMs(value, unit)` | Convert lifetime to milliseconds |
| `estimateTotalUploadSizeBytes(...)` | Estimate upload size with encryption overhead |
| `bytesToBase64(bytes)` | Convert bytes to base64 |
| `base64ToBytes(b64)` | Convert base64 to bytes |

### ⚠️ Error Classes

| Class | Description |
| --- | --- |
| `DropgateError` | Base error class |
| `DropgateValidationError` | Input validation errors |
| `DropgateNetworkError` | Network/connection errors |
| `DropgateProtocolError` | Server protocol errors |
| `DropgateAbortError` | Operation aborted |
| `DropgateTimeoutError` | Operation timed out |

## 🌐 Browser Usage

For browser environments, you can use the IIFE bundle:

```html
<script src="/path/to/dropgate-core.browser.js"></script>
<script>
  const { DropgateClient, startP2PSend } = DropgateCore;
  // ...
</script>
```

Or as an ES module:

```html
<script type="module">
  import { DropgateClient } from '/path/to/dropgate-core.js';
  // ...
</script>
```

## 📋 P2P Consumer Responsibilities

The P2P functions are designed to be **headless**. The consumer is responsible for:

1. **Loading PeerJS**: Provide the `Peer` constructor to P2P functions
2. **File Writing**: Handle received chunks via `onData` callback (e.g., using streamSaver)
3. **UI Updates**: React to callbacks (`onProgress`, `onStatus`, etc.)

This design allows the library to work in any environment (browser, Electron, Node.js with WebRTC).

## 📜 License

Licensed under the **Apache-2.0 License**.
See the [LICENSE](./LICENSE) file for details.

## 📖 Acknowledgements

* Logo designed by [TheFuturisticIdiot](https://youtube.com/TheFuturisticIdiot)
* Built with [TypeScript](https://www.typescriptlang.org/)
* Inspired by the growing need for privacy-respecting, open file transfer tools

## 🙂 Contact Us

* **Need help or want to chat?** [Join our Discord Server](https://diamonddigital.dev/discord)
* **Found a bug?** [Open an issue](https://github.com/WillTDA/Dropgate/issues)
* **Have a suggestion?** [Submit a feature request](https://github.com/WillTDA/Dropgate/issues/new?labels=enhancement)

<div align="center">
  <a href="https://diamonddigital.dev/">
  <strong>Created and maintained by</strong>
  <img align="center" alt="Diamond Digital Development Logo" src="https://diamonddigital.dev/img/png/ddd_logo_text_transparent.png" style="width:25%;height:auto" /></a>
</div>
