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
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;

if (!JIRA_URL || !JIRA_API_TOKEN) {
  console.error("Error: Missing required environment variables");
  console.error("Please set: JIRA_URL, JIRA_API_TOKEN");
  process.exit(1);
}

const headers = {
  'Authorization': `Bearer ${JIRA_API_TOKEN}`,
  'Accept': 'application/json',
  'Content-Type': 'application/json'
};

// Create server instance
const server = new Server(
  {
    name: "jira-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "search_jira_issues",
        description: "Search for Jira issues using JQL",
        inputSchema: {
          type: "object",
          properties: {
            jql: {
              type: "string",
              description: "JQL query (e.g., 'key in (PROJ-456, PROJ-457)')",
            },
            maxResults: {
              type: "number",
              description: "Maximum results (default: 50)",
              default: 50,
            },
          },
          required: ["jql"],
        },
      },
      {
        name: "get_jira_issue",
        description: "Get a specific Jira issue by key",
        inputSchema: {
          type: "object",
          properties: {
            issueKey: {
              type: "string",
              description: "Issue key (e.g., 'PROJ-456')",
            },
          },
          required: ["issueKey"],
        },
      },
      {
        name: "add_jira_comment",
        description: "Add a comment to a Jira issue",
        inputSchema: {
          type: "object",
          properties: {
            issueKey: {
              type: "string",
              description: "Issue key (e.g., 'PROJ-456')",
            },
            comment: {
              type: "string",
              description: "Comment text",
            },
          },
          required: ["issueKey", "comment"],
        },
      },
      {
        name: "update_jira_issue",
        description: "Update a Jira issue",
        inputSchema: {
          type: "object",
          properties: {
            issueKey: {
              type: "string",
              description: "Issue key (e.g., 'PROJ-456')",
            },
            fields: {
              type: "object",
              description: "Fields to update (JSON object)",
            },
          },
          required: ["issueKey", "fields"],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "search_jira_issues": {
        const { jql, maxResults = 50 } = args;
        
        const response = await axios.get(`${JIRA_URL}/rest/api/2/search`, {
          headers,
          params: { jql, maxResults },
        });

        const issues = response.data.issues.map(issue => ({
          key: issue.key,
          summary: issue.fields.summary,
          status: issue.fields.status.name,
          assignee: issue.fields.assignee?.displayName || "Unassigned",
          priority: issue.fields.priority?.name || "None",
          created: issue.fields.created,
          updated: issue.fields.updated,
        }));

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                total: response.data.total,
                issues,
              }, null, 2),
            },
          ],
        };
      }

      case "get_jira_issue": {
        const { issueKey } = args;
        
        const response = await axios.get(`${JIRA_URL}/rest/api/3/issue/${issueKey}`, {
          headers,
        });

        const issue = {
          key: response.data.key,
          summary: response.data.fields.summary,
          description: response.data.fields.description,
          status: response.data.fields.status.name,
          assignee: response.data.fields.assignee?.displayName || "Unassigned",
          priority: response.data.fields.priority?.name || "None",
          created: response.data.fields.created,
          updated: response.data.fields.updated,
          url: `${JIRA_URL}/browse/${response.data.key}`,
        };

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(issue, null, 2),
            },
          ],
        };
      }

      case "add_jira_comment": {
        const { issueKey, comment } = args;
        
        const response = await axios.post(
          `${JIRA_URL}/rest/api/3/issue/${issueKey}/comment`,
          {
            body: {
              type: "doc",
              version: 1,
              content: [
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: comment,
                    },
                  ],
                },
              ],
            },
          },
          { headers }
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                message: "Comment added successfully",
                commentId: response.data.id,
              }, null, 2),
            },
          ],
        };
      }

      case "update_jira_issue": {
        const { issueKey, fields } = args;
        
        await axios.put(
          `${JIRA_URL}/rest/api/3/issue/${issueKey}`,
          { fields },
          { headers }
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                message: `Issue ${issueKey} updated successfully`,
              }, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = {
      error: true,
      message: error.message,
      status: error.response?.status,
      details: error.response?.data,
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(errorMessage, null, 2),
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Jira MCP Server running on stdio");
  console.error(`Connected to: ${JIRA_URL}`);
}

main().catch((error) => {
  console.error("Fatal error in Jira MCP Server:", error);
  process.exit(1);
});