'use strict';

const EXPERIENCE_TEMPLATES = new Set([
  'clinical-hours',
  'shadowing-log',
  'volunteer-hours',
  'research-log',
  'employment-record',
]);

const TEMPLATE_LABELS = {
  'clinical-hours': 'Clinical Hour Log',
  'shadowing-log': 'Shadowing Log',
  'volunteer-hours': 'Volunteer Hour Log',
  'research-log': 'Research Log',
  'employment-record': 'Employment Record',
  'personal-statement': 'Personal Statement',
  'activity-description': 'Activity Description',
  'recommendation-letter': 'Recommendation Letter',
  'secondary-essay': 'Secondary Essay',
};

function countFilledRows(content) {
  const rows = content?.rows;
  if (!Array.isArray(rows)) return 0;
  return rows.filter((row) => {
    if (!row) return false;
    if (Array.isArray(row)) return row.some((c) => String(c ?? '').trim());
    if (typeof row === 'object') return Object.values(row).some((v) => String(v ?? '').trim());
    return String(row).trim().length > 0;
  }).length;
}

function hasDocumentContent(content) {
  if (!content) return false;
  if (content.pdf) return true;
  if (content.blank && String(content.html || '').replace(/<[^>]*>/g, '').trim()) return true;
  if (Array.isArray(content.sections) && content.sections.some((s) => String(s?.content || '').replace(/<[^>]*>/g, '').trim())) {
    return true;
  }
  return false;
}

function fileHasSubstance(file) {
  if (!file || file.template_id === 'secondary-outline') return false;
  const content = file.content || {};
  if (content.pdf) return true;
  if (countFilledRows(content) > 0) return true;
  return hasDocumentContent(content);
}

/**
 * @param {Array} files - vault files from Supabase (excludes secondary-outline)
 * @returns {{ ready: boolean, score: number, missing: string[], fileCount: number, filledRows: number, experienceLog: object|null }}
 */
function assessVaultReadiness(files) {
  const vaultFiles = (files || []).filter((f) => f.template_id !== 'secondary-outline');
  const substantive = vaultFiles.filter(fileHasSubstance);
  const missing = [];
  let score = 0;

  const fileCount = substantive.length;
  if (fileCount >= 2) score += 40;
  else missing.push('Add at least 2 files with real content in your Vault.');

  let bestExperience = null;
  let bestExperienceRows = 0;
  for (const f of substantive) {
    if (!EXPERIENCE_TEMPLATES.has(f.template_id)) continue;
    const rows = countFilledRows(f.content);
    if (rows > bestExperienceRows) {
      bestExperienceRows = rows;
      bestExperience = f;
    }
  }

  if (bestExperience && bestExperienceRows >= 3) {
    score += 35;
  } else {
    const label = bestExperience
      ? (TEMPLATE_LABELS[bestExperience.template_id] || bestExperience.name)
      : 'an experience log (clinical, shadowing, volunteer, research, or employment)';
    const need = Math.max(0, 3 - bestExperienceRows);
    missing.push(
      need > 0
        ? `Add ${need} more filled row${need === 1 ? '' : 's'} to your ${label}.`
        : `Add ${label} with at least 3 filled entries.`
    );
  }

  const otherFiles = substantive.filter((f) => f !== bestExperience);
  const totalFilledRows = substantive.reduce((n, f) => n + countFilledRows(f.content), 0);
  if (otherFiles.length >= 1 || (bestExperience && fileCount >= 2)) {
    score += 25;
  } else {
    missing.push('Add another Vault file (activity description, personal statement, or a second log).');
  }

  const ready = fileCount >= 2 && bestExperienceRows >= 3 && (otherFiles.length >= 1 || fileCount >= 2);

  return {
    ready,
    score: Math.min(100, score),
    missing,
    fileCount,
    filledRows: totalFilledRows,
    experienceLog: bestExperience
      ? { name: bestExperience.name, template_id: bestExperience.template_id, filledRows: bestExperienceRows }
      : null,
  };
}

module.exports = {
  assessVaultReadiness,
  fileHasSubstance,
  countFilledRows,
  EXPERIENCE_TEMPLATES,
  TEMPLATE_LABELS,
};
