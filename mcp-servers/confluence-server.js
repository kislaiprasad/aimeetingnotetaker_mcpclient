#!/usr/bin/env node

import fs from "fs";
import path from "path";
import https from "https";
import { URL } from "url";
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
    .replace(/\u2011/g, "-")
    .replace(/\u2013/g, "-")
    .replace(/\u2014/g, "-")
    .replace(/\u2192/g, "->")
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

function confluenceRequest(method, endpoint, payload = null) {
  return new Promise((resolve, reject) => {
    const base = new URL(CONFLUENCE_URL);
    const url = new URL(endpoint, base);

    const body = payload ? JSON.stringify(payload) : null;
    const headers = {
      Authorization: `Bearer ${CONFLUENCE_API_TOKEN}`,
      Accept: "application/json",
    };

    if (body) {
      headers["Content-Type"] = "application/json; charset=utf-8";
      headers["Content-Length"] = Buffer.byteLength(body, "utf8");
    }

    const req = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method,
        headers,
      },
      (res) => {
        let chunks = "";

        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          chunks += chunk;
        });

        res.on("end", () => {
          let parsed = chunks;
          try {
            parsed = chunks ? JSON.parse(chunks) : null;
          } catch {
            // keep raw text
          }

          resolve({
            status: res.statusCode,
            statusText: res.statusMessage,
            ok: res.statusCode >= 200 && res.statusCode < 300,
            data: parsed,
          });
        });
      }
    );

    req.on("error", reject);

    if (body) {
      req.write(body, "utf8");
    }

    req.end();
  });
}

const server = new Server(
  {
    name: "confluence-mcp-server",
    version: "1.3.0",
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

        const response = await confluenceRequest(
          "POST",
          "/rest/api/content",
          pageData
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

        const response = await confluenceRequest(
          "PUT",
          `/rest/api/content/${encodeURIComponent(pageId)}`,
          updateData
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

        const response = await confluenceRequest(
          "GET",
          `/rest/api/content/search?cql=${encodeURIComponent(query)}&limit=${encodeURIComponent(limit)}`
        );

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

        const response = await confluenceRequest(
          "GET",
          `/rest/api/content/${encodeURIComponent(pageId)}?expand=${encodeURIComponent("body.storage,version,space")}`
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