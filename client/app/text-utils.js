export function extractJiraKeys(text) {
  return [...new Set((text.match(/\b[A-Z][A-Z0-9]+-\d+\b/g) || []).map((x) => x.trim()))];
}

export function extractSpeakers(transcript) {
  const matches = transcript.match(/^[A-Za-z ,.'()-]+:/gm) || [];
  return [...new Set(matches.map((x) => x.replace(':', '').trim()))];
}

export function cleanTranscript(raw) {
  return raw
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\b(um|uh|hmm)\b/gi, '')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

export function stripCodeFences(text) {
  return text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

export function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeXmlAttr(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

export function normalizeNameForMatch(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractNameTokens(name = '') {
  const cleaned = String(name)
    .replace(/[,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return [];

  const parts = cleaned.split(' ').filter(Boolean);
  const tokens = new Set();

  tokens.add(cleaned);

  if (parts.length >= 2) {
    tokens.add(`${parts[0]} ${parts[1]}`);
    tokens.add(`${parts[1]} ${parts[0]}`);
  }

  if (parts.length >= 3) {
    tokens.add(`${parts[parts.length - 1]} ${parts[0]}`);
    tokens.add(`${parts[0]} ${parts[parts.length - 1]}`);
  }

  parts.forEach((p) => tokens.add(p));

  return [...tokens];
}

export function sanitizeConfluenceHtml(html) {
  return String(html || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/–/g, '-')
    .replace(/—/g, '-')
    .replace(/…/g, '...')
    .replace(/\u202F/g, ' ')
    .replace(/\u00A0/g, ' ')
    .replace(/\u2011/g, '-')
    .replace(/\u2013/g, '-')
    .replace(/\u2014/g, '-')
    .replace(/\u2192/g, '->')
    .trim();
}

export function parseAnyDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

  const str = String(value).trim();
  if (!str) return null;

  const iso = new Date(str);
  if (!Number.isNaN(iso.getTime())) return iso;

  const ddmmyyyy = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (ddmmyyyy) {
    const [, d, m, y] = ddmmyyyy;
    const dt = new Date(Number(y), Number(m) - 1, Number(d));
    if (!Number.isNaN(dt.getTime())) return dt;
  }

  return null;
}

export function formatDateForTitle(dateValue) {
  const date = parseAnyDate(dateValue) || new Date();
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export function cleanTitlePart(value) {
  return String(value || 'Meeting Minutes')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeMeetingDoc(doc, transcriptFile) {
  return {
    meeting_metadata: {
      meeting_title: doc?.meeting_metadata?.meeting_title || null,
      transcript_file: transcriptFile,
      date: doc?.meeting_metadata?.date || null,
      time: doc?.meeting_metadata?.time || null,
      duration: doc?.meeting_metadata?.duration || null,
      attendees: normalizeArray(doc?.meeting_metadata?.attendees),
    },
    executive_summary: doc?.executive_summary || '',
    agenda_items: normalizeArray(doc?.agenda_items),
    discussion_points: normalizeArray(doc?.discussion_points).map((item) => ({
      topic: item?.topic || 'General Discussion',
      summary: item?.summary || '',
    })),
    decisions: normalizeArray(doc?.decisions),
    action_items: normalizeArray(doc?.action_items).map((item) => ({
      description: item?.description || '',
      assignee: item?.assignee || null,
      due_date: item?.due_date || null,
      priority: item?.priority || null,
      jira_reference: item?.jira_reference || null,
      evidence: item?.evidence || '',
      assignee_confluence_account_id: null,
    })),
    jira_issues_discussed: normalizeArray(doc?.jira_issues_discussed).map((item) => ({
      key: item?.key || '',
      summary: item?.summary || '',
      status: item?.status || '',
      assignee: item?.assignee || null,
      url: item?.url || null,
    })),
    next_steps: normalizeArray(doc?.next_steps),
    risks_or_open_questions: normalizeArray(doc?.risks_or_open_questions),
  };
}