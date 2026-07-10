#!/usr/bin/env node
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');

const BASE = process.env.APP_URL || 'http://localhost:3000';
const ROOT = path.join(__dirname, '..');

async function req(method, urlPath, { body, token, expectStatus } = {}) {
  const headers = { Accept: 'text/html,application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + urlPath, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') || '';
  let data = null;
  if (ct.includes('application/json')) {
    try { data = await res.json(); } catch { data = null; }
  } else {
    data = await res.text();
  }
  return { ok: expectStatus ? res.status === expectStatus : res.ok, status: res.status, data, path: urlPath };
}

function assert(name, cond, detail = '') {
  if (cond) {
    console.log(`  ✓ ${name}`);
    return true;
  }
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  return false;
}

function domIds(html, ids) {
  let ok = true;
  for (const id of ids) {
    const found = new RegExp(`id=["']${id}["']`).test(html);
    if (!found) {
      console.error(`  ✗ missing #${id}`);
      ok = false;
    }
  }
  if (ok) console.log(`  ✓ all ${ids.length} required DOM ids present`);
  return ok;
}

function testImportHelpers() {
  const FILE_EXT_BY_MIME = {
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/pdf': 'pdf',
  };
  function getFileExt(file) {
    const parts = String(file.name || '').split('.');
    const fromName = parts.length > 1 ? parts.pop().toLowerCase() : '';
    if (fromName && ['xlsx', 'xls', 'csv', 'tsv', 'docx', 'pdf'].includes(fromName)) return fromName;
    return FILE_EXT_BY_MIME[file.type] || fromName;
  }
  function jsonSafeCell(v) {
    if (v == null || v === '') return '';
    if (v instanceof Date) return `${v.getMonth() + 1}/${v.getDate()}/${v.getFullYear()}`;
    if (typeof v === 'object') return String(v);
    return String(v);
  }
  let ok = true;
  ok = assert('getFileExt reads .xlsx filename', getFileExt({ name: 'log.xlsx', type: '' }) === 'xlsx') && ok;
  ok = assert('getFileExt uses MIME fallback', getFileExt({ name: 'upload', type: 'application/pdf' }) === 'pdf') && ok;
  ok = assert('jsonSafeCell stringifies Date', jsonSafeCell(new Date(2024, 0, 15)) === '1/15/2024') && ok;
  ok = assert('jsonSafeCell keeps text', jsonSafeCell('hello') === 'hello') && ok;
  return ok;
}

async function testXlsxRoundTrip() {
  let XLSX;
  try {
    XLSX = require('xlsx');
  } catch {
    console.log('  ⊘ xlsx package not installed — skip spreadsheet round-trip');
    return true;
  }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['Date', 'Institution / Department', 'Hours'],
    [46008, 'St. Mary', 0.15972222],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'Log');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const read = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true });
  const data = XLSX.utils.sheet_to_json(read.Sheets[read.SheetNames[0]], { header: 1, defval: '', raw: true });
  return assert('xlsx write/read round-trip', data.length === 2 && data[0][0] === 'Date');
}

