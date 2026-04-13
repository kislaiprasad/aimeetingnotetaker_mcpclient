import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENT_DIR = path.join(__dirname, '..');
const ROOT_DIR = path.join(CLIENT_DIR, '..');

dotenv.config({ path: path.join(ROOT_DIR, '.env') });

export const PATHS = {
  ROOT_DIR,
  CLIENT_DIR,
  TRANSCRIPTS_DIR: path.join(ROOT_DIR, 'transcripts'),
  OUTPUT_DIR: path.join(ROOT_DIR, 'output'),
  MOM_DIR: path.join(ROOT_DIR, 'output', 'mom'),
  CONFLUENCE_DRAFTS_DIR: path.join(ROOT_DIR, 'output', 'confluence-drafts'),
  LOGS_DIR: path.join(ROOT_DIR, 'output', 'logs'),
  MCP_SERVERS_DIR: path.join(ROOT_DIR, 'mcp-servers'),
};

export function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

export function getTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}