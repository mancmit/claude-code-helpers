import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, copyFileSync } from "node:fs";
import express from "express";
import { loadPolicies, watchPolicies, getPolicies } from "./engine.js";
import { initLogger } from "./logger.js";
import { preToolUseHandler } from "./handlers/pre-tool-use.js";
import { postToolUseHandler } from "./handlers/post-tool-use.js";
import policiesRouter from "./api/policies.js";
import auditRouter from "./api/audit.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());

// ── Resolve policy file ────────────────────────────────────────────

const policyDir = resolve(__dirname, "../..");
const policyFile = resolve(policyDir, "policies.yml");
const exampleFile = resolve(policyDir, "policies.example.yml");

if (!existsSync(policyFile) && existsSync(exampleFile)) {
  copyFileSync(exampleFile, policyFile);
  console.log(`[server] Created policies.yml from example`);
}

if (existsSync(policyFile)) {
  loadPolicies(policyFile);
  watchPolicies(policyFile);
} else {
  console.warn(`[server] No policies.yml found at ${policyFile}`);
}

// ── Audit log ──────────────────────────────────────────────────────

const auditLogFile =
  process.env.AUDIT_LOG || resolve(policyDir, "audit.jsonl");
initLogger(auditLogFile);

// ── Hook endpoints (Claude Code calls these) ───────────────────────

app.post("/hooks/pre-tool-use", preToolUseHandler);
app.post("/hooks/post-tool-use", postToolUseHandler);

// ── Admin API ──────────────────────────────────────────────────────

app.use("/api/policies", policiesRouter);
app.use("/api/audit", auditRouter);

app.get("/api/health", (_req, res) => {
  const config = getPolicies();
  const uptime = process.uptime();
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);

  res.json({
    status: "ok",
    policies: config?.policies.filter((p) => p.enabled).length ?? 0,
    uptime: `${hours}h ${minutes}m`,
  });
});

// ── Admin UI (static files) ────────────────────────────────────────

app.use(express.static(resolve(__dirname, "ui")));

// ── Start server ───────────────────────────────────────────────────

const PORT = parseInt(process.env.POLICY_PORT || "3456");

app.listen(PORT, "127.0.0.1", () => {
  console.log(`[server] Policy enforcement server running on http://localhost:${PORT}`);
  console.log(`[server] Admin UI: http://localhost:${PORT}`);
  console.log(`[server] Hook endpoints:`);
  console.log(`  POST http://localhost:${PORT}/hooks/pre-tool-use`);
  console.log(`  POST http://localhost:${PORT}/hooks/post-tool-use`);
});
