import fs from 'fs/promises';
import path from 'path';
import { PATHS } from './config.js';

export async function ensureDirectories() {
  await Promise.all([
    fs.mkdir(PATHS.MOM_DIR, { recursive: true }),
    fs.mkdir(PATHS.CONFLUENCE_DRAFTS_DIR, { recursive: true }),
    fs.mkdir(PATHS.LOGS_DIR, { recursive: true }),
  ]);
}

export async function writeJson(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

export async function appendLog(fileName, line) {
  const logPath = path.join(PATHS.LOGS_DIR, fileName);
  await fs.appendFile(logPath, `${new Date().toISOString()} ${line}\n`, 'utf8');
}

export async function readTranscriptFile(transcriptFile) {
  const transcriptPath = path.join(PATHS.TRANSCRIPTS_DIR, transcriptFile);
  return fs.readFile(transcriptPath, 'utf8');
}

export async function writeOutputFiles({ runId, meetingDoc, confluenceHtml, summary }) {
  const momJsonPath = path.join(PATHS.MOM_DIR, `${runId}.json`);
  const momHtmlPath = path.join(PATHS.CONFLUENCE_DRAFTS_DIR, `${runId}.html`);
  const runSummaryPath = path.join(PATHS.LOGS_DIR, `${runId}.json`);

  await writeJson(momJsonPath, meetingDoc);
  await fs.writeFile(momHtmlPath, confluenceHtml, 'utf8');
  await writeJson(runSummaryPath, summary);

  return {
    momJsonPath,
    momHtmlPath,
    runSummaryPath,
  };
}

export async function writeFailure(runId, transcriptFile, error) {
  const failure = {
    success: false,
    runId,
    transcriptFile,
    error: error.message,
    stack: error.stack,
  };

  const failurePath = path.join(PATHS.LOGS_DIR, `${runId}-error.json`);
  await writeJson(failurePath, failure);
  await appendLog('errors.log', `[${runId}] ${error.message}`);
}