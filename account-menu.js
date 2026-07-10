/* Shared account dropdown: plan, theme, 2FA, delete account */
(function (global) {
  'use strict';

  const TOKEN_KEY = 'scrubbed_token';
  const REFRESH_KEY = 'scrubbed_refresh';

  function token() { return localStorage.getItem(TOKEN_KEY); }

  function authHeaders() {
    return { Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json' };
  }

  function notify(msg) {
    if (typeof global.showToast === 'function') global.showToast(msg);
    else if (msg) alert(msg);
  }

  function closeDropdown() {
    const dd = document.getElementById('user-dropdown');
    if (dd) dd.classList.remove('open');
    document.querySelectorAll('.user-dropdown.open').forEach((el) => el.classList.remove('open'));
  }

  function syncThemePicker(colors) {
    const ids = ['tc-bg', 'tc-font', 'tc-primary', 'tc-accent'];
    const keys = ['bg', 'font', 'primary', 'accent'];
    ids.forEach((id, i) => {
      const el = document.getElementById(id);
      if (el) el.value = colors[keys[i]];
    });
    document.querySelectorAll('.theme-preset').forEach((btn, i) => {
      const p = global.THEME_PRESETS && global.THEME_PRESETS[i];
      btn.classList.toggle('active', p && p.bg === colors.bg && p.font === colors.font && p.primary === colors.primary && p.accent === colors.accent);
    });
  }

  function readCustomTheme() {
    const def = global.THEME_DEFAULT || {};
    return {
      bg: document.getElementById('tc-bg')?.value || def.bg,
      font: document.getElementById('tc-font')?.value || def.font,
      primary: document.getElementById('tc-primary')?.value || def.primary,
      accent: document.getElementById('tc-accent')?.value || def.accent,
    };
  }

  function initThemePicker() {
    const presetsEl = document.getElementById('theme-presets');
    if (presetsEl && global.THEME_PRESETS && !presetsEl.dataset.ready) {
      presetsEl.dataset.ready = '1';
      global.THEME_PRESETS.forEach((p, i) => {
        const btn = document.createElement('button');
        btn.className = 'theme-preset';
        btn.title = p.name;
        btn.style.background = `linear-gradient(135deg,${p.primary} 50%,${p.accent} 50%)`;
        btn.dataset.idx = i;
        btn.addEventListener('click', () => { global.applyTheme(p); });
        presetsEl.appendChild(btn);
      });
    }

    ['tc-bg', 'tc-font', 'tc-primary', 'tc-accent'].forEach(id => {
      const el = document.getElementById(id);
      if (el && !el.dataset.bound) {
        el.dataset.bound = '1';
        el.addEventListener('input', () => global.applyTheme(readCustomTheme()));
      }
    });

    const resetBtn = document.getElementById('theme-reset');
    if (resetBtn && !resetBtn.dataset.bound) {
      resetBtn.dataset.bound = '1';
      resetBtn.addEventListener('click', () => global.applyTheme(global.THEME_DEFAULT));
    }

    if (!global.syncThemePicker) {
      global.syncThemePicker = syncThemePicker;
    }

    try {
      const saved = localStorage.getItem('scrubbed_theme');
      if (global.syncThemePicker) {
        global.syncThemePicker(saved ? JSON.parse(saved) : global.THEME_DEFAULT);
      }
    } catch (e) { /* ignore */ }
  }

  async function load2FAStatus() {
    if (!token()) return;
    try {
      const res = await fetch('/auth/2fa-status', { headers: authHeaders() });
      if (!res.ok) return;
      const { two_fa_enabled } = await res.json();
      const label = document.getElementById('twofa-toggle-label');
      if (label) label.textContent = `Two-factor auth: ${two_fa_enabled ? 'On' : 'Off'}`;
    } catch { /* ignore */ }
  }

  async function reactivatePlan() {
    if (!token()) return;
    try {
      const res = await fetch('/stripe/reactivate', { method: 'POST', headers: authHeaders() });
      const d = await res.json();
      if (d.ok) { notify('Subscription reactivated'); loadPlanStatus(); }
      else notify(d.error || 'Could not reactivate.');
    } catch { notify('Error reactivating plan.'); }
  }

  global.openBillingPortal = async function openBillingPortal() {
    if (!token()) { notify('Sign in first'); return; }
    try {
      const res = await fetch('/stripe/portal', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ return_url: global.location.href }),
      });
      const d = await res.json();
      if (d.url) global.location.href = d.url;
      else notify(d.error || 'Could not open billing portal.');
    } catch { notify('Could not open billing portal.'); }
  };

  async function loadPlanStatus() {
    if (!token()) return;
    try {
      const res = await fetch('/stripe/status', { headers: authHeaders() });
      if (!res.ok) return;
      const d = await res.json();
      const badge = document.getElementById('plan-badge');
      const btn = document.getElementById('plan-action-btn');
      if (!badge) return;
      const fmt = iso => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const planLabel = d.plan_type === 'starter' ? 'Starter'
        : d.plan_type === 'annual' ? 'Pro Annual'
        : d.plan_type === 'cycle' ? 'Cycle Pass'
        : d.plan_type === 'monthly' ? 'Pro'
        : 'Pro';
      const usageSuffix = d.plan_type === 'starter' && d.outlines_limit != null
        ? ` · ${d.outlines_used ?? 0}/${d.outlines_limit} outlines`
        : (d.status === 'pro' ? ' · Unlimited' : '');
      if (d.status === 'pro' && d.cancel_at) {
        badge.textContent = planLabel + usageSuffix + ' · ends ' + fmt(d.cancel_at);
        badge.className = 'plan-badge is-canceling';
        if (btn) { btn.textContent = 'Reactivate'; btn.style.display = ''; btn.onclick = reactivatePlan; }
      } else if (d.status === 'pro') {
        badge.textContent = planLabel + usageSuffix + (d.renews_at ? ' · renews ' + fmt(d.renews_at) : '');
        badge.className = 'plan-badge is-pro';
        if (btn) { btn.textContent = 'Manage plan'; btn.style.display = ''; btn.onclick = global.openBillingPortal; }
      } else {
        badge.textContent = 'Free plan';
        badge.className = 'plan-badge';
        if (btn) { btn.textContent = 'Upgrade'; btn.style.display = ''; btn.onclick = () => { global.location.href = '/#pricing'; }; }
      }
    } catch { /* ignore */ }
  }

  global.toggle2FA = function toggle2FA() {
    fetch('/auth/2fa-status', { headers: authHeaders() })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(({ two_fa_enabled }) => {
        if (two_fa_enabled) {
          return fetch('/auth/disable-2fa', { method: 'POST', headers: authHeaders() }).then(r => {
            if (!r.ok) throw new Error();
            const label = document.getElementById('twofa-toggle-label');
            if (label) label.textContent = 'Two-factor auth: Off';
            closeDropdown();
          });
        }
        return fetch('/auth/enable-2fa', { method: 'POST', headers: authHeaders() }).then(r => {
          if (!r.ok) throw new Error();
          closeDropdown();
          global.open2faEnableModal();
        });
      })
      .catch(() => alert('Could not update two-factor authentication setting.'));
  };

  global.open2faEnableModal = function open2faEnableModal() {
    const m = document.getElementById('twofa-enable-modal');
    if (!m) return;
    m.style.display = 'flex';
    const input = document.getElementById('twofa-enable-code');
    if (input) input.value = '';
    const err = document.getElementById('twofa-enable-error');
    if (err) err.textContent = '';
    setTimeout(() => input && input.focus(), 60);
  };

  global.close2faEnableModal = function close2faEnableModal() {
    const m = document.getElementById('twofa-enable-modal');
    if (m) m.style.display = 'none';
  };

  global.confirm2faEnable = function confirm2faEnable() {
    const code = document.getElementById('twofa-enable-code').value.trim();
    const errorEl = document.getElementById('twofa-enable-error');
    if (!/^\d{6}$/.test(code)) { errorEl.textContent = 'Enter the 6-digit code from your email.'; return; }
    const btn = document.getElementById('twofa-enable-btn');
    btn.disabled = true; btn.textContent = 'Verifying…';
    fetch('/auth/enable-2fa/confirm', { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })
      .then(r => r.json().then(d => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) throw new Error(d.error || 'Verification failed.');
        const label = document.getElementById('twofa-toggle-label');
        if (label) label.textContent = 'Two-factor auth: On';
        global.close2faEnableModal();
      })
      .catch(err => { errorEl.textContent = err.message || 'Verification failed.'; })
      .finally(() => { btn.disabled = false; btn.textContent = 'Verify & enable'; });
  };

  global.openDeleteModal = function openDeleteModal() {
    closeDropdown();
    const modal = document.getElementById('delete-account-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    document.getElementById('delete-confirm-input').value = '';
    document.getElementById('delete-account-error').textContent = '';
  };

  global.closeDeleteModal = function closeDeleteModal() {
    const modal = document.getElementById('delete-account-modal');
    if (modal) modal.style.display = 'none';
    const input = document.getElementById('delete-confirm-input');
    if (input) input.value = '';
    const err = document.getElementById('delete-account-error');
    if (err) err.textContent = '';
  };

  global.confirmDeleteAccount = function confirmDeleteAccount() {
    const input = document.getElementById('delete-confirm-input').value.trim();
    const errorEl = document.getElementById('delete-account-error');
    if (input !== 'DELETE') { errorEl.textContent = 'Please type DELETE to confirm.'; return; }
    const btn = document.getElementById('delete-confirm-btn');
    btn.disabled = true;
    fetch('/auth/account', { method: 'DELETE', headers: authHeaders() })
      .then(r => r.json().then(d => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) throw new Error(d.error || 'Could not delete account.');
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(REFRESH_KEY);
        global.location.href = '/';
      })
      .catch(err => { errorEl.textContent = err.message || 'Could not delete account.'; })
      .finally(() => { btn.disabled = false; });
  };

  function setAvatarLetter(username) {
    const el = document.getElementById('nav-user-btn');
    if (el && username) el.textContent = username[0].toUpperCase();
  }

  function refresh() {
    if (global.NavBar) global.NavBar.sync();
    initThemePicker();
    loadPlanStatus();
    load2FAStatus();
  }

  global.AccountMenu = {
    token,
    authHeaders,
    refresh,
    setAvatarLetter,
    initThemePicker,
    loadPlanStatus,
    load2FAStatus,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initThemePicker);
  } else {
    initThemePicker();
  }
})(window);
