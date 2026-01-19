import { ShadownloaderClient } from './shadownloader-core.js';

(async () => {
  try {
    const client = new ShadownloaderClient({ clientVersion: '0.0.0' });
    const { serverInfo } = await client.getServerInfo(location.origin, { timeoutMs: 5000 });
    const v = serverInfo?.version ? `v${serverInfo.version}` : '';

    const el1 = document.getElementById('serverVersion');
    if (el1) el1.textContent = v;

    const el2 = document.getElementById('server-version');
    if (el2) el2.textContent = v;
  } catch {
    // ignore
  }
})();
