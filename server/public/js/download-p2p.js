(() => {
  const elTitle = document.getElementById('title');
  const elMsg = document.getElementById('message');
  const elMeta = document.getElementById('meta');
  const elBar = document.getElementById('bar');
  const elBytes = document.getElementById('bytes');
  const elActions = document.getElementById('actions');
  const retryBtn = document.getElementById('retryBtn');

  retryBtn?.addEventListener('click', () => location.reload());

  const code = document.body.dataset.code;

  let writer = null;
  let total = 0;
  let received = 0;

  const fmtBytes = (bytes) => {
    if (!Number.isFinite(bytes)) return '0 B';
    const units = ['B','KB','MB','GB','TB'];
    let v = bytes;
    let u = 0;
    while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
    const dp = v < 10 && u > 0 ? 2 : (v < 100 ? 1 : 0);
    return `${v.toFixed(dp)} ${units[u]}`;
  };

  const setProgress = () => {
    const pct = total > 0 ? Math.min(100, (received / total) * 100) : 0;
    elBar.style.width = `${pct}%`;
    elBytes.textContent = `${fmtBytes(received)} / ${fmtBytes(total)}`;
  };

  const showError = (title, message) => {
    elTitle.textContent = title;
    elMsg.textContent = message;
    elMeta.hidden = true;
    elActions.hidden = false;
  };

  async function getInfo() {
    const res = await fetch('/api/info', { cache: 'no-store' });
    if (!res.ok) throw new Error('Failed to fetch server info');
    return res.json();
  }

  async function start() {
    if (!code) {
      showError('Invalid link', 'No sharing code was provided.');
      return;
    }

    if (!window.isSecureContext && location.hostname !== 'localhost') {
      showError('Secure connection required', 'P2P transfers require HTTPS in most browsers.');
      return;
    }

    if (typeof window.Peer !== 'function') {
      showError('PeerJS not loaded', 'The PeerJS client library is missing. Make sure peerjs is installed on the server.');
      return;
    }

    elTitle.textContent = 'Connecting…';
    elMsg.textContent = `Connecting to ${code}…`;

    let info;
    try {
      info = await getInfo();
    } catch {
      // still try to connect with defaults
      info = {};
    }

    const p2p = info?.capabilities?.p2p || {};
    if (p2p.enabled === false) {
      showError('Direct transfer disabled', 'This server has P2P disabled.');
      return;
    }

    const peerPath = p2p.peerjsPath || '/peerjs';
    const iceServers = Array.isArray(p2p.iceServers) ? p2p.iceServers : [];

    const secure = location.protocol === 'https:' || location.hostname === 'localhost';
    /** @type {any} */
    const peerOpts = {
      host: location.hostname,
      path: peerPath,
      secure,
      config: { iceServers },
    };

    if (location.port) peerOpts.port = Number(location.port);

    const peer = new window.Peer(undefined, peerOpts);

    peer.on('error', (err) => {
      console.error(err);
      showError('Connection failed', err?.message || 'Could not connect.');
    });

    peer.on('open', () => {
      const conn = peer.connect(code, { reliable: true });

      conn.on('open', () => {
        elTitle.textContent = 'Connected';
        elMsg.textContent = 'Waiting for file details…';
        try { conn.send({ t: 'ready' }); } catch {}
      });

      conn.on('data', async (data) => {
        try {
          if (data && typeof data === 'object' && !(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data) && data.t) {
            if (data.t === 'meta') {
              const name = String(data.name || 'file');
              total = Number(data.size) || 0;
              received = 0;
              elMeta.hidden = false;
              elMeta.textContent = `Receiving: ${name} (${fmtBytes(total)})`;
              elTitle.textContent = 'Receiving…';
              elMsg.textContent = 'Keep this tab open until the transfer completes.';

              const stream = streamSaver.createWriteStream(name, total ? { size: total } : undefined);
              writer = stream.getWriter();
              setProgress();
              return;
            }

            if (data.t === 'end') {
              if (writer) await writer.close();
              elTitle.textContent = 'Complete';
              elMsg.textContent = 'Transfer finished.';
              elMeta.textContent = 'Saved to your downloads.';
              elActions.hidden = false;
              return;
            }

            if (data.t === 'error') {
              throw new Error(data.message || 'Sender reported an error.');
            }
            return;
          }

          // binary chunk
          if (!writer) return;

          let buf;
          if (data instanceof ArrayBuffer) buf = new Uint8Array(data);
          else if (ArrayBuffer.isView(data)) buf = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
          else return;

          await writer.write(buf);
          received += buf.byteLength;
          setProgress();
        } catch (err) {
          console.error(err);
          showError('Transfer error', err?.message || 'An error occurred during the transfer.');
          try { writer?.abort(); } catch {}
          try { conn.close(); } catch {}
          try { peer.destroy(); } catch {}
        }
      });

      conn.on('close', () => {
        if (received > 0 && total > 0 && received < total) {
          showError('Disconnected', 'The sender disconnected before the transfer finished.');
        }
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
