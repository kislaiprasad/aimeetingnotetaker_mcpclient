import {
  escapeHtml,
  escapeXmlAttr,
  formatDateForTitle,
  normalizeNameForMatch,
  cleanTitlePart,
} from './text-utils.js';
import { requireEnv } from './config.js';

export function getTextContent(toolResult) {
  return (toolResult?.content || [])
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n');
}

export function deriveMeetingTitle(doc) {
  return (
    doc?.meeting_metadata?.meeting_title ||
    doc?.agenda_items?.[0] ||
    'Meeting Minutes'
  );
}

export function buildDocumentTitle(doc) {
  const datePart = formatDateForTitle(doc?.meeting_metadata?.date);
  const titlePart = cleanTitlePart(deriveMeetingTitle(doc));
  return `${datePart}-${titlePart}`;
}

export function buildIssueUrl(issueKey) {
  return `${requireEnv('JIRA_URL').replace(/\/$/, '')}/browse/${encodeURIComponent(issueKey)}`;
}

export function renderConfluenceUserMention(accountId, fallbackText) {
  if (!accountId) {
    return escapeHtml(fallbackText || '');
  }

  return `<ac:link><ri:user ri:account-id="${escapeXmlAttr(accountId)}" /></ac:link>`;
}

export function renderIssueReference(issueRef, issueUrlMap) {
  if (!issueRef) return '';
  const ref = String(issueRef).trim();
  if (!ref) return '';

  const issueKeyMatch = ref.match(/\b[A-Z][A-Z0-9]+-\d+\b/);
  if (!issueKeyMatch) {
    return escapeHtml(ref);
  }

  const key = issueKeyMatch[0];
  const url = issueUrlMap[key] || buildIssueUrl(key);
  return `<a href="${escapeXmlAttr(url)}">${escapeHtml(key)}</a>`;
}

export function renderDynamicJiraMacro(issueKeys) {
  if (!issueKeys.length) {
    return '<p>No Jira issues discussed.</p>';
  }

  const uniqueKeys = [...new Set(issueKeys)];
  const jql = `key in (${uniqueKeys.join(',')})`;

  return [
    '<ac:structured-macro ac:name="jira" ac:schema-version="1">',
    '<ac:parameter ac:name="columns">key,summary,status,assignee</ac:parameter>',
    `<ac:parameter ac:name="maximumIssues">${uniqueKeys.length}</ac:parameter>`,
    `<ac:parameter ac:name="jqlQuery">${escapeHtml(jql)}</ac:parameter>`,
    '</ac:structured-macro>',
  ].join('');
}

export function renderConfluenceStorage(doc, options = {}) {
  const {
    assigneeDirectory = {},
    issueUrlMap = {},
    dynamicIssueKeys = [],
  } = options;

  const attendeesHtml = doc.meeting_metadata.attendees
    .map((x) => `<li>${escapeHtml(x)}</li>`)
    .join('');

  const agendaHtml = doc.agenda_items.map((x) => `<li>${escapeHtml(x)}</li>`).join('');
  const discussionHtml = doc.discussion_points
    .map((x) => `<h3>${escapeHtml(x.topic)}</h3><p>${escapeHtml(x.summary)}</p>`)
    .join('');
  const decisionsHtml = doc.decisions.map((x) => `<li>${escapeHtml(x)}</li>`).join('');
  const nextStepsHtml = doc.next_steps.map((x) => `<li>${escapeHtml(x)}</li>`).join('');
  const risksHtml = doc.risks_or_open_questions.map((x) => `<li>${escapeHtml(x)}</li>`).join('');

  const actionRows = doc.action_items
    .map((x) => {
      const assigneeAccountId =
        x.assignee_confluence_account_id ||
        assigneeDirectory[normalizeNameForMatch(x.assignee)]?.accountId ||
        null;

      return `
        <tr>
          <td>${escapeHtml(x.description)}</td>
          <td>${renderConfluenceUserMention(assigneeAccountId, x.assignee || '')}</td>
          <td>${escapeHtml(x.due_date || '')}</td>
          <td>${escapeHtml(x.priority || '')}</td>
          <td>${renderIssueReference(x.jira_reference, issueUrlMap)}</td>
        </tr>`;
    })
    .join('');

  const jiraMacroHtml = renderDynamicJiraMacro(dynamicIssueKeys);

  return `
    <h1>${escapeHtml(buildDocumentTitle(doc))}</h1>
    <h2>Meeting Details</h2>
    <p>
      <strong>Date:</strong> ${escapeHtml(formatDateForTitle(doc.meeting_metadata.date))}<br/>
      <strong>Duration:</strong> ${escapeHtml(doc.meeting_metadata.duration || '')}
    </p>
    <h3>Attendees</h3>
    <ul>${attendeesHtml}</ul>
    <h2>Executive Summary</h2>
    <p>${escapeHtml(doc.executive_summary)}</p>
    <h2>Agenda Items</h2>
    <ul>${agendaHtml}</ul>
    <h2>Discussion Points</h2>
    ${discussionHtml}
    <h2>Decisions Made</h2>
    <ul>${decisionsHtml}</ul>
    <h2>Action Items</h2>
    <table>
      <tbody>
        <tr>
          <th>Description</th>
          <th>Assignee</th>
          <th>Due Date</th>
          <th>Priority</th>
          <th>Jira Reference</th>
        </tr>
        ${actionRows}
      </tbody>
    </table>
    <h2>Jira Issues Discussed</h2>
    ${jiraMacroHtml}
    <h2>Next Steps</h2>
    <ul>${nextStepsHtml}</ul>
    <h2>Risks / Open Questions</h2>
    <ul>${risksHtml}</ul>
    <h4><i>AI generated meeting notes</i></h4>
  `
    .replace(/\n\s*/g, ' ')
    .trim();
}