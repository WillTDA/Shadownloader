<div align="center">
   <img alt="Dropgate Logo" src="./src/img/dropgate.png" style="width:100px;height:auto;margin-bottom:1rem;" />

   # Dropgate Client

   <p style="margin-bottom:1rem;">An Electron-based, privacy-first file sharing client built for secure communication with Dropgate servers.</p>
</div>

<div align="center">

![license](https://img.shields.io/badge/license-GPL--3.0-blue?style=flat-square)
![version](https://img.shields.io/badge/version-2.2.0-brightgreen?style=flat-square)
![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square)

[![discord](https://img.shields.io/discord/667479986214666272?logo=discord\&logoColor=white\&style=flat-square)](https://diamonddigital.dev/discord)
[![buy me a coffee](https://img.shields.io/badge/-Buy%20Me%20a%20Coffee-ffdd00?logo=Buy%20Me%20A%20Coffee\&logoColor=000000\&style=flat-square)](https://www.buymeacoffee.com/willtda)

</div>


## 🌍 Overview

**Dropgate Client** is the desktop way to upload and share files through a Dropgate Server.
It’s built to feel simple: pick a file, choose your options, hit upload, and share the link.


## ✨ Features

* 🔒 **End-to-End Encryption (E2EE)** | Encrypt on your device before upload, decrypt on the recipient’s device. The server doesn’t need your key.

* 🌐 **Server Agnostic** | Connect to any compatible Dropgate Server — whether it’s self-hosted at home, deployed via Docker, or behind a reverse proxy.

* 🧱 **Privacy by Design** | No telemetry, no analytics, and no personal identifiers. Your data stays between you and your chosen server.

* 🖥️ **Cross-Platform Support** | Available for Windows, macOS, and Linux.

* ⚡ **Fast, Lightweight Interface** | Simple drag-and-drop UI focused on minimalism and clarity.

* 🧩 **Smart Compatibility Checks** | The client reads server capabilities (limits, encryption support, etc.) so you don’t run into surprises mid-upload.

* 🪟 **Windows Context Menu Integration** | Right-click a file and upload in the background.


## 📦 Installation

To install Dropgate Client:

1. Download the latest release for your OS from the [releases page](https://github.com/WillTDA/Dropgate/releases).
2. Extract or install the app as you would any other desktop app.
3. Launch the client and connect to your preferred server.


## 🚀 Usage

### Sending a file

1. **Launch** the client.
2. **Enter the server address** you want to connect to (for example, your home server or a private Dropgate instance).
3. **Select a file** to upload (or drag and drop it into the window).
4. **Choose your options** (E2EE and file lifetime, depending on what the server allows).
5. **Hit upload!** When it finishes, the **download link is copied to your clipboard**.

**Protip (Windows):** Right-click a file and choose either **"Share with Dropgate"** or **"Share with Dropgate (E2EE)"** to upload silently in the background.

### Receiving a file

1. Open your web browser.
2. Paste the download link into the address bar.
3. Download as usual. If the file is end-to-end encrypted, decryption happens locally on your device.


## 🌐 Direct Transfer (P2P)

The desktop client focuses on the classic hosted-upload flow.
If your server has **Direct Transfer (P2P)** enabled, you can use it from the server’s **Web UI** in your browser.


## 🛠️ Development

To set up a development environment:

```bash
git clone https://github.com/WillTDA/Dropgate.git
cd Dropgate/client
npm install
npm start
```


## 🏗️ Building

To build the client for your platform:

```bash
npm run build
```

Distributable binaries will appear in the `dist` folder.


## 🔌 Self-Hosting & Networking

Dropgate Client works seamlessly with **self-hosted Dropgate Servers**, which you can run from your own **home server**, **NAS**, or **cloud VPS**.

It plays nicely with common setups like:

* 🌐 **NGINX** or **Caddy** reverse proxies
* ☁️ **Cloudflare Tunnel**
* 🔒 **Tailscale** private networks


## 📜 License

Dropgate Client is licensed under the **GPL-3.0 License**.
See the [LICENSE](./LICENSE) file for details.


## 📖 Acknowledgements

* Logo designed by [TheFuturisticIdiot](https://youtube.com/TheFuturisticIdiot)
* Built with [Electron](https://www.electronjs.org/)
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
