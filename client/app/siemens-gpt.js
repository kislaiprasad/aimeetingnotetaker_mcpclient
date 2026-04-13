import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import { requireEnv, PATHS, getTimestamp } from './config.js';
import { writeJson } from './fs-utils.js';
import { stripCodeFences } from './text-utils.js';

export async function callSiemensGpt(messages) {
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

  const responsePath = path.join(PATHS.LOGS_DIR, `siemensgpt-response-${getTimestamp()}.json`);
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
    const rawPath = path.join(PATHS.LOGS_DIR, `siemensgpt-raw-${getTimestamp()}.txt`);
    await fs.writeFile(rawPath, raw, 'utf8');
    throw new Error(`Siemens GPT returned non-JSON content. Inspect: ${rawPath}`);
  }
}

export function buildMessages({ transcript, transcriptFile, jiraKeys, jiraContext, speakerHints }) {
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