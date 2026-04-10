#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const JIRA_URL = process.env.JIRA_URL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;

if (!JIRA_URL || !JIRA_API_TOKEN) {
  console.error("Missing environment variables:");
  console.error("JIRA_URL");
  console.error("JIRA_API_TOKEN");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${JIRA_API_TOKEN}`,
  Accept: "application/json",
  "Content-Type": "application/json",
};

const server = new Server(
  {
    name: "jira-mcp-server",
    version: "2.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "search_jira_issues",
        description: "Search Jira issues using JQL",
        inputSchema: {
          type: "object",
          properties: {
            jql: {
              type: "string",
            },
            maxResults: {
              type: "number",
              default: 50,
            },
          },
          required: ["jql"],
        },
      },

      {
        name: "get_jira_issue",
        description: "Get a Jira issue by key",
        inputSchema: {
          type: "object",
          properties: {
            issueKey: {
              type: "string",
            },
          },
          required: ["issueKey"],
        },
      },

      {
        name: "search_jira_users",
        description:
          "Search Jira users and return accountId for mentions",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
            },
            maxResults: {
              type: "number",
              default: 10,
            },
          },
          required: ["query"],
        },
      },
    ],
  };
});

server.setRequestHandler(
  CallToolRequestSchema,
  async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {

        case "search_jira_issues": {

          const { jql, maxResults = 50 } = args;

          const response =
            await axios.get(
              `${JIRA_URL}/rest/api/2/search`,
              {
                headers,
                params: {
                  jql,
                  maxResults,
                },
              }
            );

          const issues =
            response.data.issues.map(issue => ({
              key: issue.key,
              summary:
                issue.fields.summary,

              status:
                issue.fields.status?.name,

              assignee:
                issue.fields.assignee
                  ?.displayName || "Unassigned",

              created:
                issue.fields.created,

              updated:
                issue.fields.updated,

              url:
                `${JIRA_URL}/browse/${issue.key}`,
            }));

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    total:
                      response.data.total,
                    issues,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case "get_jira_issue": {

          const { issueKey } = args;

          const response =
            await axios.get(
              `${JIRA_URL}/rest/api/3/issue/${issueKey}`,
              {
                headers,
              }
            );

          const issue = {
            key:
              response.data.key,

            summary:
              response.data.fields.summary,

            status:
              response.data.fields.status?.name,

            assignee:
              response.data.fields.assignee
                ?.displayName || "Unassigned",

            url:
              `${JIRA_URL}/browse/${response.data.key}`,
          };

          return {
            content: [
              {
                type: "text",
                text:
                  JSON.stringify(
                    issue,
                    null,
                    2
                  ),
              },
            ],
          };
        }

        case "search_jira_users": {

          const {
            query,
            maxResults = 10
          } = args;

          console.error(
            `Searching Jira users for: ${query}`
          );

          const response =
            await axios.get(
              `${JIRA_URL}/rest/api/3/user/search`,
              {
                headers,
                params: {
                  query,
                  maxResults,
                },
              }
            );

          const users =
            (response.data || [])
              .map(user => ({
                accountId:
                  user.accountId,

                displayName:
                  user.displayName,

                emailAddress:
                  user.emailAddress,

                active:
                  user.active,
              }));

          return {
            content: [
              {
                type: "text",
                text:
                  JSON.stringify(
                    {
                      total:
                        users.length,
                      users,
                    },
                    null,
                    2
                  ),
              },
            ],
          };
        }

        default:

          throw new Error(
            `Unknown tool: ${name}`
          );

      }

    } catch (error) {

      const errorPayload = {
        error: true,
        message:
          error.message,

        status:
          error.response?.status,

        details:
          error.response?.data,
      };

      return {
        content: [
          {
            type: "text",
            text:
              JSON.stringify(
                errorPayload,
                null,
                2
              ),
          },
        ],
        isError: true,
      };
    }
  }
);

async function main() {

  const transport =
    new StdioServerTransport();

  await server.connect(
    transport
  );

  console.error(
    "Jira MCP Server running"
  );

  console.error(
    `Connected to: ${JIRA_URL}`
  );
}

main().catch(error => {
  console.error(
    "Fatal Jira MCP error:",
    error
  );
  process.exit(1);
});