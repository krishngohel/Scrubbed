/* Shared account dropdown: plan, theme, 2FA, delete account, billing */
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
        btn.type = 'button';
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

  function planLabel(planType) {
    return planType === 'starter' ? 'Starter'
      : planType === 'annual' ? 'Pro Annual'
      : planType === 'cycle' ? 'Cycle Pass'
      : planType === 'monthly' ? 'Pro'
      : 'Pro';
  }

  function fmtDate(iso) {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  async function reactivatePlan() {
    if (!token()) return;
    try {
      const res = await fetch('/stripe/reactivate', { method: 'POST', headers: authHeaders() });
      const d = await res.json();
      if (d.ok) { notify('Subscription reactivated'); loadPlanStatus(); closeManagePlanModal(); }
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

  async function cancelPlan() {
    if (!token()) return;
    if (!global.confirm('Cancel at the end of your billing period? You keep access until then.')) return;
    try {
      const res = await fetch('/stripe/cancel', { method: 'POST', headers: authHeaders() });
      const d = await res.json();
      if (res.ok) {
        notify(d.cancel_at ? 'Canceled — access until ' + fmtDate(d.cancel_at) : 'Subscription set to cancel.');
        loadPlanStatus();
        closeManagePlanModal();
      } else notify(d.error || 'Could not cancel.');
    } catch { notify('Could not cancel subscription.'); }
  }

  function ensureManagePlanModal() {
    if (document.getElementById('manage-plan-modal')) return;
    const el = document.createElement('div');
    el.id = 'manage-plan-modal';
    el.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(31,27,22,0.5);z-index:900;align-items:center;justify-content:center;padding:24px';
    el.innerHTML = `
      <div style="background:var(--cream,#FBF7EE);border:1px solid var(--rule,#E5DDCD);border-radius:16px;padding:28px;max-width:420px;width:100%;box-shadow:0 16px 48px rgba(31,27,22,0.16)">
        <div style="font-size:17px;font-weight:700;color:var(--ink,#1F1B16);margin-bottom:6px">Manage plan</div>
        <p id="manage-plan-summary" style="font-size:13.5px;color:var(--graphite,#5C544A);line-height:1.55;margin-bottom:18px"></p>
        <div id="manage-plan-actions" style="display:flex;flex-direction:column;gap:8px"></div>
        <button type="button" id="manage-plan-close" style="margin-top:14px;width:100%;height:36px;background:transparent;border:1px solid var(--rule,#E5DDCD);border-radius:8px;font:inherit;font-size:13px;font-weight:500;cursor:pointer;color:var(--ink,#1F1B16)">Close</button>
      </div>`;
    el.addEventListener('click', (e) => { if (e.target === el) closeManagePlanModal(); });
    document.body.appendChild(el);
    document.getElementById('manage-plan-close').onclick = closeManagePlanModal;
  }

  function closeManagePlanModal() {
    const m = document.getElementById('manage-plan-modal');
    if (m) m.style.display = 'none';
  }

  global.openManagePlan = async function openManagePlan() {
    if (!token()) { notify('Sign in first'); return; }
    closeDropdown();
    ensureManagePlanModal();
    const modal = document.getElementById('manage-plan-modal');
    const summary = document.getElementById('manage-plan-summary');
    const actions = document.getElementById('manage-plan-actions');
    summary.textContent = 'Loading…';
    actions.innerHTML = '';
    modal.style.display = 'flex';

    let d = null;
    try {
      const res = await fetch('/stripe/status', { headers: authHeaders() });
      if (res.ok) d = await res.json();
    } catch { /* ignore */ }

    if (!d) {
      summary.textContent = 'Could not load plan status.';
      return;
    }

    const label = d.status === 'pro' ? planLabel(d.plan_type) : 'Free';
    let detail = label + ' plan';
    if (d.status === 'pro' && d.cancel_at) detail += ' · ends ' + fmtDate(d.cancel_at);
    else if (d.status === 'pro' && d.renews_at) detail += ' · renews ' + fmtDate(d.renews_at);
    if (d.plan_type === 'starter' && d.outlines_limit != null) {
      detail += ` · ${d.outlines_used ?? 0}/${d.outlines_limit} outlines used`;
    }
    summary.textContent = detail;

    function addBtn(text, onClick, primary) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.style.cssText = primary
        ? 'height:40px;border:none;border-radius:8px;background:var(--clay,#B5563A);color:var(--cream,#FBF7EE);font:inherit;font-size:13.5px;font-weight:600;cursor:pointer'
        : 'height:40px;border:1px solid var(--rule,#E5DDCD);border-radius:8px;background:transparent;color:var(--ink,#1F1B16);font:inherit;font-size:13.5px;font-weight:500;cursor:pointer';
      b.onclick = onClick;
      actions.appendChild(b);
    }

    if (d.status !== 'pro') {
      addBtn('Upgrade plan', () => { closeManagePlanModal(); global.location.href = '/#pricing'; }, true);
    } else if (d.cancel_at) {
      addBtn('Reactivate subscription', reactivatePlan, true);
      addBtn('Open billing portal', () => global.openBillingPortal());
    } else {
      addBtn('Upgrade or change plan', () => { closeManagePlanModal(); global.location.href = '/#pricing'; }, true);
      if (d.plan_type !== 'cycle') {
        addBtn('Cancel at period end', cancelPlan);
      }
      addBtn('Open billing portal', () => global.openBillingPortal());
    }
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
      const usageSuffix = d.plan_type === 'starter' && d.outlines_limit != null
        ? ` · ${d.outlines_used ?? 0}/${d.outlines_limit} outlines`
        : (d.status === 'pro' ? ' · Unlimited' : '');
      if (d.status === 'pro' && d.cancel_at) {
        badge.textContent = planLabel(d.plan_type) + usageSuffix + ' · ends ' + fmtDate(d.cancel_at);
        badge.className = 'plan-badge is-canceling';
        if (btn) {
          btn.type = 'button';
          btn.textContent = 'Reactivate';
          btn.style.display = '';
          btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); reactivatePlan(); };
        }
      } else if (d.status === 'pro') {
        badge.textContent = planLabel(d.plan_type) + usageSuffix + (d.renews_at ? ' · renews ' + fmtDate(d.renews_at) : '');
        badge.className = 'plan-badge is-pro';
        if (btn) {
          btn.type = 'button';
          btn.textContent = 'Manage plan';
          btn.style.display = '';
          btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); global.openManagePlan(); };
        }
      } else {
        badge.textContent = 'Free plan';
        badge.className = 'plan-badge';
        if (btn) {
          btn.type = 'button';
          btn.textContent = 'Upgrade';
          btn.style.display = '';
          btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); global.location.href = '/#pricing'; };
        }
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

  function setAvatarLetter(nameOrEmail) {
    const el = document.getElementById('nav-user-btn');
    if (el && nameOrEmail) el.textContent = String(nameOrEmail)[0].toUpperCase();
  }

  function applyUserToUi(user) {
    if (!user) return;
    const display = user.display_name || user.first_name || user.email || user.username || '';
    const email = user.email || user.username || '';
    setAvatarLetter(display || email);
    const dn = document.getElementById('dropdown-username');
    if (dn) dn.textContent = display && email && display !== email ? `${display}` : (display || email);
    const de = document.getElementById('dropdown-email');
    if (de) de.textContent = email;
    const greeting = document.querySelector('.user-dropdown-greeting');
    if (greeting && display && email && display !== email) greeting.textContent = email;
    else if (greeting) greeting.textContent = 'Signed in as';
  }

  async function loadUserProfile() {
    if (!token()) return null;
    try {
      const res = await fetch('/me', { headers: authHeaders() });
      if (!res.ok) return null;
      const user = await res.json();
      applyUserToUi(user);
      return user;
    } catch { return null; }
  }

  function refresh() {
    if (global.NavBar) global.NavBar.sync();
    initThemePicker();
    loadPlanStatus();
    load2FAStatus();
    loadUserProfile();
  }

  global.AccountMenu = {
    token,
    authHeaders,
    refresh,
    setAvatarLetter,
    applyUserToUi,
    loadUserProfile,
    initThemePicker,
    loadPlanStatus,
    load2FAStatus,
    openManagePlan: () => global.openManagePlan(),
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initThemePicker);
  } else {
    initThemePicker();
  }
})(window);
