/* Shared account menu: plan badge, Account Settings popup, billing, soft-delete */
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
  function planLabel(planType) {
    return planType === 'starter' ? 'Starter'
      : planType === 'annual' ? 'Pro Annual'
      : planType === 'cycle' ? 'Cycle Pass'
      : planType === 'monthly' ? 'Pro'
      : 'Pro';
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function setMsg(id, text, ok) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text || '';
    el.style.color = text ? (ok ? 'var(--moss,#5A6E4A)' : 'var(--rust,#8B3A2E)') : '';
  }

  /* ── Theme (lives in Account Settings modal) ── */
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
      global.THEME_PRESETS.forEach((p) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'theme-preset';
        btn.title = p.name;
        btn.style.background = `linear-gradient(135deg,${p.primary} 50%,${p.accent} 50%)`;
        btn.addEventListener('click', () => { global.applyTheme(p); });
        presetsEl.appendChild(btn);
      });
    }
    ['tc-bg', 'tc-font', 'tc-primary', 'tc-accent'].forEach((id) => {
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
    if (!global.syncThemePicker) global.syncThemePicker = syncThemePicker;
    try {
      const saved = localStorage.getItem('scrubbed_theme');
      if (global.syncThemePicker) {
        global.syncThemePicker(saved ? JSON.parse(saved) : global.THEME_DEFAULT);
      }
    } catch { /* ignore */ }
  }

  /* ── Plan badge in dropdown ── */
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
    el.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(31,27,22,0.5);z-index:920;align-items:center;justify-content:center;padding:24px';
    el.innerHTML = `<div style="background:var(--cream,#FBF7EE);border:1px solid var(--rule,#E5DDCD);border-radius:16px;padding:28px;max-width:420px;width:100%;box-shadow:0 16px 48px rgba(31,27,22,0.16)">
      <div style="font-size:17px;font-weight:700;color:var(--ink,#1F1B16);margin-bottom:6px">Manage plan</div>
      <p id="manage-plan-summary" style="font-size:13.5px;color:var(--graphite,#5C544A);line-height:1.55;margin-bottom:18px"></p>
      <div id="manage-plan-actions" style="display:flex;flex-direction:column;gap:8px"></div>
      <button type="button" id="manage-plan-close" style="margin-top:14px;width:100%;height:36px;background:transparent;border:1px solid var(--rule,#E5DDCD);border-radius:8px;font:inherit;font-size:13px;font-weight:500;cursor:pointer">Close</button>
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
    if (!d) { summary.textContent = 'Could not load plan status.'; return; }
    const label = d.status === 'pro' ? planLabel(d.plan_type) : 'Free';
    let detail = label + ' plan';
    if (d.status === 'pro' && d.cancel_at) detail += ' · ends ' + fmtDate(d.cancel_at);
    else if (d.status === 'pro' && d.renews_at) detail += ' · renews ' + fmtDate(d.renews_at);
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
      if (d.plan_type !== 'cycle') addBtn('Cancel at period end', cancelPlan);
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
          btn.type = 'button'; btn.textContent = 'Reactivate'; btn.style.display = '';
          btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); reactivatePlan(); };
        }
      } else if (d.status === 'pro') {
        badge.textContent = planLabel(d.plan_type) + usageSuffix + (d.renews_at ? ' · renews ' + fmtDate(d.renews_at) : '');
        badge.className = 'plan-badge is-pro';
        if (btn) {
          btn.type = 'button'; btn.textContent = 'Manage plan'; btn.style.display = '';
          btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); global.openManagePlan(); };
        }
      } else {
        badge.textContent = 'Free plan';
        badge.className = 'plan-badge';
        if (btn) {
          btn.type = 'button'; btn.textContent = 'Upgrade'; btn.style.display = '';
          btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); global.location.href = '/#pricing'; };
        }
      }
      const planSum = document.getElementById('acct-plan-summary');
      if (planSum) {
        let text = d.status === 'pro' ? planLabel(d.plan_type) : 'Free';
        if (d.status === 'pro' && d.cancel_at) text += ' · ends ' + fmtDate(d.cancel_at);
        else if (d.status === 'pro' && d.renews_at) text += ' · renews ' + fmtDate(d.renews_at);
        planSum.textContent = 'You’re on ' + text;
      }
    } catch { /* ignore */ }
  }

  /* ── 2FA helpers ── */
  async function load2FAStatus() {
    if (!token()) return;
    try {
      const res = await fetch('/auth/2fa-status', { headers: authHeaders() });
      if (!res.ok) return;
      const { two_fa_enabled } = await res.json();
      document.querySelectorAll('#twofa-toggle-label, #acct-twofa-label').forEach((label) => {
        label.textContent = `Two-factor auth: ${two_fa_enabled ? 'On' : 'Off'}`;
      });
    } catch { /* ignore */ }
  }
  global.toggle2FA = function toggle2FA() {
    fetch('/auth/2fa-status', { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(({ two_fa_enabled }) => {
        if (two_fa_enabled) {
          return fetch('/auth/disable-2fa', { method: 'POST', headers: authHeaders() }).then((r) => {
            if (!r.ok) throw new Error();
            load2FAStatus();
            notify('Two-factor authentication turned off.');
          });
        }
        return fetch('/auth/enable-2fa', { method: 'POST', headers: authHeaders() }).then(async (r) => {
          const d = await parseJson(r);
          if (!r.ok) throw new Error(d.error || 'Could not start 2FA setup.');
          global.open2faEnableModal();
        });
      })
      .catch((err) => alert(err?.message || 'Could not update two-factor authentication setting.'));
  };
  function ensure2faModal() {
    if (document.getElementById('twofa-enable-modal')) return;
    const el = document.createElement('div');
    el.id = 'twofa-enable-modal';
    el.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(31,27,22,0.5);z-index:950;align-items:center;justify-content:center;padding:24px';
    el.innerHTML = `<div style="background:var(--cream,#FBF7EE);border:1px solid var(--rule,#E5DDCD);border-radius:16px;padding:32px;max-width:400px;width:100%">
      <div style="font-size:16px;font-weight:700;margin-bottom:10px">Confirm two-factor auth</div>
      <p style="font-size:13.5px;color:var(--graphite,#5C544A);line-height:1.6;margin-bottom:16px">We sent a 6-digit code to your email. Enter it below to turn on two-factor authentication.</p>
      <input type="text" id="twofa-enable-code" placeholder="000000" maxlength="6" inputmode="numeric" autocomplete="one-time-code" style="width:100%;padding:10px 12px;border:1px solid var(--rule,#E5DDCD);border-radius:8px;font:inherit;font-size:20px;letter-spacing:0.2em;text-align:center;margin-bottom:12px;outline:none;box-sizing:border-box"/>
      <p id="twofa-enable-error" style="font-size:12.5px;color:var(--rust,#8B3A2E);min-height:16px;margin-bottom:12px"></p>
      <div style="display:flex;gap:10px">
        <button type="button" id="twofa-enable-cancel" style="flex:1;height:36px;background:transparent;border:1px solid var(--rule,#E5DDCD);border-radius:8px;font:inherit;font-size:13px;cursor:pointer">Cancel</button>
        <button type="button" id="twofa-enable-btn" style="flex:1;height:36px;background:var(--clay,#B5563A);color:var(--cream,#FBF7EE);border:none;border-radius:8px;font:inherit;font-weight:600;font-size:13px;cursor:pointer">Verify &amp; enable</button>
      </div>
    </div>`;
    document.body.appendChild(el);
    document.getElementById('twofa-enable-cancel').onclick = () => global.close2faEnableModal();
    document.getElementById('twofa-enable-btn').onclick = () => global.confirm2faEnable();
  }
  global.open2faEnableModal = function open2faEnableModal() {
    ensure2faModal();
    const m = document.getElementById('twofa-enable-modal');
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
    ensure2faModal();
    const code = document.getElementById('twofa-enable-code').value.trim();
    const errorEl = document.getElementById('twofa-enable-error');
    if (!/^\d{6}$/.test(code)) { errorEl.textContent = 'Enter the 6-digit code from your email.'; return; }
    const btn = document.getElementById('twofa-enable-btn');
    btn.disabled = true; btn.textContent = 'Verifying…';
    fetch('/auth/enable-2fa/confirm', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ code }) })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) throw new Error(d.error || 'Verification failed.');
        load2FAStatus();
        global.close2faEnableModal();
      })
      .catch((err) => { errorEl.textContent = err.message || 'Verification failed.'; })
      .finally(() => { btn.disabled = false; btn.textContent = 'Verify & enable'; });
  };

  /* ── Account Settings modal ── */
  function ensureAccountSettingsModal() {
    if (document.getElementById('account-settings-modal')) return;
    const style = document.createElement('style');
    style.textContent = `
      #account-settings-modal{display:none;position:fixed;inset:0;background:rgba(31,27,22,0.5);z-index:910;align-items:center;justify-content:center;padding:20px;overflow-y:auto}
      #account-settings-modal .as-panel{background:var(--cream,#FBF7EE);border:1px solid var(--rule,#E5DDCD);border-radius:16px;width:100%;max-width:640px;max-height:min(92vh,900px);overflow:auto;box-shadow:0 20px 60px rgba(31,27,22,0.18);margin:auto}
      #account-settings-modal .as-hd{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:22px 24px 14px;border-bottom:1px solid var(--rule,#E5DDCD);position:sticky;top:0;background:var(--cream,#FBF7EE);z-index:1}
      #account-settings-modal .as-hd h2{font-size:18px;font-weight:700;color:var(--ink,#1F1B16);margin:0}
      #account-settings-modal .as-hd p{font-size:12.5px;color:var(--graphite,#5C544A);margin:4px 0 0}
      #account-settings-modal .as-close{border:none;background:transparent;font-size:22px;line-height:1;cursor:pointer;color:var(--stone,#A89C8A);padding:0 4px}
      #account-settings-modal .as-body{padding:18px 24px 24px;display:flex;flex-direction:column;gap:14px}
      #account-settings-modal .as-card{border:1px solid var(--rule,#E5DDCD);border-radius:12px;padding:16px 18px;background:var(--paper,#F6F1E8)}
      #account-settings-modal .as-card h3{font-size:14px;font-weight:600;margin:0 0 4px;color:var(--ink,#1F1B16)}
      #account-settings-modal .as-card .as-help{font-size:12.5px;color:var(--graphite,#5C544A);line-height:1.45;margin:0 0 12px}
      #account-settings-modal .as-field{margin-bottom:10px}
      #account-settings-modal .as-field label{display:block;font-size:11.5px;font-weight:500;color:var(--stone,#A89C8A);margin-bottom:5px}
      #account-settings-modal .as-field input{width:100%;height:38px;padding:0 12px;border:1px solid var(--rule,#E5DDCD);border-radius:8px;background:var(--cream,#FBF7EE);font:inherit;font-size:13.5px;box-sizing:border-box;color:var(--ink,#1F1B16)}
      #account-settings-modal .as-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}
      #account-settings-modal .as-msg{font-size:12.5px;min-height:16px;margin-top:8px}
      #account-settings-modal .as-btn{display:inline-flex;align-items:center;justify-content:center;height:36px;padding:0 14px;border-radius:8px;font:inherit;font-size:13px;font-weight:500;cursor:pointer;border:none;text-decoration:none}
      #account-settings-modal .as-btn-primary{background:var(--clay,#B5563A);color:var(--cream,#FBF7EE)}
      #account-settings-modal .as-btn-secondary{background:transparent;border:1px solid var(--rule,#E5DDCD);color:var(--ink,#1F1B16)}
      #account-settings-modal .as-btn-danger{background:transparent;border:1px solid rgba(139,58,46,0.35);color:var(--rust,#8B3A2E)}
      #account-settings-modal .as-banner{padding:12px 14px;border-radius:10px;background:rgba(181,86,58,0.08);border:1px solid rgba(181,86,58,0.22);font-size:13px;color:var(--ink,#1F1B16);line-height:1.5}
      #account-settings-modal .theme-presets{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px}
      #account-settings-modal .theme-preset{width:28px;height:28px;border-radius:8px;border:2px solid transparent;cursor:pointer;padding:0}
      #account-settings-modal .theme-preset.active{border-color:var(--ink,#1F1B16)}
      #account-settings-modal .theme-custom-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      #account-settings-modal .theme-color-row{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;color:var(--graphite,#5C544A)}
      #account-settings-modal .tc-input{width:36px;height:28px;border:none;background:transparent;cursor:pointer;padding:0}
    `;
    document.head.appendChild(style);

    const el = document.createElement('div');
    el.id = 'account-settings-modal';
    el.innerHTML = `
      <div class="as-panel" role="dialog" aria-modal="true" aria-labelledby="as-title">
        <div class="as-hd">
          <div>
            <h2 id="as-title">Account settings</h2>
            <p>Profile, security, appearance, billing &amp; data</p>
          </div>
          <button type="button" class="as-close" id="as-close" aria-label="Close">&times;</button>
        </div>
        <div class="as-body">
          <div class="as-banner" id="as-deletion-banner" style="display:none"></div>

          <div class="as-card">
            <h3>Display name</h3>
            <p class="as-help">Shown on your dashboard instead of your email.</p>
            <div class="as-field"><label for="acct-first-name">First name</label><input id="acct-first-name" type="text" autocomplete="given-name" maxlength="80" placeholder="Alex"/></div>
            <div class="as-actions"><button type="button" class="as-btn as-btn-primary" id="acct-save-name">Save name</button></div>
            <div class="as-msg" id="acct-name-msg"></div>
          </div>

          <div class="as-card">
            <h3>Email</h3>
            <p class="as-help">Requires two-factor auth. We’ll email a code to your current address.</p>
            <div class="as-field"><label for="acct-email-current">Current email</label><input id="acct-email-current" type="email" disabled/></div>
            <div class="as-field"><label for="acct-email-new">New email</label><input id="acct-email-new" type="email" autocomplete="email" placeholder="new@email.com"/></div>
            <div class="as-field" id="acct-email-code-wrap" style="display:none"><label for="acct-email-code">Verification code</label><input id="acct-email-code" type="text" inputmode="numeric" maxlength="6" placeholder="000000" autocomplete="one-time-code"/></div>
            <div class="as-actions">
              <button type="button" class="as-btn as-btn-primary" id="acct-email-request">Send code</button>
              <button type="button" class="as-btn as-btn-secondary" id="acct-email-confirm" style="display:none">Confirm change</button>
            </div>
            <div class="as-msg" id="acct-email-msg"></div>
          </div>

          <div class="as-card">
            <h3>Password</h3>
            <p class="as-help">Requires two-factor auth. We’ll email a code before the password updates.</p>
            <div class="as-field"><label for="acct-pw-current">Current password</label><input id="acct-pw-current" type="password" autocomplete="current-password"/></div>
            <div class="as-field"><label for="acct-pw-new">New password</label><input id="acct-pw-new" type="password" autocomplete="new-password"/></div>
            <div class="as-field" id="acct-pw-code-wrap" style="display:none"><label for="acct-pw-code">Verification code</label><input id="acct-pw-code" type="text" inputmode="numeric" maxlength="6" placeholder="000000" autocomplete="one-time-code"/></div>
            <div class="as-actions">
              <button type="button" class="as-btn as-btn-primary" id="acct-pw-request">Send code</button>
              <button type="button" class="as-btn as-btn-secondary" id="acct-pw-confirm" style="display:none">Confirm new password</button>
            </div>
            <div class="as-msg" id="acct-pw-msg"></div>
          </div>

          <div class="as-card">
            <h3>Security</h3>
            <p class="as-help">Email codes for sign-in and sensitive account changes.</p>
            <div class="as-actions">
              <button type="button" class="as-btn as-btn-secondary" id="acct-twofa-btn"><span id="acct-twofa-label">Two-factor auth: —</span></button>
            </div>
          </div>

          <div class="as-card">
            <h3>Appearance</h3>
            <p class="as-help">Theme presets and custom colors for Scrubbed.</p>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
              <span style="font-size:11.5px;color:var(--stone,#A89C8A);text-transform:uppercase;letter-spacing:0.06em">Presets</span>
              <button type="button" class="as-btn as-btn-secondary" id="theme-reset" style="height:28px;font-size:12px">Reset</button>
            </div>
            <div class="theme-presets" id="theme-presets"></div>
            <div class="theme-custom-grid">
              <div class="theme-color-row"><label class="tc-label">Background</label><input type="color" class="tc-input" id="tc-bg"/></div>
              <div class="theme-color-row"><label class="tc-label">Text</label><input type="color" class="tc-input" id="tc-font"/></div>
              <div class="theme-color-row"><label class="tc-label">Primary</label><input type="color" class="tc-input" id="tc-primary"/></div>
              <div class="theme-color-row"><label class="tc-label">Accent</label><input type="color" class="tc-input" id="tc-accent"/></div>
            </div>
          </div>

          <div class="as-card">
            <h3>Plan &amp; billing</h3>
            <p class="as-help" id="acct-plan-summary">Loading plan…</p>
            <div class="as-actions">
              <button type="button" class="as-btn as-btn-primary" id="acct-manage-plan">Manage plan</button>
              <a class="as-btn as-btn-secondary" href="/#pricing">View pricing</a>
            </div>
          </div>

          <div class="as-card">
            <h3>Export your data</h3>
            <p class="as-help">Download a JSON export of your vault files, schools, and letter writers.</p>
            <div class="as-actions"><button type="button" class="as-btn as-btn-secondary" id="acct-export-data">Download export</button></div>
            <div class="as-msg" id="acct-export-msg"></div>
          </div>

          <div class="as-card">
            <h3>Delete account</h3>
            <p class="as-help">Schedules deletion in <strong>30 days</strong>. You keep full access and can export anytime. Cancel anytime before the date.</p>
            <div class="as-actions" id="acct-delete-actions">
              <button type="button" class="as-btn as-btn-danger" id="acct-delete-open">Schedule deletion…</button>
            </div>
            <div class="as-msg" id="acct-delete-msg"></div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', (e) => { if (e.target === el) closeAccountSettings(); });
    document.getElementById('as-close').onclick = closeAccountSettings;
    bindAccountSettingsForms();
  }

  function closeAccountSettings() {
    const m = document.getElementById('account-settings-modal');
    if (m) m.style.display = 'none';
  }

  function updateDeletionBanner(user) {
    const banner = document.getElementById('as-deletion-banner');
    const actions = document.getElementById('acct-delete-actions');
    if (!banner) return;
    if (user?.deletion_scheduled_at) {
      banner.style.display = '';
      banner.innerHTML = `This account is scheduled for permanent deletion on <strong>${fmtDate(user.deletion_scheduled_at)}</strong>. You can keep using Scrubbed and export your data until then.`;
      if (actions) {
        actions.innerHTML = `<button type="button" class="as-btn as-btn-primary" id="acct-cancel-deletion">Keep my account</button>`;
        document.getElementById('acct-cancel-deletion').onclick = cancelScheduledDeletion;
      }
    } else {
      banner.style.display = 'none';
      if (actions && !document.getElementById('acct-delete-open')) {
        actions.innerHTML = `<button type="button" class="as-btn as-btn-danger" id="acct-delete-open">Schedule deletion…</button>`;
        document.getElementById('acct-delete-open').onclick = () => global.openDeleteModal();
      }
    }
  }

  async function cancelScheduledDeletion() {
    try {
      const res = await fetch('/auth/account/cancel-deletion', { method: 'POST', headers: authHeaders() });
      const d = await res.json();
      if (!res.ok) { setMsg('acct-delete-msg', d.error || 'Could not cancel.'); return; }
      setMsg('acct-delete-msg', d.message || 'Deletion canceled.', true);
      const user = await loadUserProfile();
      updateDeletionBanner(user);
      ensureDeletionBannerOnPage(user);
    } catch { setMsg('acct-delete-msg', 'Could not cancel deletion.'); }
  }

  function ensureDeletionBannerOnPage(user) {
    let bar = document.getElementById('deletion-grace-banner');
    if (!user?.deletion_scheduled_at) {
      if (bar) bar.remove();
      return;
    }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'deletion-grace-banner';
      bar.style.cssText = 'position:sticky;top:60px;z-index:250;background:#F4E4DC;border-bottom:1px solid rgba(181,86,58,0.25);padding:10px 16px;font-size:13px;color:#1F1B16;text-align:center;line-height:1.45';
      document.body.prepend(bar);
    }
    bar.innerHTML = `Account deletion scheduled for <strong>${fmtDate(user.deletion_scheduled_at)}</strong>. <button type="button" id="grace-open-settings" style="background:none;border:none;color:var(--clay,#B5563A);font:inherit;font-weight:600;cursor:pointer;text-decoration:underline;padding:0">Account settings</button> to export data or cancel.`;
    const btn = document.getElementById('grace-open-settings');
    if (btn) btn.onclick = () => global.openAccountSettings();
  }

  global.openAccountSettings = async function openAccountSettings() {
    if (!token()) { notify('Sign in first'); return; }
    closeDropdown();
    ensureAccountSettingsModal();
    ensure2faModal();
    const modal = document.getElementById('account-settings-modal');
    modal.style.display = 'flex';
    initThemePicker();
    load2FAStatus();
    loadPlanStatus();
    const user = await loadUserProfile();
    if (user) {
      const nameEl = document.getElementById('acct-first-name');
      const emailEl = document.getElementById('acct-email-current');
      if (nameEl) nameEl.value = user.first_name || '';
      if (emailEl) emailEl.value = user.email || user.username || '';
      updateDeletionBanner(user);
    }
  };

  /* ── Soft-delete confirm modal ── */
  function ensureDeleteModal() {
    let el = document.getElementById('delete-account-modal');
    const markup = `<div style="background:var(--cream,#FBF7EE);border:1px solid var(--rule,#E5DDCD);border-radius:16px;padding:28px;max-width:440px;width:100%">
      <div style="font-size:16px;font-weight:700;margin-bottom:10px;color:var(--ink,#1F1B16)">Schedule account deletion</div>
      <p style="font-size:13.5px;color:var(--graphite,#5C544A);line-height:1.6;margin-bottom:12px">Your account stays active for <strong>30 days</strong>. You can keep using Scrubbed and export all your data. After 30 days, everything is permanently deleted.</p>
      <p style="font-size:13.5px;color:var(--graphite,#5C544A);margin-bottom:14px">Type <strong>DELETE</strong> to confirm.</p>
      <input type="text" id="delete-confirm-input" placeholder="Type DELETE here" style="width:100%;padding:10px 12px;border:1px solid var(--rule,#E5DDCD);border-radius:8px;font:inherit;font-size:14px;margin-bottom:14px;outline:none;box-sizing:border-box"/>
      <p id="delete-account-error" style="font-size:12.5px;color:var(--rust,#8B3A2E);min-height:16px;margin-bottom:12px"></p>
      <div style="display:flex;gap:10px">
        <button type="button" id="delete-cancel-btn" style="flex:1;height:36px;background:transparent;border:1px solid var(--rule,#E5DDCD);border-radius:8px;font:inherit;font-size:13px;cursor:pointer">Cancel</button>
        <button type="button" id="delete-confirm-btn" style="flex:1;height:36px;background:var(--rust,#8B3A2E);color:#FBF7EE;border:none;border-radius:8px;font:inherit;font-weight:600;font-size:13px;cursor:pointer">Schedule deletion</button>
      </div>
    </div>`;
    if (!el) {
      el = document.createElement('div');
      el.id = 'delete-account-modal';
      document.body.appendChild(el);
    }
    el.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(31,27,22,0.5);z-index:960;align-items:center;justify-content:center;padding:24px';
    if (!el.dataset.softDelete) {
      el.dataset.softDelete = '1';
      el.innerHTML = markup;
      document.getElementById('delete-cancel-btn').onclick = () => global.closeDeleteModal();
      document.getElementById('delete-confirm-btn').onclick = () => global.confirmDeleteAccount();
    }
  }
  global.openDeleteModal = function openDeleteModal() {
    closeDropdown();
    ensureDeleteModal();
    const modal = document.getElementById('delete-account-modal');
    modal.style.display = 'flex';
    document.getElementById('delete-confirm-input').value = '';
    document.getElementById('delete-account-error').textContent = '';
  };
  global.closeDeleteModal = function closeDeleteModal() {
    const modal = document.getElementById('delete-account-modal');
    if (modal) modal.style.display = 'none';
  };
  global.confirmDeleteAccount = function confirmDeleteAccount() {
    ensureDeleteModal();
    const input = document.getElementById('delete-confirm-input').value.trim();
    const errorEl = document.getElementById('delete-account-error');
    if (input !== 'DELETE') { errorEl.textContent = 'Please type DELETE to confirm.'; return; }
    const btn = document.getElementById('delete-confirm-btn');
    btn.disabled = true;
    fetch('/auth/account/delete', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ confirm: 'DELETE' }),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) throw new Error(d.error || 'Could not schedule deletion.');
        global.closeDeleteModal();
        notify(d.message || 'Deletion scheduled for 30 days from now.');
        loadUserProfile().then((user) => {
          updateDeletionBanner(user);
          ensureDeletionBannerOnPage(user);
          setMsg('acct-delete-msg', 'Scheduled for ' + fmtDate(d.deletion_scheduled_at) + '.', true);
        });
      })
      .catch((err) => { errorEl.textContent = err.message || 'Could not schedule deletion.'; })
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
    if (dn) dn.textContent = display || email;
    const greeting = document.querySelector('.user-dropdown-greeting');
    if (greeting && display && email && display !== email) greeting.textContent = email;
    else if (greeting) greeting.textContent = 'Signed in as';
    const title = document.getElementById('dash-title');
    if (title && display) title.textContent = display + "'s cycle";
    const nameEl = document.getElementById('acct-first-name');
    if (nameEl && document.activeElement !== nameEl) {
      nameEl.value = user.first_name || '';
    }
    const emailEl = document.getElementById('acct-email-current');
    if (emailEl && email) emailEl.value = email;
    ensureDeletionBannerOnPage(user);
    try {
      global.dispatchEvent(new CustomEvent('scrubbed:user', { detail: user }));
    } catch { /* ignore */ }
  }

  async function parseJson(res) {
    const text = await res.text();
    try { return text ? JSON.parse(text) : {}; }
    catch { return { error: text || 'Unexpected server response.' }; }
  }

  function bindAccountSettingsForms() {
    const saveName = document.getElementById('acct-save-name');
    if (saveName && !saveName.dataset.bound) {
      saveName.dataset.bound = '1';
      const saveDisplayName = async () => {
        const first_name = document.getElementById('acct-first-name').value.trim();
        setMsg('acct-name-msg', '');
        if (!first_name) { setMsg('acct-name-msg', 'Enter a first name.'); return; }
        saveName.disabled = true;
        try {
          const res = await fetch('/auth/display-name', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ first_name }),
          });
          const d = await parseJson(res);
          if (!res.ok) { setMsg('acct-name-msg', d.error || 'Could not save.'); return; }
          if (!d.user) {
            setMsg('acct-name-msg', 'Saved, but profile did not return. Refreshing…', true);
            const user = await loadUserProfile();
            if (user) applyUserToUi(user);
          } else {
            applyUserToUi(d.user);
          }
          setMsg('acct-name-msg', 'Name updated.', true);
        } catch {
          setMsg('acct-name-msg', 'Could not save.');
        } finally {
          saveName.disabled = false;
        }
      };
      saveName.onclick = saveDisplayName;
      const nameInput = document.getElementById('acct-first-name');
      if (nameInput && !nameInput.dataset.bound) {
        nameInput.dataset.bound = '1';
        nameInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); saveDisplayName(); }
        });
      }
    }

    const emailReq = document.getElementById('acct-email-request');
    if (emailReq && !emailReq.dataset.bound) {
      emailReq.dataset.bound = '1';
      emailReq.onclick = async () => {
        const new_email = document.getElementById('acct-email-new').value.trim();
        setMsg('acct-email-msg', '');
        try {
          const res = await fetch('/auth/change-email/request', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ new_email }) });
          const d = await parseJson(res);
          if (!res.ok) {
            setMsg('acct-email-msg', d.error || 'Could not send code.');
            return;
          }
          document.getElementById('acct-email-code-wrap').style.display = '';
          document.getElementById('acct-email-confirm').style.display = '';
          setMsg('acct-email-msg', d.message || 'Code sent to your current email.', true);
        } catch { setMsg('acct-email-msg', 'Could not send code.'); }
      };
    }
    const emailConf = document.getElementById('acct-email-confirm');
    if (emailConf && !emailConf.dataset.bound) {
      emailConf.dataset.bound = '1';
      emailConf.onclick = async () => {
        const code = document.getElementById('acct-email-code').value.trim();
        setMsg('acct-email-msg', '');
        try {
          const res = await fetch('/auth/change-email/confirm', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ code }) });
          const d = await parseJson(res);
          if (!res.ok) { setMsg('acct-email-msg', d.error || 'Could not update email.'); return; }
          setMsg('acct-email-msg', 'Email updated. Use your new email next time you sign in.', true);
          document.getElementById('acct-email-current').value = d.user?.email || '';
          document.getElementById('acct-email-new').value = '';
          document.getElementById('acct-email-code').value = '';
          document.getElementById('acct-email-code-wrap').style.display = 'none';
          emailConf.style.display = 'none';
          if (d.user) applyUserToUi(d.user);
        } catch { setMsg('acct-email-msg', 'Could not update email.'); }
      };
    }

    const pwReq = document.getElementById('acct-pw-request');
    if (pwReq && !pwReq.dataset.bound) {
      pwReq.dataset.bound = '1';
      pwReq.onclick = async () => {
        const current_password = document.getElementById('acct-pw-current').value;
        setMsg('acct-pw-msg', '');
        try {
          const res = await fetch('/auth/change-password/request', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ current_password }) });
          const d = await parseJson(res);
          if (!res.ok) { setMsg('acct-pw-msg', d.error || 'Could not send code.'); return; }
          document.getElementById('acct-pw-code-wrap').style.display = '';
          document.getElementById('acct-pw-confirm').style.display = '';
          setMsg('acct-pw-msg', d.message || 'Code sent to your email.', true);
        } catch { setMsg('acct-pw-msg', 'Could not send code.'); }
      };
    }
    const pwConf = document.getElementById('acct-pw-confirm');
    if (pwConf && !pwConf.dataset.bound) {
      pwConf.dataset.bound = '1';
      pwConf.onclick = async () => {
        const current_password = document.getElementById('acct-pw-current').value;
        const new_password = document.getElementById('acct-pw-new').value;
        const code = document.getElementById('acct-pw-code').value.trim();
        setMsg('acct-pw-msg', '');
        try {
          const res = await fetch('/auth/change-password/confirm', {
            method: 'POST', headers: authHeaders(),
            body: JSON.stringify({ current_password, new_password, code }),
          });
          const d = await parseJson(res);
          if (!res.ok) { setMsg('acct-pw-msg', d.error || 'Could not update password.'); return; }
          setMsg('acct-pw-msg', 'Password updated.', true);
          document.getElementById('acct-pw-current').value = '';
          document.getElementById('acct-pw-new').value = '';
          document.getElementById('acct-pw-code').value = '';
          document.getElementById('acct-pw-code-wrap').style.display = 'none';
          pwConf.style.display = 'none';
        } catch { setMsg('acct-pw-msg', 'Could not update password.'); }
      };
    }

    const twofaBtn = document.getElementById('acct-twofa-btn');
    if (twofaBtn && !twofaBtn.dataset.bound) {
      twofaBtn.dataset.bound = '1';
      twofaBtn.onclick = () => global.toggle2FA();
    }
    const managePlan = document.getElementById('acct-manage-plan');
    if (managePlan && !managePlan.dataset.bound) {
      managePlan.dataset.bound = '1';
      managePlan.onclick = () => global.openManagePlan();
    }
    const exportBtn = document.getElementById('acct-export-data');
    if (exportBtn && !exportBtn.dataset.bound) {
      exportBtn.dataset.bound = '1';
      exportBtn.onclick = async () => {
        setMsg('acct-export-msg', 'Preparing export…', true);
        try {
          const res = await fetch('/auth/export', { headers: authHeaders() });
          if (!res.ok) {
            const d = await parseJson(res);
            setMsg('acct-export-msg', d.error || 'Export failed.');
            return;
          }
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'scrubbed-export.json';
          a.click();
          URL.revokeObjectURL(url);
          setMsg('acct-export-msg', 'Download started.', true);
        } catch { setMsg('acct-export-msg', 'Export failed.'); }
      };
    }
    const delOpen = document.getElementById('acct-delete-open');
    if (delOpen && !delOpen.dataset.bound) {
      delOpen.dataset.bound = '1';
      delOpen.onclick = () => global.openDeleteModal();
    }
  }

  async function loadUserProfile() {
    if (!token()) return null;
    try {
      const res = await fetch('/me', { headers: authHeaders() });
      if (res.status === 401) {
        const d = await parseJson(res);
        if (d.account_deleted) {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(REFRESH_KEY);
        }
        return null;
      }
      if (!res.ok) return null;
      const user = await parseJson(res);
      applyUserToUi(user);
      return user;
    } catch { return null; }
  }

  function wireAccountSettingsLinks() {
    document.querySelectorAll('[data-account-settings], #account-settings-link, a[href="/dashboard#account"], a[href="#account"]').forEach((el) => {
      if (el.dataset.asWired) return;
      el.dataset.asWired = '1';
      el.addEventListener('click', (e) => {
        e.preventDefault();
        global.openAccountSettings();
      });
    });
  }

  function refresh() {
    if (global.NavBar) global.NavBar.sync();
    wireAccountSettingsLinks();
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
    openAccountSettings: () => global.openAccountSettings(),
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      wireAccountSettingsLinks();
    });
  } else {
    wireAccountSettingsLinks();
  }
})(window);
