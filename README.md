<div align="center">
   <img alt="Dropgate Logo" src="./dropgate.png" style="width:100px;height:auto;margin-bottom:1rem;" />

   # Dropgate

   <p style="margin-bottom:1rem;">A self-hostable, privacy-first file sharing system with both hosted upload and direct P2P transfer capabilities.</p>
</div>

<div align="center">

![license](https://img.shields.io/badge/license-Mixed-lightgrey?style=flat-square)
![platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey?style=flat-square)

[![discord](https://img.shields.io/discord/667479986214666272?logo=discord&logoColor=white&style=flat-square)](https://diamonddigital.dev/discord)
[![buy me a coffee](https://img.shields.io/badge/-Buy%20Me%20a%20Coffee-ffdd00?logo=Buy%20Me%20A%20Coffee&logoColor=000000&style=flat-square)](https://www.buymeacoffee.com/willtda)

</div>

## 🌐 Public Demo

See **Dropgate** in action here: **[dropgate.link](https://dropgate.link)**

To prevent and monitor for abuse, `DEBUG`-level logging and strict rate limits are enforced.

## 🌍 Overview

**Dropgate** is a modern, privacy-respecting file sharing system designed to be easy to self-host and easy to use.

It ships as three parts:
- [**Dropgate Client**](./client/README.md): A lightweight Electron app for uploading, encrypting, and sharing files.
- [**Dropgate Server**](./server/README.md): A Node.js backend that hosts the API + Web UI, with optional end-to-end encryption and configurable storage.
- [**@dropgate/core**](./packages/dropgate-core/README.md): A headless TypeScript library that powers the client and server, usable in custom projects.

Dropgate supports **two ways to transfer files**:
- **Hosted upload (classic mode)** — you upload to your server, share a link, and the server holds the file temporarily.
- **Direct transfer (P2P)** — the file can move device-to-device, with the server only helping peers find each other.

In today’s world, privacy and anonymity are more important than ever.
Dropgate was built to make **secure file sharing accessible**, **transparent**, and **fully self-hostable** — whether on a home NAS, a VPS, or in Docker.


## ✨ Features

- 🔐 **End-to-End Encryption (E2EE)** – Encrypt on the sender device, decrypt on the recipient device. Encryption keys never need to reach the server.
- 🕵️ **Privacy First** – No analytics, no tracking, and no logging of file contents.
- 🔗 **Share Links That “Just Work”** – Simple links for recipients that expire based on download count or lifetime.
- 🚀 **Direct Transfer (P2P)** – Great for big files or “zero-storage” sharing (when enabled).
- 🧩 **Built-in Web UI** – Send and receive from a browser, no install required.
- ⚙️ **Configurable Server Controls** – Tune size limits, rate limits, retention, and storage caps.
- 🧰 **Self-Host Ready** – Works behind common reverse proxies and tunnels.


## 🧰 Project Structure

```
/Dropgate
├── client/    # Electron-based uploader app (GPL-3.0)
├── server/    # Node.js server + Web UI (AGPL-3.0)
├── docs/      # Privacy and troubleshooting notes
```


## 🧩 Getting Started

### Clone the Repository

```bash
git clone https://github.com/WillTDA/Dropgate.git
cd Dropgate
```

### Server

See the [server README](./server/README.md) for configuration, Docker setup, and deployment.

### Client

See the [client README](./client/README.md) for installation, usage, and build instructions.


## 🔒 Privacy and Security Philosophy

Dropgate’s design is built around **you staying in control of your data**:

* E2EE means even the server operator can’t read encrypted uploads.
* Hosted uploads are intended to be temporary (downloaded and/or expired, then removed).
* Direct transfer can avoid server storage entirely (when enabled).

If you self-host, you decide how strict you want to be — from private-only to public-facing with limits.


## 📚 Docs

- [`docs/PRIVACY.md`](./docs/PRIVACY.md)
- [`docs/TROUBLESHOOTING.md`](./docs/TROUBLESHOOTING.md)


## 📜 Licenses

* **Client:** GPL-3.0 License – See [`client/LICENSE`](./client/LICENSE)
* **Server:** AGPL-3.0 License – See [`server/LICENSE`](./server/LICENSE)
* **Core Library:** Apache-2.0 License – See [`packages/dropgate-core/LICENSE`](./packages/dropgate-core/LICENSE)


## 📖 Acknowledgements

* Logo designed by [TheFuturisticIdiot](https://youtube.com/TheFuturisticIdiot)
* Built with [Electron](https://www.electronjs.org/) and [Node.js](https://www.nodejs.org/)
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
