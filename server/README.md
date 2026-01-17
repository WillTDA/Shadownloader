<div align="center">
   <img alt="Shadownloader Logo" src="./public/assets/icon.png" style="width:100px;height:auto;margin-bottom:1rem;" />

   # Shadownloader Server

   <p style="margin-bottom:1rem;">A Node.js-based backend for secure, privacy-focused file sharing with optional end-to-end encryption support.</p>
</div>

<div align="center">

![license](https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat-square)
![version](https://img.shields.io/badge/version-1.0.0-brightgreen?style=flat-square)
![docker](https://img.shields.io/badge/docker-supported-blue?style=flat-square)

</div>


## Overview

The **Shadownloader Server** powers the secure backend of the system, designed to handle temporary file uploads with optional **End-to-End Encryption (E2EE)** support.  
It can be self-hosted easily on:
- Home servers
- VPS instances
- Docker containers
- Cloudflare Tunnel or Tailscale-connected networks

When running with E2EE, your server acts purely as a **blind data relay** — the contents are unreadable without the client-side decryption key.


## Environment Variables

| Variable | Default | Description |
|-----------|----------|-------------|
| `ENABLE_UPLOAD` | `false` | Enables the upload protocol and its routes. |
| `ENABLE_P2P` | `true` | Enables the Peer Mode (P2P) capability flag. |
| `ENABLE_WEB_UI` | `true` | Enables the Web UI capability flag. |
| `UPLOAD_ENABLE_E2EE` | `false` | Enables end-to-end encryption for uploads. Requires HTTPS reverse proxy for secure operation. |
| `UPLOAD_PRESERVE_UPLOADS` | `false` | Keeps uploaded files after restarts. Use with mapped volume (`/usr/src/app/uploads`). |
| `UPLOAD_MAX_FILE_SIZE_MB` | `100` | Maximum allowed file size in MB. Set to `0` for unlimited. |
| `UPLOAD_MAX_STORAGE_GB` | `10` | Maximum storage quota in GB. Set to `0` for unlimited. |
| `UPLOAD_MAX_FILE_LIFETIME_HOURS` | `24` | Maximum file lifetime in hours. Set to `0` for unlimited. |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window in milliseconds. Set `0` to disable. |
| `RATE_LIMIT_MAX_REQUESTS` | `25` | Requests allowed per window. Set `0` to disable. |
| `UPLOAD_ZOMBIE_CLEANUP_INTERVAL_MS` | `300000` | Interval for cleaning up incomplete uploads. Set `0` to disable. |


## Installation (Manual)

```bash
git clone https://github.com/WillTDA/Shadownloader.git
cd Shadownloader/server
npm install
npm run start
````


## Running with Docker

You can easily deploy the server via Docker.

### Example Docker Command:

```bash
docker run -d \
  -p 52443:52443 \
  -e ENABLE_UPLOAD=true \
  -e UPLOAD_ENABLE_E2EE=true \
  -e UPLOAD_PRESERVE_UPLOADS=true \
  -e UPLOAD_MAX_FILE_SIZE_MB=1000 \
  -v /path/to/uploads:/usr/src/app/uploads \
  --name shadownloader \
  willtda/shadownloader-server:latest
```

The uploads folder should be mapped to persistent storage if `UPLOAD_PRESERVE_UPLOADS=true`.


## Server Info Endpoint

Accessing the info endpoint (`/api/info`) returns:

```json
{
  "name": "Shadownloader Server",
  "version": "<version>",
  "capabilities": {
    "upload": {
      "enabled": false
    },
    "p2p": {
      "enabled": true
    },
    "webUI": {
      "enabled": true
    }
  }
}
```

This is useful for clients to confirm server status, version, and capabilities before upload.


## Reverse Proxy Setup

When using E2EE, you must run the server behind a secure reverse proxy.

**Compatible options:**

* [NGINX](https://nginx.org/)
* [Caddy](https://caddyserver.com/)
* [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/)
* [Tailscale Funnel](https://tailscale.com/kb/1223/funnel/)

Each works perfectly for HTTPS termination while the Node.js backend runs internally over HTTP.


## License

Licensed under the **AGPL-3.0 License**.
See the [LICENSE](./LICENSE) file for more details.


## Acknowledgements

* Logo designed by [TheFuturisticIdiot](https://youtube.com/TheFuturisticIdiot)
* Built with [Node.js](https://www.nodejs.org/)
* Inspired by the growing need for privacy-respecting, open file transfer tools


## Contact Us

* 💬 **Need help or want to chat?** [Join our Discord Server](https://diamonddigital.dev/discord)
* 🐛 **Found a bug?** [Open an issue](https://github.com/WillTDA/Shadownloader/issues)
* 💡 **Have a suggestion?** [Submit a feature request](https://github.com/WillTDA/Shadownloader/issues/new?labels=enhancement)

<div align="center">
  <a href="https://diamonddigital.dev/">
  <strong>Created and maintained by</strong>
  <img align="center" alt="Diamond Digital Development Logo" src="https://diamonddigital.dev/img/png/ddd_logo_text_transparent.png" style="width:25%;height:auto" /></a>
</div>
