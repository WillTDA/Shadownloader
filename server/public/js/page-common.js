import { getServerInfo } from './dropgate-core.js';

(async () => {
  try {
    const { serverInfo } = await getServerInfo({
      server: window.location.origin,
      timeoutMs: 5000,
    });
    const v = serverInfo?.version ? `v${serverInfo.version}` : '';

    const el1 = document.getElementById('serverVersion');
    if (el1) el1.textContent = v;

    const el2 = document.getElementById('server-version');
    if (el2) el2.textContent = v;
  } catch {
    // ignore
  }
})();
