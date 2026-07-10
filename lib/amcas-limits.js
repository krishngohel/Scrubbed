'use strict';

/**
 * AMCAS character limits — 2026 application cycle.
 * Source: AAMC AMCAS Applicant Guide / Section 8 Essays & Work & Activities
 *   https://students-residents.aamc.org/how-apply-medical-school-amcas/section-8-amcas-application-essays
 * Verified: July 2026 — update this file when AAMC publishes a new cycle guide.
 */
const AMCAS_CYCLE = '2026';
const AMCAS_SOURCE_URL = 'https://students-residents.aamc.org/how-apply-medical-school-amcas/section-8-amcas-application-essays';

const AMCAS_LIMITS = {
  personal_statement: {
    label: 'Personal Comments (Personal Statement)',
    max_chars: 5300,
    note: 'Includes spaces. Required for all applicants.',
  },
  work_activities_entry: {
    label: 'Work & Activities — entry description',
    max_chars: 700,
    note: 'Per entry, up to 15 entries. Includes spaces.',
  },
  most_meaningful: {
    label: 'Most Meaningful Experience — additional reflection',
    max_chars: 1325,
    note: 'Additional to the 700-char entry box; up to 3 entries.',
  },
  other_impactful: {
    label: 'Other Impactful Experiences (optional)',
    max_chars: 1325,
    note: 'When offered on the application.',
  },
  md_phd_essay: {
    label: 'MD-PhD Essay',
    max_chars: 3000,
    note: 'MD-PhD applicants only.',
  },
  research_experience_essay: {
    label: 'Significant Research Experience Essay',
    max_chars: 10000,
    note: 'MD-PhD applicants only.',
  },
};

function countChars(text) {
  return String(text ?? '').length;
}

function checkLimit(sectionKey, text) {
  const section = AMCAS_LIMITS[sectionKey];
  if (!section) return { error: 'Unknown section' };
  const count = countChars(text);
  const over = count > section.max_chars;
  return {
    section: sectionKey,
    label: section.label,
    count,
    max: section.max_chars,
    remaining: section.max_chars - count,
    over,
    warn: over,
    note: section.note,
  };
}

module.exports = { AMCAS_CYCLE, AMCAS_SOURCE_URL, AMCAS_LIMITS, countChars, checkLimit };
