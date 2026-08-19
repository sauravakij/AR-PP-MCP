# Production Plan Variance MCP Server

A small MCP server that exposes the **Production Plan Variance & Issue Tracking**
dashboard (`erp.peopledesk.io/production-management/mes/ProductionPlanVariance`)
as five read-only tools, backed directly by the `DWH` database:

| Tool                    | Mirrors                                            |
|-------------------------|-----------------------------------------------------|
| `get_variance_summary`  | The four tiles: Plan Lines / On Target / Variance Flagged / Issues Missing |
| `list_plan_variance`    | The row grid (plan code, item, plant, qty, difference, reason, status) |
| `list_variance_reasons` | The "Issue for Difference" reason config + escalation emails, per plant |
| `list_plants`           | Plant filter dropdown |
| `list_shop_floors`      | Shop Floor filter dropdown |

It queries these DWH tables (verified against the live schema):
`tblProductionPlanVarianceIssueArc`, `tblProductionPlanVarianceReasonArc`,
`tblPlantArc`, `tblShopFloorArc`.

## Why this shape

You asked for something anyone can use via a JSON file, without anyone
entering database credentials. So the design is:

- **One server, hosted by you**, holding the DB credentials in its own
  environment variables (`.env`, never committed, never sent to clients).
- **Everyone else** just drops `mcp-config.json` into their MCP client
  (Claude Desktop, Claude Code, etc.) — it only contains a URL, nothing
  secret. The server is the only thing that talks to SQL Server.
- All queries are **fixed, parameterized SELECTs** defined in `src/queries.js`
  — there is no free-form SQL tool exposed, so nobody using this MCP server
  can query outside the dashboard's own data or run writes.

## ⚠️ Before you deploy: confirm DB permissions

While building this, I verified the schema (tables/columns) using your
`mssql-test-server` connection, but every actual row-level `SELECT` against
`tblProductionPlanVarianceIssueArc` / `tblPlantArc` etc. failed — schema
introspection worked, data queries didn't. That's almost certainly a
**permissions gap on that specific SQL login** (`mcp_user`), not a problem
with these queries. Before going live:

1. Create (or reuse) a SQL Server login with `SELECT`-only rights on the DWH
   tables listed above.
2. Test manually, e.g.:
   ```sql
   SELECT TOP 5 * FROM dbo.tblProductionPlanVarianceIssueArc;
   ```
3. Only then point `DB_USER`/`DB_PASSWORD` in `.env` at that login.

## Deploy

### Option A — your own server (nginx/Caddy in front)

```bash
npm install
cp .env.example .env    # fill in database values and MCP_API_KEY
npm start                # listens on :3300, endpoint /mcp
```

Every MCP request must include the configured API key as either `x-api-key` or
`Authorization: Bearer <key>`. The shared client configuration uses the
`MCP_API_KEY` environment variable and must not contain the literal key.

Put it behind HTTPS on a domain reachable by your team, e.g.
`https://mcp.yourcompany.com/mcp`.

### Option B — Vercel (already set up in this repo)

The `api/mcp.js` + `vercel.json` files convert the same server into a
Vercel serverless function, exposed at `/mcp`.

1. Push this folder to a GitHub repo (or run from the folder directly).
2. Install the CLI once: `npm i -g vercel`
3. From inside `production-variance-mcp/`, log into **your own** Vercel
   account and deploy:
   ```bash
   vercel login
   vercel --prod
   ```
4. In the Vercel dashboard → your project → **Settings → Environment
   Variables**, add `DB_SERVER`, `DB_PORT`, `DB_DATABASE`, `DB_USER`,
   `DB_PASSWORD`, `DB_ENCRYPT`, `DB_TRUST_CERT`, and a long random
   `MCP_API_KEY` for the **Production** environment, then redeploy.
5. Your MCP endpoint is now `https://<your-project>.vercel.app/mcp`.
   Put that URL into `mcp-config.json` and hand it out.

Note: SQL Server must be reachable from Vercel's network (i.e. not
firewalled to only your office IP) — check with whoever manages
`203.202.241.211` if the connection times out after deploying. Also add
some form of auth in front of `/mcp` (see note below) before this URL is
public — right now anyone with the link can call these read-only tools.

## Distribute

Edit `mcp-config.json`, replacing `YOUR-HOSTED-DOMAIN` with your real
domain, then share that one file. Anyone adds it to their MCP client and
immediately has read-only chat access to this dashboard's data — no
install, no credentials, no SQL knowledge required.

## Notes / things to double check on your end

- The dashboard's **"Machine"** column (e.g. "Aromatic Unit Line - 01")
  wasn't found on `tblProductionPlanVarianceIssueArc` in the schema I
  pulled — it's likely resolved via a production line/work-center table in
  your environment. `list_plan_variance`'s query doesn't include it yet;
  add the appropriate JOIN in `src/queries.js` once you confirm the source
  table (candidates: `tblProductionLineArc`, `tblWorkCenterArc`).
- `get_variance_summary`'s "Issues Missing" logic assumes it means "flagged
  variance with no reason/status recorded yet" — confirm this against the
  app's actual business logic and adjust `QUERY_SUMMARY` if different.
- The server requires `MCP_API_KEY` authentication. Rotate the key by updating
  Vercel and the client environment variable together.
- `list_plan_variance` defaults to 200 rows and accepts `maxRows` up to 1000.
- Date filters use inclusive calendar end dates.
- Run `npm test` before deployment.
