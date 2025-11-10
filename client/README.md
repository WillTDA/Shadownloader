<div align="center">
   <img alt="Shadownloader Logo" src="./src/img/shadownloader.png" style="width:100px;height:auto;margin-bottom:1rem;" />

   # Shadownloader Client

   <p style="margin-bottom:1rem;">An Electron-based, privacy-first file sharing client built for secure communication with Shadownloader servers.</p>
</div>

<div align="center">

![license](https://img.shields.io/badge/license-GPL--3.0-blue?style=flat-square)
![version](https://img.shields.io/badge/version-1.0.0-brightgreen?style=flat-square)
![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square)

[![discord](https://img.shields.io/discord/667479986214666272?logo=discord\&logoColor=white\&style=flat-square)](https://diamonddigital.dev/discord)
[![buy me a coffee](https://img.shields.io/badge/-Buy%20Me%20a%20Coffee-ffdd00?logo=Buy%20Me%20A%20Coffee\&logoColor=000000\&style=flat-square)](https://www.buymeacoffee.com/willtda)

</div>


## Features

* 🔒 **End-to-End Encryption (E2EE)** | Protect your data from interception — files are encrypted before upload and only decrypted by the recipient’s client.

* 🌐 **Server Agnostic** | Connect to any compatible Shadownloader Server — whether it’s self-hosted at home, deployed via Docker, or behind a proxy.

* 🧱 **Privacy by Design** | No telemetry, no analytics, and no personal identifiers. Your data stays between you and your chosen server.

* 🖥️ **Cross-Platform Support** | Available for Windows, macOS, and Linux.

* ⚡ **Fast, Lightweight Interface** | Built with Electron for performance and ease of use, with a simple UI designed around minimalism and clarity.

* 🧩 **Version Syncing** | The client automatically checks server compatibility to prevent issues when breaking changes occur.


## Installation

To install Shadownloader Client:

1. Download the latest release for your OS from the [releases page](https://github.com/WillTDA/Shadownloader/releases).
2. Extract or install the app as you would any other Electron app.
3. Launch the Shadownloader Client and connect to your preferred server.

**Note:** macOS and Linux builds have not yet been officially compiled/tested since I lack the necessary hardware/software :(
Any help towards this goal would be greatly appreciated.

## Usage

Sending a file:
1. **Launch** the client.
2. **Enter the server address** you want to connect to (for example, your home server or a private Shadownloader instance).
3. **Select a file** to upload or drag and drop it into the interface.
4. **Select your options** to enable/disable E2EE and change the file lifetime.
5. **Simply hit upload!** When it finishes, **copy the generated download link** and share it securely.

**Protip:** If you're on Windows, you can simply right-click a file, and choose either **"Share with Shadownloader"** or **"Share with Shadownloader (E2EE)"** from the context menu to silently upload the file in the background. You'll be notified when the upload finishes, and the link will automatically be copied to your clipboard.

Receiving a file:
1. **Launch** your preferred web browser.
2. **Paste the download link** into the address bar.
3. **Wait** for the file to download. End-to-end encrypted files will be decrypted locally and saved your web browser, otherwise they are downloaded as usual.


## Development

To set up a development environment:

1. Clone the repository:

   ```bash
   git clone https://github.com/WillTDA/Shadownloader.git
   cd Shadownloader/client
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Run the client in development mode:

   ```bash
   npm start
   ```


## Building

To build the client for your platform:

```bash
npm run build
```

Distributable binaries will appear in the `dist` folder.


## Self-Hosting & Networking

Shadownloader Client works seamlessly with **self-hosted Shadownloader Servers**, which you can run from your own **home server**, **NAS**, or **cloud VPS**.

E2EE and networking work perfectly with:

* 🌐 **NGINX** or **Caddy** reverse proxies
* ☁️ **Cloudflare Tunnel** setups
* 🔒 **Tailscale** private networks

This makes it easy to keep your file sharing private, even across devices or remote networks.


## License

Shadownloader Client is licensed under the **GPL-3.0 License**.
See the [LICENSE](./LICENSE) file for details.


## Acknowledgements

* Logo designed by [TheFuturisticIdiot](https://youtube.com/TheFuturisticIdiot)
* Built with [Electron](https://www.electronjs.org/)
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