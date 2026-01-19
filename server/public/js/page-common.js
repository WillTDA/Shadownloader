(async () => {
  try {
    const res = await fetch('/api/info', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    const v = data?.version ? `v${data.version}` : '';

    const el1 = document.getElementById('serverVersion');
    if (el1) el1.textContent = v;

    const el2 = document.getElementById('server-version');
    if (el2) el2.textContent = v;
  } catch {
    // ignore
  }
})();
