import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { PATHS, requireEnv } from './config.js';
import { getTextContent } from './meeting-renderer.js';
import { normalizeNameForMatch, extractNameTokens } from './text-utils.js';

export class McpClientWrapper {
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
      cwd: PATHS.ROOT_DIR,
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

export async function createJiraClient() {
  return new McpClientWrapper(
    'jira',
    'node',
    [path.join(PATHS.MCP_SERVERS_DIR, 'jira-server.js')],
    {
      JIRA_URL: requireEnv('JIRA_URL'),
      JIRA_EMAIL: process.env.JIRA_EMAIL || '',
      JIRA_API_TOKEN: requireEnv('JIRA_API_TOKEN'),
    }
  ).connect();
}

export async function createConfluenceClient() {
  return new McpClientWrapper(
    'confluence',
    'node',
    [path.join(PATHS.MCP_SERVERS_DIR, 'confluence-server.js')],
    {
      CONFLUENCE_URL: requireEnv('CONFLUENCE_URL'),
      CONFLUENCE_EMAIL: process.env.CONFLUENCE_EMAIL || '',
      CONFLUENCE_API_TOKEN: requireEnv('CONFLUENCE_API_TOKEN'),
    }
  ).connect();
}

export async function fetchJiraContext(jiraClient, jiraKeys, buildIssueUrl) {
  if (!jiraKeys.length) return [];

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

export async function resolveConfluenceUsers(confluenceClient, names) {
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

export async function resolveJiraUsers(jiraClient, names) {
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

export async function resolveAssigneeDirectory({ confluenceClient, jiraClient, names }) {
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