async function main() {
  console.log(`Smoke test @ ${BASE}\n`);
  let pass = 0;
  let fail = 0;
  const check = (n, c, d) => { if (assert(n, c, d)) pass++; else fail++; };

  // ── Static pages & assets ──
  console.log('Static routes');
  for (const [p, needle] of [
    ['/vault', 'The Vault'],
    ['/secondaries', 'Secondary'],
    ['/app.js', 'React'],
    ['/theme.js', 'THEME'],
    ['/account-menu.js', 'AccountMenu'],
    ['/navbar.js', 'NavBar'],
  ]) {
    const r = await req('GET', p);
    check(`GET ${p}`, r.ok && String(r.data).includes(needle), `status ${r.status}`);
  }
  const blocked = await req('GET', '/server.js');
  check('GET /server.js not exposed', blocked.status === 404 || !String(blocked.data).includes('express'), `status ${blocked.status}`);

  // ── Public API ──
  console.log('\nPublic API');
  const schools = await req('GET', '/schools');
  check('GET /schools', schools.ok && Array.isArray(schools.data) && schools.data.length > 0,
    `got ${Array.isArray(schools.data) ? schools.data.length : 0} schools`);
  if (Array.isArray(schools.data) && schools.data[0]) {
    check('School has slug + prompts', !!(schools.data[0].slug && Array.isArray(schools.data[0].prompts)));
  }

  // ── Auth-gated API ──
  console.log('\nAuth protection');
  for (const p of ['/files', '/outlines', '/me', '/vault/readiness']) {
    const r = await req('GET', p, { expectStatus: 401 });
    check(`GET ${p} requires auth`, r.status === 401, `status ${r.status}`);
  }
  const gen = await req('POST', '/outlines/generate', { body: {}, expectStatus: 401 });
  check('POST /outlines/generate requires auth', gen.status === 401, `status ${gen.status}`);
  const del = await req('DELETE', '/outlines/00000000-0000-0000-0000-000000000000', { expectStatus: 401 });
  check('DELETE /outlines/:id route exists', del.status === 401, `status ${del.status}`);

  // ── Vault DOM ──
  console.log('\nVault DOM');
  const vaultHtml = fs.readFileSync(path.join(ROOT, 'vault.html'), 'utf8');
  if (domIds(vaultHtml, [
    'vault-upload-zone', 'vault-file-input', 'vault-file-input-nav', 'cn-file-input',
    'cn-overlay', 'modal-overlay', 'vault-files-grid', 'user-dropdown', 'plan-badge',
    'twofa-enable-modal', 'delete-account-modal', 'nature-canvas',
  ])) pass++; else fail++;

  // ── Secondaries DOM ──
  console.log('\nSecondaries DOM');
  const secHtml = fs.readFileSync(path.join(ROOT, 'secondaries.html'), 'utf8');
  if (domIds(secHtml, [
    'schools-grid', 'outlines-grid', 'outlines-empty', 'outline-modal',
    'user-dropdown', 'plan-badge', 'twofa-enable-modal', 'delete-account-modal',
    'filter-pills', 'modal-regen-btn', 'readiness-card', 'usage-card', 'status-row',
  ])) pass++; else fail++;

  // ── Vault/secondaries script symbols ──
  console.log('\nClient function wiring');
  for (const [file, fns] of [
    ['vault.html', ['handleFiles', 'uploadFile', 'importTemplateFile', 'openFileForEdit', 'convertReadOnlyPdf', 'parseSpreadsheetWorkbook']],
    ['secondaries.html', ['generateOutline', 'deleteOutline', 'regenerateOutline', 'loadOutlines', 'loadSchools', 'loadVaultReadiness', 'updateGates']],
  ]) {
    const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const fn of fns) {
      check(`${file} defines ${fn}`, html.includes(`${fn}`));
    }
  }
  check('secondaries delete uses /outlines/', secHtml.includes("fetch('/outlines/' + id"));
  check('secondaries has Starter checkout', secHtml.includes("startCheckout('starter')"));

  // ── Vault readiness module ──
  console.log('\nVault readiness & plan limits');
  const { assessVaultReadiness } = require('../lib/vault-readiness');
  const { getPlanLimits } = require('../lib/plan-limits');
  const empty = assessVaultReadiness([]);
  check('assessVaultReadiness empty vault', empty.ready === false && Array.isArray(empty.missing));
  const ready = assessVaultReadiness([
    { template_id: 'clinical-hours', name: 'Clinical', content: { rows: [['a'], ['b'], ['c']] } },
    { template_id: 'volunteer-hours', name: 'Volunteer', content: { rows: [['x']] } },
  ]);
  check('assessVaultReadiness populated vault', ready.ready === true && ready.score > 0);
  check('starter plan limit 10/mo', getPlanLimits('starter').outlines_per_month === 10);
  check('starter free regens 3', require('../lib/generation-caps').STARTER_FREE_REGENS === 3);
  check('pro soft cap 150', require('../lib/generation-caps').PRO_SOFT_CAP === 150);
  check('pro monthly unlimited hard cap', getPlanLimits('monthly').outlines_per_month === null);

  console.log('\nNavbar consistency');
  for (const [file, html] of [
    ['vault.html', vaultHtml],
    ['secondaries.html', secHtml],
    ['dashboard.html', fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8')],
  ]) {
    check(`${file} nav has Vault + Dashboard`, html.includes('data-nav="vault"') && html.includes('data-nav="dashboard"'));
    check(`${file} Secondary AI is auth-gated`, html.includes('nav-auth-only') && html.includes('data-nav="secondaries"'));
    check(`${file} nav omits Pricing`, !html.match(/class="nav-link"[^>]*>Pricing</));
    check(`${file} loads navbar.js`, html.includes('navbar.js'));
  }

  console.log('\nCycle tools API');
  const amcas = await req('GET', '/tools/amcas-limits');
  check('GET /tools/amcas-limits', amcas.ok && amcas.data?.limits?.personal_statement?.max_chars === 5300);
  const dashboardPage = await req('GET', '/dashboard');
  check('GET /dashboard', dashboardPage.ok && String(dashboardPage.data).includes('Application pipeline'));
  const cycleRedirect = await req('GET', '/cycle');
  check('GET /cycle redirects to dashboard', cycleRedirect.status === 301 || (cycleRedirect.ok && String(cycleRedirect.data).includes('Your dashboard')));
  const tr = await req('GET', '/tracker', { expectStatus: 401 });
  check('GET /tracker requires auth', tr.status === 401);

  // ── Import helpers ──
  console.log('\nVault import helpers');
  if (testImportHelpers()) pass++; else fail++;
  if (await testXlsxRoundTrip()) pass++; else fail++;

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) {
    console.log('\nTip: start the server first — PORT=3001 node server.js');
    console.log('     APP_URL=http://localhost:3001 node scripts/smoke-test.js');
  }
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
