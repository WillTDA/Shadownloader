<div align="center">
   <img alt="Dropgate Logo" src="./public/assets/icon.png" style="width:100px;height:auto;margin-bottom:1rem;" />

   # Dropgate Server

   <p style="margin-bottom:1rem;">A Node.js-based backend for secure, privacy-focused file sharing with optional end-to-end encryption support.</p>
</div>

<div align="center">

![license](https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat-square)
![version](https://img.shields.io/badge/version-3.0.0-brightgreen?style=flat-square)
![docker](https://img.shields.io/badge/docker-supported-blue?style=flat-square)

[![discord](https://img.shields.io/discord/667479986214666272?logo=discord&logoColor=white&style=flat-square)](https://diamonddigital.dev/discord)
[![buy me a coffee](https://img.shields.io/badge/-Buy%20Me%20a%20Coffee-ffdd00?logo=Buy%20Me%20A%20Coffee&logoColor=000000&style=flat-square)](https://www.buymeacoffee.com/willtda)

</div>

## 🌐 Public Demo

See **Dropgate** in action here: **[dropgate.link](https://dropgate.link)**

To prevent and monitor for abuse, `DEBUG`-level logging and strict rate limits are enforced.

## 🌍 Overview

The **Dropgate Server** powers the backend of the system.
It can be self-hosted easily on:
- Home servers / NAS boxes
- VPS instances
- Docker containers
- Tunnelled/reverse-proxied setups (Cloudflare Tunnel, Tailscale, etc.)

Dropgate supports **two ways to share files**:

- **Hosted uploads (classic mode)** — you upload a file, share a link, and the server holds it temporarily.
- **Direct transfer (P2P)** — when enabled, files can transfer device-to-device, with the server only helping peers connect.

When running with **E2EE**, the server acts as a **blind data relay** — the contents are unreadable without the client-side decryption key.


## 🧩 Defaults (important!)

Out of the box, the server is conservative:
- ✅ Web UI is enabled
- ✅ Direct Transfer (P2P) is enabled
- ❌ Hosted uploads are disabled (you must opt in)

This means you can spin it up, try the Web UI, and choose what features you want to allow.


## 🚀 Quick Start (Manual)

```bash
git clone https://github.com/WillTDA/Dropgate.git
cd Dropgate/server
npm install
npm start
```

Enable hosted uploads:

```bash
ENABLE_UPLOAD=true npm start
```

(Windows PowerShell)

```powershell
$env:ENABLE_UPLOAD="true"
npm start
```


## 🐳 Running with Docker

```bash
docker run -d \
  -p 52443:52443 \
  -e ENABLE_UPLOAD=true \
  -e UPLOAD_ENABLE_E2EE=true \
  -e UPLOAD_PRESERVE_UPLOADS=true \
  -e UPLOAD_MAX_FILE_SIZE_MB=1000 \
  -v /path/to/uploads:/usr/src/app/uploads \
  --name dropgate \
  willtda/dropgate-server:latest
```

If you want uploads to persist across restarts, map `/usr/src/app/uploads` to a path on the host machine and set `UPLOAD_PRESERVE_UPLOADS=true`.


## ⚙️ Environment Variables

### General

| Variable | Default | Description |
| --- | --- | --- |
| `SERVER_PORT` | `52443` | Port to run the server on. |
| `SERVER_NAME` | `Dropgate Server` | Display name used by the Web UI and `GET /api/info`. |
| `ENABLE_WEB_UI` | `true` | Enables the Web UI at `/`. |
| `LOG_LEVEL` | `INFO` | `NONE`, `ERROR`, `WARN`, `INFO`, `DEBUG`. |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window in milliseconds (`0` disables rate limiting). |
| `RATE_LIMIT_MAX_REQUESTS` | `25` | Requests allowed per window (`0` disables rate limiting). |

### Hosted Uploads (classic mode)

| Variable | Default | Description |
| --- | --- | --- |
| `ENABLE_UPLOAD` | `false` | Enables the hosted upload protocol and routes. |
| `UPLOAD_ENABLE_E2EE` | `true` | Enables end-to-end encryption for hosted uploads (keys stay client-side). |
| `UPLOAD_PRESERVE_UPLOADS` | `false` | Persist uploads across restarts (uses `uploads/db/`). |
| `UPLOAD_MAX_FILE_SIZE_MB` | `100` | Max file size in MB (`0` = unlimited). |
| `UPLOAD_MAX_STORAGE_GB` | `10` | Max total storage in GB (`0` = unlimited). |
| `UPLOAD_MAX_FILE_LIFETIME_HOURS` | `24` | Max file lifetime in hours (`0` = unlimited). |
| `UPLOAD_MAX_FILE_DOWNLOADS` | `1` | Max downloads before file is deleted (`0` = unlimited). |
| `UPLOAD_CHUNK_SIZE_BYTES` | `5242880` | Upload chunk size in bytes (default 5MB). Minimum `65536` (64KB). Smaller values increase per-chunk overhead; larger values may need proxy body-size adjustments. |
| `UPLOAD_ZOMBIE_CLEANUP_INTERVAL_MS` | `300000` | Cleanup interval for incomplete uploads (`0` = disabled). |

### Direct Transfer (P2P)

| Variable | Default | Description |
| --- | --- | --- |
| `ENABLE_P2P` | `true` | Enables direct transfer (P2P). |
| `P2P_STUN_SERVERS` | `stun:stun.cloudflare.com:3478` | Comma/space separated STUN servers for WebRTC. |
| `PEERJS_DEBUG` | `false` | Enables verbose PeerJS logs. |


## 🧾 Server Info Endpoint

You can sanity-check your server and see what it supports via:

- `GET /api/info`

Example response:

```json
{
  "name": "Dropgate Server",
  "version": "3.0.0",
  "logLevel": "INFO",
  "capabilities": {
    "upload": {
      "enabled": true,
      "maxSizeMB": 100,
      "maxLifetimeHours": 24,
      "maxFileDownloads": 1,
      "e2ee": true,
      "chunkSize": 5242880
    },
    "p2p": {
      "enabled": true,
      "peerjsPath": "/peerjs",
      "iceServers": [
        {
          "urls": [
            "stun:stun.cloudflare.com:3478"
          ]
        }
      ],
      "peerjsDebugLogging": false
    },
    "webUI": {
      "enabled": true
    }
  }
}
```


## 🔒 HTTPS / Reverse Proxy Setup

For **E2EE** and **Direct Transfer (P2P)** in browsers, you generally want HTTPS (localhost is the common exception).
Run the server behind a reverse proxy that terminates TLS:

* [NGINX](https://nginx.org/)
* [Caddy](https://caddyserver.com/)
* [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/)
* [Tailscale Funnel](https://tailscale.com/kb/1223/funnel/)


## 🗄️ Storage and Lifecycle

- Uploaded files live in `server/uploads`.
- Files can be configured to expire automatically.
- Files are be removed after the first successful download.
- Incomplete uploads are cleaned up on an interval.


## 🔎 Logging and Privacy

Dropgate tries to keep logs **minimal and transparent**.
For the full breakdown of what gets logged (and what doesn’t), see:

- [`docs/PRIVACY.md`](../docs/PRIVACY.md)

If you’re debugging a problem, temporarily enable `LOG_LEVEL=DEBUG`, reproduce the issue, then turn it back down.


## 📜 License

Licensed under the **AGPL-3.0 License**.
See the [LICENSE](./LICENSE) file for details.


## 📖 Acknowledgements

* Logo designed by [TheFuturisticIdiot](https://youtube.com/TheFuturisticIdiot)
* Built with [Node.js](https://www.nodejs.org/)
* Inspired by the growing need for privacy-respecting, open file transfer tools


## 🙂 Contact Us

* 💬 **Need help or want to chat?** [Join our Discord Server](https://diamonddigital.dev/discord)
* 🐛 **Found a bug?** [Open an issue](https://github.com/WillTDA/Dropgate/issues)
* 💡 **Have a suggestion?** [Submit a feature request](https://github.com/WillTDA/Dropgate/issues/new?labels=enhancement)

<div align="center">
  <a href="https://diamonddigital.dev/">
  <strong>Created and maintained by</strong>
  <img align="center" alt="Diamond Digital Development Logo" src="https://diamonddigital.dev/img/png/ddd_logo_text_transparent.png" style="width:25%;height:auto" /></a>
</div>
