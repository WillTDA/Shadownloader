(() => {
  const mql = window.matchMedia?.('(prefers-color-scheme: dark)');
  const root = document.documentElement;

  const apply = () => {
    const isDark = Boolean(mql?.matches);
    // For bootstrap pages
    if (root.hasAttribute('data-bs-theme') || document.querySelector('[data-bs-theme]')) {
      root.setAttribute('data-bs-theme', isDark ? 'dark' : 'light');
    }
    // For the custom Web UI
    if (root.hasAttribute('data-theme')) {
      root.setAttribute('data-theme', isDark ? 'dark' : 'light');
    }

    // Optional class hook
    root.classList.toggle('theme-dark', isDark);
  };

  apply();
  mql?.addEventListener?.('change', apply);
})();
