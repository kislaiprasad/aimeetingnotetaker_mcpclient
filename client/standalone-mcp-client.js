import { runMeetingApp } from './app/meeting-app.js';

const transcriptFile = process.argv[2];

if (!transcriptFile) {
  console.error('Usage: node client/standalone-mcp-client.js <transcript-file>');
  process.exit(1);
}

runMeetingApp({transcriptFile}).catch((error) => {
  console.error(JSON.stringify({ success: false, error: error.message }, null, 2));
  process.exit(1);
});