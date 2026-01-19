(() => {
  const selector = '[data-tooltip]';

  let current = null;
  let currentTarget = null;

  function removeTooltip() {
    if (current) {
      current.remove();
      current = null;
    }
    if (currentTarget) {
      currentTarget.removeAttribute('aria-describedby');
      currentTarget = null;
    }
  }

  function placeTooltip(target, tip) {
    const placement = (target.getAttribute('data-tooltip-placement') || 'top').toLowerCase();
    const rect = target.getBoundingClientRect();
    const scrollX = window.scrollX || document.documentElement.scrollLeft;
    const scrollY = window.scrollY || document.documentElement.scrollTop;

    tip.setAttribute('data-placement', placement);

    // Temporarily show to measure.
    tip.style.left = '0px';
    tip.style.top = '0px';
    tip.style.visibility = 'hidden';
    document.body.appendChild(tip);

    const tRect = tip.getBoundingClientRect();
    const gap = 8;

    let left = 0;
    let top = 0;

    if (placement === 'bottom') {
      left = rect.left + (rect.width / 2) - (tRect.width / 2);
      top = rect.bottom + gap;
    } else if (placement === 'left') {
      left = rect.left - tRect.width - gap;
      top = rect.top + (rect.height / 2) - (tRect.height / 2);
    } else if (placement === 'right') {
      left = rect.right + gap;
      top = rect.top + (rect.height / 2) - (tRect.height / 2);
    } else {
      // top
      left = rect.left + (rect.width / 2) - (tRect.width / 2);
      top = rect.top - tRect.height - gap;
    }

    // Clamp within viewport.
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    left = Math.max(8, Math.min(left, vw - tRect.width - 8));
    top = Math.max(8, Math.min(top, vh - tRect.height - 8));

    tip.style.left = `${left + scrollX}px`;
    tip.style.top = `${top + scrollY}px`;
    tip.style.visibility = 'visible';
  }

  function showTooltip(target) {
    const text = target.getAttribute('data-tooltip');
    if (!text) return;

    removeTooltip();

    const tip = document.createElement('div');
    tip.className = 'tooltip-lite';
    tip.textContent = text;

    const id = `tooltip-${Math.random().toString(16).slice(2)}`;
    tip.id = id;
    target.setAttribute('aria-describedby', id);

    current = tip;
    currentTarget = target;

    placeTooltip(target, tip);
  }

  function isTouchLikely() {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  }

  function bind(el) {
    el.addEventListener('mouseenter', () => showTooltip(el));
    el.addEventListener('mouseleave', removeTooltip);
    el.addEventListener('focus', () => showTooltip(el));
    el.addEventListener('blur', removeTooltip);

    // On touch devices, tapping toggles the tooltip.
    el.addEventListener('click', (e) => {
      if (!isTouchLikely()) return;
      e.preventDefault();
      e.stopPropagation();
      if (currentTarget === el) removeTooltip();
      else showTooltip(el);
    });
  }

  function init() {
    document.querySelectorAll(selector).forEach(bind);

    window.addEventListener('scroll', () => {
      if (current && currentTarget) placeTooltip(currentTarget, current);
    }, { passive: true });

    window.addEventListener('resize', () => {
      if (current && currentTarget) placeTooltip(currentTarget, current);
    });

    document.addEventListener('click', () => {
      if (isTouchLikely()) removeTooltip();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') removeTooltip();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
