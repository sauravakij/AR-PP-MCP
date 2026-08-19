---
name: production-variance-project
description: Use when changing, testing, reviewing, or deploying this Production Plan Variance MCP project.
---

# Production Variance Project

Maintain this project as a read-only, authenticated MCP gateway to the DWH production variance dashboard.

## Rules

- Never expose database credentials in source, logs, client configuration, or commits.
- Keep database access limited to fixed, parameterized SELECT queries.
- Require `MCP_API_KEY` for MCP requests in deployed environments.
- Validate all tool input before constructing database parameters.
- Use inclusive calendar dates by converting an end date to the next UTC day and using a half-open SQL range.
- Keep row-level responses bounded and document any business-logic assumptions.
- Preserve MCP session behavior for POST, GET, and DELETE requests.
- Run the test suite before committing or deploying.
- Update `README.md` and this skill when behavior, configuration, schema assumptions, or deployment steps change.

## Release Checklist

- `npm test`
- `npm start` smoke test or equivalent local handler test
- Confirm Vercel Production environment variables are configured
- Confirm Git status contains only intended files
- Deploy and verify `/healthz` and an authenticated MCP initialize request
