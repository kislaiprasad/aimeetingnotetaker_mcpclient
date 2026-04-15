import { getTimestamp, requireEnv } from './config.js';
import { ensureDirectories, appendLog, readTranscriptFile, writeOutputFiles, writeFailure, writeJson } from './fs-utils.js';
import { cleanTranscript, extractJiraKeys, extractSpeakers, normalizeMeetingDoc, sanitizeConfluenceHtml, normalizeNameForMatch } from './text-utils.js';
import { createJiraClient, createConfluenceClient, fetchJiraContext, resolveAssigneeDirectory } from './mcp.js';
import { callSiemensGpt, buildMessages } from './siemens-gpt.js';
import { renderConfluenceStorage, buildDocumentTitle, buildIssueUrl, getTextContent } from './meeting-renderer.js';
import path from 'path';
import { PATHS } from './config.js';

export async function runMeetingApp({
  transcriptFile,
  spaceKey,
  parentPageId
  }) {
  await ensureDirectories();

  const rawTranscript = await readTranscriptFile(transcriptFile);
  const cleanedTranscript = cleanTranscript(rawTranscript);
  const jiraKeys = extractJiraKeys(cleanedTranscript);
  const speakerHints = extractSpeakers(rawTranscript);
  const runId = `${path.parse(transcriptFile).name}-${getTimestamp()}`;

  const jiraClient = await createJiraClient();
  const confluenceClient = await createConfluenceClient();

  try {
    await appendLog('audit.log', `[${runId}] Started transcript processing for ${transcriptFile}`);
    await appendLog('audit.log', `[${runId}] Transcript length: ${cleanedTranscript.length}`);
    await appendLog('audit.log', `[${runId}] Speakers detected: ${speakerHints.join(', ') || 'None'}`);

    const jiraContext = await fetchJiraContext(jiraClient, jiraKeys, buildIssueUrl);

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

    const baseMeetingDoc = {
      ...meetingDoc,
      document_title: documentTitle,
      dynamic_issue_keys: dynamicIssueKeys,
      resolved_assignees: assigneeDirectory,
    };

    const resolvedSpaceKey =
      spaceKey ||
      process.env.CONFLUENCE_SPACE_KEY;

    const resolvedParentPageId =
      parentPageId ||
      process.env.CONFLUENCE_PARENT_PAGE_ID;

    const confluenceResult =
      await confluenceClient.callTool(
        "create_confluence_page",
        {
          spaceKey:
            resolvedSpaceKey,

          parentPageId:
            resolvedParentPageId,

          title:
            documentTitle,

          content:
            confluenceHtml,
        }
      );

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
      confluence: createdPage,
    };

    const outputs = await writeOutputFiles({
      runId,
      meetingDoc: baseMeetingDoc,
      confluenceHtml,
      summary,
    });

    const finalSummary = {
      ...summary,
      outputs: {
        momJsonPath: outputs.momJsonPath,
        momHtmlPath: outputs.momHtmlPath,
      },
    };

    await writeJson(path.join(PATHS.LOGS_DIR, `${runId}.json`), finalSummary);
    await appendLog('audit.log', `[${runId}] Completed successfully`);

    console.log(JSON.stringify(finalSummary, null, 2));
  } catch (error) {
    await writeFailure(runId, transcriptFile, error);
    throw error;
  } finally {
    await Promise.allSettled([jiraClient.close(), confluenceClient.close()]);
  }
}