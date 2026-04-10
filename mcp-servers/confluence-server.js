#!/usr/bin/env node

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

dotenv.config();

const CONFLUENCE_URL = process.env.CONFLUENCE_URL;
const CONFLUENCE_API_TOKEN = process.env.CONFLUENCE_API_TOKEN;

if (!CONFLUENCE_URL || !CONFLUENCE_API_TOKEN) {
  console.error("Error: Missing required environment variables");
  console.error("Please set: CONFLUENCE_URL, CONFLUENCE_API_TOKEN");
  process.exit(1);
}

function cleanText(value = "") {
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\r/g, " ")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/–/g, "-")
    .replace(/—/g, "-")
    .replace(/…/g, "...")
    .replace(/\u202F/g, " ")
    .replace(/\u00A0/g, " ")
    .replace(/\u2011/g, "-") // non-breaking hyphen
    .replace(/\u2013/g, "-") // en dash
    .replace(/\u2014/g, "-") // em dash
    .trim();
}

function saveDebugPayload(payload) {
  try {
    const outputDir = path.join(process.cwd(), "output");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const debugPath = path.join(outputDir, "last-confluence-payload.json");
    fs.writeFileSync(debugPath, JSON.stringify(payload, null, 2), "utf8");
  } catch (error) {
    console.error("Could not save debug payload:", error.message);
  }
}

async function confluenceFetch(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();

  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    data,
  };
}

const server = new Server(
  {
    name: "confluence-mcp-server",
    version: "1.2.0",
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
        name: "create_confluence_page",
        description: "Create a new Confluence page with optional parent",
        inputSchema: {
          type: "object",
          properties: {
            spaceKey: { type: "string" },
            title: { type: "string" },
            content: { type: "string" },
            parentPageId: { type: "string" },
          },
          required: ["spaceKey", "title", "content"],
        },
      },
      {
        name: "update_confluence_page",
        description: "Update an existing Confluence page",
        inputSchema: {
          type: "object",
          properties: {
            pageId: { type: "string" },
            title: { type: "string" },
            content: { type: "string" },
            version: { type: "number" },
          },
          required: ["pageId", "title", "content", "version"],
        },
      },
      {
        name: "search_confluence",
        description: "Search for Confluence pages using CQL",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            limit: { type: "number", default: 25 },
          },
          required: ["query"],
        },
      },
      {
        name: "get_confluence_page",
        description: "Get a Confluence page by ID with full content",
        inputSchema: {
          type: "object",
          properties: {
            pageId: { type: "string" },
          },
          required: ["pageId"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "create_confluence_page": {
        const { spaceKey, title, content, parentPageId } = args;

        const pageData = {
          type: "page",
          title: cleanText(title),
          space: { key: cleanText(spaceKey) },
          body: {
            storage: {
              value: cleanText(content),
              representation: "storage",
            },
          },
        };

        if (parentPageId) {
          pageData.ancestors = [{ id: String(parentPageId).trim() }];
        }

        saveDebugPayload(pageData);

        const body = JSON.stringify(pageData);
        const response = await confluenceFetch(
          `${CONFLUENCE_URL}/rest/api/content`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${CONFLUENCE_API_TOKEN}`,
              Accept: "application/json",
              "Content-Type": "application/json; charset=utf-8",
              "Content-Length": String(Buffer.byteLength(body, "utf8")),
            },
            body,
          }
        );

        if (!response.ok) {
          throw new Error(
            `Unexpected status: ${response.status} - ${JSON.stringify(response.data)}`
          );
        }

        const pageUrl = `${CONFLUENCE_URL}${response.data._links.webui}`;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  message: "Page created successfully",
                  page: {
                    id: response.data.id,
                    title: response.data.title,
                    url: pageUrl,
                    space: response.data.space.key,
                    version: response.data.version.number,
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "update_confluence_page": {
        const { pageId, title, content, version } = args;

        const updateData = {
          type: "page",
          title: cleanText(title),
          body: {
            storage: {
              value: cleanText(content),
              representation: "storage",
            },
          },
          version: {
            number: version + 1,
          },
        };

        saveDebugPayload(updateData);

        const body = JSON.stringify(updateData);
        const response = await confluenceFetch(
          `${CONFLUENCE_URL}/rest/api/content/${pageId}`,
          {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${CONFLUENCE_API_TOKEN}`,
              Accept: "application/json",
              "Content-Type": "application/json; charset=utf-8",
              "Content-Length": String(Buffer.byteLength(body, "utf8")),
            },
            body,
          }
        );

        if (!response.ok) {
          throw new Error(
            `Unexpected status: ${response.status} - ${JSON.stringify(response.data)}`
          );
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  message: "Page updated successfully",
                  page: {
                    id: response.data.id,
                    title: response.data.title,
                    version: response.data.version.number,
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "search_confluence": {
        const { query, limit = 25 } = args;
        const url =
          `${CONFLUENCE_URL}/rest/api/content/search?cql=` +
          encodeURIComponent(query) +
          `&limit=${encodeURIComponent(limit)}`;

        const response = await confluenceFetch(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${CONFLUENCE_API_TOKEN}`,
            Accept: "application/json",
          },
        });

        if (!response.ok) {
          throw new Error(
            `Unexpected status: ${response.status} - ${JSON.stringify(response.data)}`
          );
        }

        const results = (response.data.results || []).map((page) => ({
          id: page.id,
          title: page.title,
          type: page.type,
          url: `${CONFLUENCE_URL}${page._links?.webui || ""}`,
        }));

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  total: response.data.totalSize,
                  results,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "get_confluence_page": {
        const { pageId } = args;
        const url =
          `${CONFLUENCE_URL}/rest/api/content/${pageId}?expand=` +
          encodeURIComponent("body.storage,version,space");

        const response = await confluenceFetch(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${CONFLUENCE_API_TOKEN}`,
            Accept: "application/json",
          },
        });

        if (!response.ok) {
          throw new Error(
            `Unexpected status: ${response.status} - ${JSON.stringify(response.data)}`
          );
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  id: response.data.id,
                  title: response.data.title,
                  space: response.data.space.key,
                  version: response.data.version.number,
                  content: response.data.body.storage.value,
                  url: `${CONFLUENCE_URL}${response.data._links.webui}`,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              error: true,
              message: error.message,
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Confluence MCP Server running on stdio");
  console.error(`Connected to: ${CONFLUENCE_URL}`);
}

main().catch((error) => {
  console.error("Fatal error in Confluence MCP Server:", error);
  process.exit(1);
});