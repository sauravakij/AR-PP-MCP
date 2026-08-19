import sql from "mssql";

// ---------------------------------------------------------------------------
// Connection config — credentials live ONLY here, server-side, via env vars.
// End users of the MCP config never see or enter these.
// ---------------------------------------------------------------------------
const config = {
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT || "1433", 10),
  database: process.env.DB_DATABASE || "DWH",
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    encrypt: process.env.DB_ENCRYPT !== "false",
    trustServerCertificate: process.env.DB_TRUST_CERT === "true",
  },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
};

let poolPromise;
function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(config).connect();
  }
  return poolPromise;
}

/**
 * Runs a parameterized, read-only query.
 * `params` is a map of { name: { type, value } } using mssql's sql.* types.
 * This app never builds SQL by string-concatenating user input, and only
 * ever issues SELECT statements defined in queries.js — there is no
 * free-form SQL tool exposed to MCP clients.
 */
export async function runQuery(queryText, params = {}) {
  const pool = await getPool();
  const request = pool.request();
  for (const [name, { type, value }] of Object.entries(params)) {
    request.input(name, type, value);
  }
  const result = await request.query(queryText);
  return result.recordset;
}

export { sql };
