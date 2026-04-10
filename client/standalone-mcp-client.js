import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import axios from 'axios';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const ROOT_DIR = path.join(__dirname, '..');
const TRANSCRIPTS_DIR = path.join(ROOT_DIR, 'transcripts');
const OUTPUT_DIR = path.join(ROOT_DIR, 'output');
const MOM_DIR = path.join(OUTPUT_DIR, 'mom');
const CONFLUENCE_DRAFTS_DIR = path.join(OUTPUT_DIR, 'confluence-drafts');
const LOGS_DIR = path.join(OUTPUT_DIR, 'logs');
const MCP_SERVERS_DIR = path.join(ROOT_DIR, 'mcp-servers');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

function getTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function ensureDirectories() {
  await Promise.all([
    fs.mkdir(MOM_DIR, { recursive: true }),
    fs.mkdir(CONFLUENCE_DRAFTS_DIR, { recursive: true }),
    fs.mkdir(LOGS_DIR, { recursive: true }),
  ]);
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

async function appendLog(fileName, line) {
  const logPath = path.join(LOGS_DIR, fileName);
  await fs.appendFile(logPath, `${new Date().toISOString()} ${line}\n`, 'utf8');
}

function extractJiraKeys(text) {
  return [...new Set((text.match(/\b[A-Z][A-Z0-9]+-\d+\b/g) || []).map((x) => x.trim()))];
}

function extractSpeakers(transcript) {
  const matches = transcript.match(/^[A-Za-z ,.'()-]+:/gm) || [];
  return [...new Set(matches.map((x) => x.replace(':', '').trim()))];
}

function cleanTranscript(raw) {
  return raw
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\b(um|uh|hmm)\b/gi, '')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

function stripCodeFences(text) {
  return text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeXmlAttr(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeNameForMatch(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractNameTokens(name = '') {
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

function sanitizeConfluenceHtml(html) {
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

function normalizeMeetingDoc(doc, transcriptFile) {
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

function parseAnyDate(value) {
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

function formatDateForTitle(dateValue) {
  const date = parseAnyDate(dateValue) || new Date();
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function cleanTitlePart(value) {
  return String(value || 'Meeting Minutes')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function deriveMeetingTitle(doc) {
  return (
    doc?.meeting_metadata?.meeting_title ||
    doc?.agenda_items?.[0] ||
    'Meeting Minutes'
  );
}

function buildDocumentTitle(doc) {
  const datePart = formatDateForTitle(doc?.meeting_metadata?.date);
  const titlePart = cleanTitlePart(deriveMeetingTitle(doc));
  return `${datePart}-${titlePart}`;
}

function buildIssueUrl(issueKey) {
  return `${requireEnv('JIRA_URL').replace(/\/$/, '')}/browse/${encodeURIComponent(issueKey)}`;
}

function renderConfluenceUserMention(accountId, fallbackText) {
  if (!accountId) {
    return escapeHtml(fallbackText || '');
  }

  return `<ac:link><ri:user ri:account-id="${escapeXmlAttr(accountId)}" /></ac:link>`;
}

function renderIssueReference(issueRef, issueUrlMap) {
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

function renderDynamicJiraMacro(issueKeys) {
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

function renderConfluenceStorage(doc, options = {}) {
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

function getTextContent(toolResult) {
  return (toolResult?.content || [])
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n');
}

class McpClientWrapper {
  constructor(name, command, args, env = {}) {
    this.name = name;
    this.command = command;
    this.args = args;
    this.env = env;
    this.client = null;
    this.transport = null;
  }

  async connect() {
    this.transport = new StdioClientTransport({
      command: this.command,
      args: this.args,
      env: { ...process.env, ...this.env },
      cwd: ROOT_DIR,
    });

    this.client = new Client(
      { name: `meeting-automation-${this.name}-client`, version: '1.0.0' },
      { capabilities: {} }
    );

    await this.client.connect(this.transport);
    return this;
  }

  async callTool(name, args) {
    return this.client.callTool({ name, arguments: args });
  }

  async close() {
    try {
      await this.transport?.close?.();
    } catch {
      // ignore
    }
  }
}

async function callSiemensGpt(messages) {
  const baseUrl = requireEnv('SIEMENSGPT_API_URL');
  const apiKey = requireEnv('SIEMENSGPT_API_KEY');
  const model = requireEnv('SIEMENSGPT_MODEL');

  const response = await axios.post(
    `${baseUrl}/chat/completions`,
    {
      model,
      messages,
      temperature: 0.2,
      max_tokens: 6000,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 120000,
    }
  );

  const responsePath = path.join(LOGS_DIR, `siemensgpt-response-${getTimestamp()}.json`);
  await writeJson(responsePath, response.data);

  const choice = response?.data?.choices?.[0];
  const content = choice?.message?.content;
  const reasoning = choice?.message?.reasoning;
  const finishReason = choice?.finish_reason;

  if (!content || !String(content).trim()) {
    throw new Error(
      `Siemens GPT returned no final content. finish_reason=${finishReason}; reasoning_present=${!!reasoning}; inspect=${responsePath}`
    );
  }

  const raw = stripCodeFences(content);

  try {
    return JSON.parse(raw);
  } catch {
    const rawPath = path.join(LOGS_DIR, `siemensgpt-raw-${getTimestamp()}.txt`);
    await fs.writeFile(rawPath, raw, 'utf8');
    throw new Error(`Siemens GPT returned non-JSON content. Inspect: ${rawPath}`);
  }
}

async function fetchJiraContext(jiraClient, jiraKeys) {
  if (!jiraKeys.length) {
    return [];
  }

  const result = await jiraClient.callTool('search_jira_issues', {
    jql: `key in (${jiraKeys.join(',')})`,
    maxResults: jiraKeys.length,
  });

  const payload = JSON.parse(getTextContent(result));
  return (payload.issues || []).map((issue) => ({
    ...issue,
    url: issue.url || buildIssueUrl(issue.key),
  }));
}

async function resolveConfluenceUsers(confluenceClient, names) {
  const uniqueNames = [...new Set(names.filter(Boolean).map((x) => String(x).trim()).filter(Boolean))];
  const directory = {};

  for (const originalName of uniqueNames) {
    const normalized = normalizeNameForMatch(originalName);
    const queries = extractNameTokens(originalName);

    let foundUser = null;

    for (const query of queries) {
      const result = await confluenceClient.callTool('search_confluence_users', {
        query,
        limit: 10,
      });

      const payload = JSON.parse(getTextContent(result));
      const users = payload.users || [];

      foundUser =
        users.find((u) => normalizeNameForMatch(u.displayName) === normalized) ||
        users.find((u) => normalizeNameForMatch(u.publicName) === normalized) ||
        users.find((u) => normalizeNameForMatch(u.fullName) === normalized) ||
        users.find((u) => {
          const dn = normalizeNameForMatch(u.displayName);
          return queries.some((q) => dn === normalizeNameForMatch(q));
        }) ||
        users[0] ||
        null;

      if (foundUser?.accountId) {
        directory[normalized] = foundUser;
        break;
      }
    }
  }

  return directory;
}

async function resolveJiraUsers(jiraClient, names) {
  const uniqueNames = [...new Set(names.filter(Boolean).map((x) => String(x).trim()).filter(Boolean))];
  const directory = {};

  for (const originalName of uniqueNames) {
    const normalized = normalizeNameForMatch(originalName);
    const queries = extractNameTokens(originalName);

    let foundUser = null;

    for (const query of queries) {
      const result = await jiraClient.callTool('search_jira_users', {
        query,
        maxResults: 10,
      });

      const payload = JSON.parse(getTextContent(result));
      const users = payload.users || [];

      foundUser =
        users.find((u) => normalizeNameForMatch(u.displayName) === normalized) ||
        users.find((u) => {
          const dn = normalizeNameForMatch(u.displayName);
          return queries.some((q) => dn === normalizeNameForMatch(q));
        }) ||
        users[0] ||
        null;

      if (foundUser?.accountId) {
        directory[normalized] = foundUser;
        break;
      }
    }
  }

  return directory;
}

async function resolveAssigneeDirectory({ confluenceClient, jiraClient, names }) {
  const confluenceDirectory = await resolveConfluenceUsers(confluenceClient, names);

  const unresolved = names.filter(
    (name) => !confluenceDirectory[normalizeNameForMatch(name)]
  );

  if (!unresolved.length) {
    return confluenceDirectory;
  }

  const jiraDirectory = await resolveJiraUsers(jiraClient, unresolved);

  return {
    ...jiraDirectory,
    ...confluenceDirectory,
  };
}

function buildMessages({ transcript, transcriptFile, jiraKeys, jiraContext, speakerHints }) {
  const MAX_TRANSCRIPT_CHARS = 45000;
  const safeTranscript =
    transcript.length > MAX_TRANSCRIPT_CHARS
      ? transcript.slice(0, MAX_TRANSCRIPT_CHARS)
      : transcript;

  return [
    {
      role: 'system',
      content: `
You are an enterprise meeting assistant.

Return ONLY valid JSON.
Do NOT include reasoning.
Do NOT include commentary.
Do NOT wrap the response in markdown.
Be concise.

Infer a concise meeting title whenever possible.
If a value is unknown:
- use null
- or use []

Output must strictly match the schema.
      `.trim(),
    },
    {
      role: 'user',
      content: `
Generate Minutes of Meeting.

Transcript file:
${transcriptFile}

Detected Jira keys:
${jiraKeys.join(', ') || 'None'}

Known speakers in this meeting:
${speakerHints.join(', ') || 'Unknown'}

Jira context:
${JSON.stringify(jiraContext, null, 2)}

Schema:
{
  "meeting_metadata": {
    "meeting_title": "string|null",
    "date": "string|null",
    "time": "string|null",
    "duration": "string|null",
    "attendees": ["string"]
  },
  "executive_summary": "string",
  "agenda_items": ["string"],
  "discussion_points": [
    { "topic": "string", "summary": "string" }
  ],
  "decisions": ["string"],
  "action_items": [
    {
      "description": "string",
      "assignee": "string|null",
      "due_date": "string|null",
      "priority": "High|Medium|Low|null",
      "jira_reference": "string|null",
      "evidence": "string"
    }
  ],
  "jira_issues_discussed": [
    {
      "key": "string",
      "summary": "string",
      "status": "string",
      "assignee": "string|null",
      "url": "string|null"
    }
  ],
  "next_steps": ["string"],
  "risks_or_open_questions": ["string"]
}

Rules:
- Clean transcription noise
- Group related discussion
- Only assign action items when ownership is stated or strongly implied
- Only include deadlines explicitly mentioned
- Use Jira context only to enrich issue information
- Deduplicate attendees strictly
- If Jira issues are discussed, use their keys from Jira context
- Return a concise, human-readable meeting title if it can be inferred

Transcript:
${safeTranscript}
      `.trim(),
    },
  ];
}

async function processTranscript(transcriptFile) {
  await ensureDirectories();

  const transcriptPath = path.join(TRANSCRIPTS_DIR, transcriptFile);
  const rawTranscript = await fs.readFile(transcriptPath, 'utf8');
  const cleanedTranscript = cleanTranscript(rawTranscript);
  const jiraKeys = extractJiraKeys(cleanedTranscript);
  const speakerHints = extractSpeakers(rawTranscript);
  const runId = `${path.parse(transcriptFile).name}-${getTimestamp()}`;

  const jiraClient = await new McpClientWrapper(
    'jira',
    'node',
    [path.join(MCP_SERVERS_DIR, 'jira-server.js')],
    {
      JIRA_URL: requireEnv('JIRA_URL'),
      JIRA_EMAIL: process.env.JIRA_EMAIL || '',
      JIRA_API_TOKEN: requireEnv('JIRA_API_TOKEN'),
    }
  ).connect();

  const confluenceClient = await new McpClientWrapper(
    'confluence',
    'node',
    [path.join(MCP_SERVERS_DIR, 'confluence-server.js')],
    {
      CONFLUENCE_URL: requireEnv('CONFLUENCE_URL'),
      CONFLUENCE_EMAIL: process.env.CONFLUENCE_EMAIL || '',
      CONFLUENCE_API_TOKEN: requireEnv('CONFLUENCE_API_TOKEN'),
    }
  ).connect();

  try {
    await appendLog('audit.log', `[${runId}] Started transcript processing for ${transcriptFile}`);
    await appendLog('audit.log', `[${runId}] Transcript length: ${cleanedTranscript.length}`);
    await appendLog('audit.log', `[${runId}] Speakers detected: ${speakerHints.join(', ') || 'None'}`);

    const jiraContext = await fetchJiraContext(jiraClient, jiraKeys);

    const llmResult = await callSiemensGpt(
      buildMessages({
        transcript: cleanedTranscript,
        transcriptFile,
        jiraKeys,
        jiraContext,
        speakerHints,
      })
    );

    const meetingDoc = normalizeMeetingDoc(llmResult, transcriptFile);

    const actionAssignees = meetingDoc.action_items.map((x) => x.assignee).filter(Boolean);

    const assigneeDirectory = await resolveAssigneeDirectory({
      confluenceClient,
      jiraClient,
      names: actionAssignees,
    });

    await appendLog(
      'audit.log',
      `[${runId}] Resolved assignees: ${JSON.stringify(assigneeDirectory)}`
    );

    meetingDoc.action_items = meetingDoc.action_items.map((item) => {
      const match = assigneeDirectory[normalizeNameForMatch(item.assignee)];
      return {
        ...item,
        assignee_confluence_account_id: match?.accountId || null,
      };
    });

    const dynamicIssueKeys = [
      ...new Set([
        ...jiraContext.map((issue) => issue.key),
        ...meetingDoc.jira_issues_discussed.map((issue) => issue.key).filter(Boolean),
        ...meetingDoc.action_items
          .map((item) => item.jira_reference)
          .filter(Boolean)
          .map((ref) => String(ref).match(/\b[A-Z][A-Z0-9]+-\d+\b/)?.[0])
          .filter(Boolean),
      ]),
    ];

    const issueUrlMap = Object.fromEntries(
      dynamicIssueKeys.map((key) => [key, buildIssueUrl(key)])
    );

    const documentTitle = buildDocumentTitle(meetingDoc);

    const confluenceHtml = sanitizeConfluenceHtml(
      renderConfluenceStorage(meetingDoc, {
        assigneeDirectory,
        issueUrlMap,
        dynamicIssueKeys,
      })
    );

    const momJsonPath = path.join(MOM_DIR, `${runId}.json`);
    const momHtmlPath = path.join(CONFLUENCE_DRAFTS_DIR, `${runId}.html`);
    const runSummaryPath = path.join(LOGS_DIR, `${runId}.json`);

    await writeJson(momJsonPath, {
      ...meetingDoc,
      document_title: documentTitle,
      dynamic_issue_keys: dynamicIssueKeys,
      resolved_assignees: assigneeDirectory,
    });

    await fs.writeFile(momHtmlPath, confluenceHtml, 'utf8');

    const confluenceResult = await confluenceClient.callTool('create_confluence_page', {
      spaceKey: requireEnv('CONFLUENCE_SPACE_KEY'),
      parentPageId: process.env.CONFLUENCE_PARENT_PAGE_ID || undefined,
      title: documentTitle,
      content: confluenceHtml,
    });

    const createdPage = JSON.parse(getTextContent(confluenceResult));

    if (confluenceResult?.isError || createdPage?.error) {
      throw new Error(
        `Confluence page creation failed: ${createdPage?.message || 'Unknown error'}${
          createdPage?.details ? ` | Details: ${JSON.stringify(createdPage.details)}` : ''
        }`
      );
    }

    const unresolvedAssignees = meetingDoc.action_items
      .filter((item) => !item.assignee_confluence_account_id && item.assignee)
      .map((item) => item.assignee);

    const summary = {
      success: true,
      runId,
      transcriptFile,
      jiraKeys,
      speakerHints,
      documentTitle,
      unresolvedAssignees,
      outputs: {
        momJsonPath,
        momHtmlPath,
      },
      confluence: createdPage,
    };

    await writeJson(runSummaryPath, summary);
    await appendLog('audit.log', `[${runId}] Completed successfully`);

    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    const failure = {
      success: false,
      runId,
      transcriptFile,
      error: error.message,
      stack: error.stack,
    };

    await writeJson(path.join(LOGS_DIR, `${runId}-error.json`), failure);
    await appendLog('errors.log', `[${runId}] ${error.message}`);
    throw error;
  } finally {
    await Promise.allSettled([jiraClient.close(), confluenceClient.close()]);
  }
}

async function main() {
  const transcriptFile = process.argv[2];

  if (!transcriptFile) {
    console.error('Usage: node client/standalone-mcp-client.js <transcript-file>');
    process.exit(1);
  }

  await processTranscript(transcriptFile);
}

main().catch((error) => {
  console.error(JSON.stringify({ success: false, error: error.message }, null, 2));
  process.exit(1);
});