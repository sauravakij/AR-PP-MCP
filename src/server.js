import express from "express";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
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
        fromDate: dateSchema.describe("Start date, YYYY-MM-DD"),
        toDate: dateSchema.describe("Inclusive end date, YYYY-MM-DD"),
      },
    },
    async ({ plantId, fromDate, toDate }) => {
      const rows = await runQuery(QUERY_SUMMARY, {
        PlantId: { type: sql.BigInt, value: plantId ?? null },
        FromDate: { type: sql.DateTime, value: dateRange(fromDate, toDate).from },
        ToDateExclusive: { type: sql.DateTime, value: dateRange(fromDate, toDate).toExclusive },
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
        fromDate: dateSchema.describe("Start date, YYYY-MM-DD"),
        toDate: dateSchema.describe("Inclusive end date, YYYY-MM-DD"),
        maxRows: z.number().int().min(1).max(1000).default(200),
      },
    },
    async ({ plantId, issueStatus, fromDate, toDate, maxRows }) => {
      const rows = await runQuery(QUERY_LIST_VARIANCE, {
        PlantId: { type: sql.BigInt, value: plantId ?? null },
        IssueStatus: { type: sql.NVarChar, value: issueStatus ?? null },
        FromDate: { type: sql.DateTime, value: dateRange(fromDate, toDate).from },
        ToDateExclusive: { type: sql.DateTime, value: dateRange(fromDate, toDate).toExclusive },
        MaxRows: { type: sql.Int, value: maxRows },
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

const sessions = new Map();
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const dateSchema = z
  .string()
  .regex(DATE_PATTERN, "Date must use YYYY-MM-DD")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "Date is invalid")
  .optional();

export function dateRange(fromDate, toDate) {
  return {
    from: fromDate ? new Date(`${fromDate}T00:00:00.000Z`) : null,
    toExclusive: toDate
      ? new Date(new Date(`${toDate}T00:00:00.000Z`).getTime() + 86400000)
      : null,
  };
}

function isAuthorized(req) {
  const expected = process.env.MCP_API_KEY;
  const getHeader = (name) => (typeof req.get === "function" ? req.get(name) : req.headers?.[name]);
  const supplied = getHeader("x-api-key") || getHeader("authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(expected && supplied && supplied === expected);
}

function rejectUnauthorized(req, res) {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return true;
  }
  return false;
}

function closeSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;
  sessions.delete(sessionId);
  session.transport.close();
  session.server.close();
}

export async function handleMcpRequest(req, res) {
  if (rejectUnauthorized(req, res)) return;

  const sessionId = typeof req.get === "function" ? req.get("mcp-session-id") : req.headers?.["mcp-session-id"];
  try {
    if (req.method === "GET" || req.method === "DELETE") {
      const session = sessionId && sessions.get(sessionId);
      if (!session) {
        res.status(404).json({ error: "MCP session not found" });
        return;
      }
      await session.transport.handleRequest(req, res, req.body);
      if (req.method === "DELETE") closeSession(sessionId);
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    if (sessionId) {
      const session = sessions.get(sessionId);
      if (!session) {
        res.status(404).json({ error: "MCP session not found" });
        return;
      }
      await session.transport.handleRequest(req, res, req.body);
      return;
    }

    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (newSessionId) => {
        sessions.set(newSessionId, { server, transport });
      },
    });
    res.on("close", () => {
      const newSessionId = transport.sessionId;
      if (!newSessionId) {
        transport.close();
        server.close();
      }
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
}

app.all("/mcp", handleMcpRequest);

app.get("/healthz", (_req, res) => res.json({ ok: true }));

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (process.env.VERCEL === undefined && isMainModule) {
  const PORT = process.env.PORT || 3300;
  app.listen(PORT, () => {
    console.log(`Production Plan Variance MCP server listening on :${PORT} (POST /mcp)`);
  });
}
