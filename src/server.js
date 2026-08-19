import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { runQuery, sql } from "./db.js";
import {
  QUERY_SUMMARY,
  QUERY_LIST_VARIANCE,
  QUERY_VARIANCE_REASONS,
  QUERY_PLANTS,
  QUERY_SHOP_FLOORS,
} from "./queries.js";

// ---------------------------------------------------------------------------
// MCP server definition
// ---------------------------------------------------------------------------
export function buildServer() {
  const server = new McpServer({
    name: "production-plan-variance",
    version: "1.0.0",
  });

  server.registerTool(
    "list_plants",
    {
      title: "List plants",
      description:
        "List active plants available as a filter on the Production Plan Variance & Issue Tracking dashboard.",
      inputSchema: {},
    },
    async () => {
      const rows = await runQuery(QUERY_PLANTS);
      return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
    }
  );

  server.registerTool(
    "list_shop_floors",
    {
      title: "List shop floors",
      description: "List active shop floors, optionally filtered by plant.",
      inputSchema: {
        plantId: z.number().int().optional().describe("Filter to a specific plant ID (from list_plants)"),
      },
    },
    async ({ plantId }) => {
      const rows = await runQuery(QUERY_SHOP_FLOORS, {
        PlantId: { type: sql.BigInt, value: plantId ?? null },
      });
      return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
    }
  );

  server.registerTool(
    "get_variance_summary",
    {
      title: "Get variance dashboard summary",
      description:
        "Returns the four summary tiles from the dashboard: Plan Lines, On Target, Variance Flagged, and Issues Missing, for a plant and date range.",
      inputSchema: {
        plantId: z.number().int().optional().describe("Plant ID (from list_plants). Omit for all plants."),
        fromDate: z.string().optional().describe("Start date, ISO format e.g. 2026-08-01"),
        toDate: z.string().optional().describe("End date, ISO format e.g. 2026-08-22"),
      },
    },
    async ({ plantId, fromDate, toDate }) => {
      const rows = await runQuery(QUERY_SUMMARY, {
        PlantId: { type: sql.BigInt, value: plantId ?? null },
        FromDate: { type: sql.DateTime, value: fromDate ? new Date(fromDate) : null },
        ToDate: { type: sql.DateTime, value: toDate ? new Date(toDate) : null },
      });
      return { content: [{ type: "text", text: JSON.stringify(rows[0] ?? {}, null, 2) }] };
    }
  );

  server.registerTool(
    "list_plan_variance",
    {
      title: "List production plan variance rows",
      description:
        "Returns the row-level grid from the dashboard: plan code, item, plant, planned/output qty, difference, issue reason, remarks, and issue status. Supports filtering by plant, issue status, and date range.",
      inputSchema: {
        plantId: z.number().int().optional(),
        issueStatus: z.string().optional().describe("e.g. 'Pending', 'Resolved'"),
        fromDate: z.string().optional().describe("ISO date"),
        toDate: z.string().optional().describe("ISO date"),
      },
    },
    async ({ plantId, issueStatus, fromDate, toDate }) => {
      const rows = await runQuery(QUERY_LIST_VARIANCE, {
        PlantId: { type: sql.BigInt, value: plantId ?? null },
        IssueStatus: { type: sql.NVarChar, value: issueStatus ?? null },
        FromDate: { type: sql.DateTime, value: fromDate ? new Date(fromDate) : null },
        ToDate: { type: sql.DateTime, value: toDate ? new Date(toDate) : null },
      });
      return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
    }
  );

  server.registerTool(
    "list_variance_reasons",
    {
      title: "List variance reason config",
      description:
        "Lists the 'Issue for Difference' reason codes configured per plant, with their escalation email addresses.",
      inputSchema: {
        plantId: z.number().int().optional(),
      },
    },
    async ({ plantId }) => {
      const rows = await runQuery(QUERY_VARIANCE_REASONS, {
        PlantId: { type: sql.BigInt, value: plantId ?? null },
      });
      return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
    }
  );

  return server;
}

// ---------------------------------------------------------------------------
// HTTP transport — stateless-friendly Streamable HTTP endpoint at /mcp
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  try {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request error:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

app.get("/healthz", (_req, res) => res.json({ ok: true }));

if (process.env.VERCEL === undefined) {
  const PORT = process.env.PORT || 3300;
  app.listen(PORT, () => {
    console.log(`Production Plan Variance MCP server listening on :${PORT} (POST /mcp)`);
  });
}
