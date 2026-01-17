(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const root = document.documentElement;

    const apply = () => root.setAttribute('data-bs-theme', mql.matches ? 'dark' : 'light');

    apply();
    mql.addEventListener?.('change', apply);
})();
