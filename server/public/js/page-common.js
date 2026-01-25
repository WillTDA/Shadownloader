import { getServerInfo } from './dropgate-core.js';

(async () => {
  try {
    const { serverInfo } = await getServerInfo({
      host: location.hostname,
      port: location.port ? Number(location.port) : undefined,
      secure: location.protocol === 'https:',
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
