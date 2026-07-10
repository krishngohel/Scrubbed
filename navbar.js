/* Shared navbar: Vault + Dashboard always; Secondary AI when signed in */
(function (global) {
  'use strict';

  const TOKEN_KEY = 'scrubbed_token';

  function isLoggedIn() {
    return !!localStorage.getItem(TOKEN_KEY);
  }

  function setActiveNav() {
    const path = global.location.pathname;
    document.querySelectorAll('[data-nav]').forEach((el) => {
      const key = el.dataset.nav;
      const active = (key === 'vault' && path === '/vault')
        || (key === 'dashboard' && path === '/dashboard')
        || (key === 'secondaries' && path === '/secondaries');
      el.classList.toggle('is-active', active);
    });
  }

  function syncNavbar() {
    const loggedIn = isLoggedIn();
    document.querySelectorAll('.nav-auth-only').forEach((el) => {
      el.hidden = !loggedIn;
    });
    setActiveNav();
  }

  global.NavBar = { sync: syncNavbar, setActive: setActiveNav };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncNavbar);
  } else {
    syncNavbar();
  }
})(window);
