'use strict';

/** Competitive / standout hour targets — aligned with vault.html TEMPLATE_PROGRESS */
const HOUR_SECTIONS = [
  { id: 'clinical', label: 'Clinical', templateIds: ['clinical-hours'], hoursIdx: 4, targetHours: 450, color: '#5A6E4A' },
  { id: 'volunteer', label: 'Volunteer', templateIds: ['volunteer-hours'], hoursIdx: 4, targetHours: 350, color: '#7A9E6A' },
  { id: 'shadowing', label: 'Shadowing', templateIds: ['shadowing-log'], hoursIdx: 5, targetHours: 120, color: '#3D5A35' },
  { id: 'research', label: 'Research', templateIds: ['research-log'], hoursIdx: 4, targetHours: 1000, color: '#B5563A' },
  { id: 'employment', label: 'Employment', templateIds: ['employment-record'], hoursIdx: 5, targetHours: 3500, color: '#8B3A2E' },
];

const DOC_TEMPLATES = new Set([
  'personal-statement',
  'recommendation-letter',
  'activity-description',
  'secondary-essay',
]);

function parseHours(val) {
  const s = String(val || '').trim();
  if (!s) return 0;
  const hm = s.match(/^(\d+):(\d{1,2})$/);
  if (hm) return parseInt(hm[1], 10) + parseInt(hm[2], 10) / 60;
  const n = parseFloat(s.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function filledRows(content) {
  const rows = content?.rows;
  if (!Array.isArray(rows)) return 0;
  return rows.filter((row) => {
    if (!row) return false;
    if (Array.isArray(row)) return row.some((c) => String(c ?? '').trim());
    if (typeof row === 'object') return Object.values(row).some((v) => String(v ?? '').trim());
    return String(row).trim().length > 0;
  }).length;
}

function sumHoursFromFile(file, hoursIdx) {
  const content = file?.content || {};
  if (content.pdf && !Array.isArray(content.rows)) return { hours: 0, entries: 0 };
  const rows = Array.isArray(content.rows) ? content.rows : [];
  let hours = 0;
  let entries = 0;
  for (const row of rows) {
    if (!Array.isArray(row) || !row.some((c) => String(c ?? '').trim())) continue;
    entries += 1;
    hours += parseHours(row[hoursIdx]);
  }
  return { hours, entries };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * Aggregate vault hour + file stats for the dashboard.
 * @param {Array} files
 */
function assessVaultStats(files) {
  const vaultFiles = (files || []).filter((f) => f && f.template_id !== 'secondary-outline');

  const sections = HOUR_SECTIONS.map((sec) => {
    const matching = vaultFiles.filter((f) => sec.templateIds.includes(f.template_id));
    let hours = 0;
    let entries = 0;
    let fileCount = 0;
    for (const f of matching) {
      const content = f.content || {};
      if (content.pdf && !Array.isArray(content.rows)) {
        fileCount += 1;
        continue;
      }
      const { hours: h, entries: e } = sumHoursFromFile(f, sec.hoursIdx);
      if (e > 0 || h > 0 || filledRows(content) > 0) fileCount += 1;
      hours += h;
      entries += e;
    }
    const target = sec.targetHours;
    const pct = target > 0 ? Math.min(100, Math.round((hours / target) * 100)) : 0;
    return {
      id: sec.id,
      label: sec.label,
      hours: round1(hours),
      entries,
      files: fileCount,
      targetHours: target,
      pct,
      color: sec.color,
    };
  });

  const totalHours = round1(sections.reduce((s, x) => s + x.hours, 0));
  const totalEntries = sections.reduce((s, x) => s + x.entries, 0);

  const docs = vaultFiles.filter((f) => DOC_TEMPLATES.has(f.template_id));
  const other = vaultFiles.filter(
    (f) => !HOUR_SECTIONS.some((s) => s.templateIds.includes(f.template_id)) && !DOC_TEMPLATES.has(f.template_id)
  );

  return {
    totalHours,
    totalEntries,
    fileCount: vaultFiles.length,
    documentCount: docs.length,
    otherFileCount: other.length,
    sections,
  };
}

module.exports = {
  assessVaultStats,
  HOUR_SECTIONS,
  parseHours,
};
