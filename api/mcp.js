import { handleMcpRequest } from "../src/server.js";

// Vercel serverless function: POST /api/mcp (exposed as /mcp via vercel.json rewrite)
export default async function handler(req, res) {
  await handleMcpRequest(req, res);
}
