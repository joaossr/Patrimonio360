(() => {
  const MOBILE_QUERY = '(max-width: 950px)';
  let overlay = null;
  let closeButton = null;

  const isMobile = () => window.matchMedia(MOBILE_QUERY).matches;
  const sidebar = () => document.getElementById('sidebar');

  function ensureControls() {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'p360-mobile-overlay';
      overlay.setAttribute('aria-hidden', 'true');
      overlay.addEventListener('click', closeMobileSidebar);
      document.body.appendChild(overlay);
    }
    const sb = sidebar();
    if (sb && !closeButton) {
      closeButton = document.createElement('button');
      closeButton.type = 'button';
      closeButton.className = 'mobile-sidebar-close';
      closeButton.setAttribute('aria-label', 'Fechar menu');
      closeButton.textContent = '×';
      closeButton.addEventListener('click', closeMobileSidebar);
      const brand = sb.querySelector('.brand');
      if (brand) brand.appendChild(closeButton);
    }
  }

  function openMobileSidebar() {
    if (!isMobile()) return;
    ensureControls();
    const sb = sidebar();
    if (!sb) return;
    sb.classList.add('open');
    overlay?.classList.add('is-open');
    overlay?.setAttribute('aria-hidden', 'false');
    document.body.classList.add('mobile-sidebar-open');
    document.getElementById('menuBtn')?.setAttribute('aria-expanded', 'true');
  }

  function closeMobileSidebar() {
    const sb = sidebar();
    sb?.classList.remove('open');
    overlay?.classList.remove('is-open');
    overlay?.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('mobile-sidebar-open');
    document.getElementById('menuBtn')?.setAttribute('aria-expanded', 'false');
  }

  function toggleMobileSidebar() {
    if (!isMobile()) return;
    const sb = sidebar();
    if (sb?.classList.contains('open')) closeMobileSidebar();
    else openMobileSidebar();
  }

  // Capture phase prevents the legacy toggle handler from toggling twice.
  document.addEventListener('click', (event) => {
    const menu = event.target.closest?.('#menuBtn');
    if (menu && isMobile()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      toggleMobileSidebar();
      return;
    }

    const navItem = event.target.closest?.('.sidebar .nav-item');
    if (navItem && isMobile()) {
      closeMobileSidebar();
    }
  }, true);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isMobile()) closeMobileSidebar();
  });

  window.addEventListener('resize', () => {
    if (!isMobile()) closeMobileSidebar();
  }, { passive: true });

  // render() replaces #app, so controls are recreated lazily after each render.
  const observer = new MutationObserver(() => {
    if (!isMobile()) return;
    const sb = sidebar();
    if (sb && !sb.classList.contains('open')) {
      document.body.classList.remove('mobile-sidebar-open');
      overlay?.classList.remove('is-open');
      if (!sb.querySelector('.mobile-sidebar-close')) {
        closeButton = null;
        ensureControls();
      }
    }
  });

  function init() {
    ensureControls();
    closeMobileSidebar();
    observer.observe(document.getElementById('app') || document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();

  window.P360MobileNavigation = { open: openMobileSidebar, close: closeMobileSidebar, toggle: toggleMobileSidebar };
})();
