import fs from "fs/promises";
import path from "path";

import {
  runMeetingApp
} from "./meeting-app.js";

import {
  PATHS
} from "./config.js";

export async function processTranscriptText({
  transcriptText,
  transcriptFileName,
  spaceKey,
  parentPageId
}) {
  const fileName =
    transcriptFileName ||
    `transcript-${Date.now()}.txt`;

  const transcriptPath = path.join(
    PATHS.TRANSCRIPTS_DIR,
    fileName
  );

  await fs.writeFile(
    transcriptPath,
    transcriptText,
    "utf8"
  );

  await runMeetingApp({
    transcriptFile: fileName,
    spaceKey,
    parentPageId
  });

  return {
    success: true,
    message: "Transcript processed",
    transcriptFile: fileName,
    spaceKey,
    parentPageId
  };
}

export async function processTranscriptFile({
  transcriptFileName,
  spaceKey,
  parentPageId
}) {

  await runMeetingApp({
    transcriptFile: transcriptFileName,
    spaceKey,
    parentPageId
  });

  return {
    success: true,
    message: "Transcript processed",
    transcriptFile: transcriptFileName,
    spaceKey,
    parentPageId
  };
}