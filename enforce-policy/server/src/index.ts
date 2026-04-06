import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, copyFileSync } from "node:fs";
import dotenv from "dotenv";
import express from "express";
import { loadPolicies, watchPolicies, getPolicies } from "./engine.js";
import { initLogger, type AuditBackend } from "./logger.js";
import { preToolUseHandler } from "./handlers/pre-tool-use.js";
import { postToolUseHandler } from "./handlers/post-tool-use.js";
import policiesRouter from "./api/policies.js";
import auditRouter from "./api/audit.js";
import {
  initAuth,
  apiKeyAuth,
  adminAuth,
  loginHandler,
  logoutHandler,
  meHandler,
  getApiKeyCount,
  getAdminUserCount,
  isAuthEnabled,
} from "./middleware/auth.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load .env (before anything reads process.env) ──────────────────

dotenv.config({ path: resolve(__dirname, "../.env") });

// ── Initialize auth (after dotenv) ─────────────────────────────────

initAuth();

// ── Express app ────────────────────────────────────────────────────

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

const auditConfig = getPolicies()?.audit;

function parseAuditBackend(value?: string): AuditBackend {
  if (!value || value === "sqlite") return "sqlite";
  if (value === "postgres") return "postgres";
  throw new Error(
    `Invalid audit backend '${value}'. Supported values are 'sqlite' and 'postgres'.`
  );
}

const auditBackend = parseAuditBackend(
  process.env.AUDIT_BACKEND || auditConfig?.backend
);
const auditDbFile = resolve(
  policyDir,
  process.env.AUDIT_SQLITE_DB || auditConfig?.db_file || "audit.sqlite"
);
const auditPostgresUrl =
  process.env.AUDIT_POSTGRES_URL ||
  process.env.DATABASE_URL ||
  auditConfig?.postgres_url;

await initLogger({
  backend: auditBackend,
  sqliteFile: auditBackend === "sqlite" ? auditDbFile : undefined,
  postgresUrl: auditBackend === "postgres" ? auditPostgresUrl : undefined,
});

// ── Auth routes (before middleware) ────────────────────────────────

app.post("/api/auth/login", loginHandler);
app.post("/api/auth/logout", logoutHandler);
app.get("/api/auth/me", meHandler);

// ── Health check (no auth) ─────────────────────────────────────────

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

// ── Hook endpoints (Claude Code calls these) ───────────────────────

app.post("/hooks/pre-tool-use", apiKeyAuth, preToolUseHandler);
app.post("/hooks/post-tool-use", apiKeyAuth, postToolUseHandler);

// ── Admin API (requires admin auth) ────────────────────────────────

app.use("/api/policies", adminAuth, policiesRouter);
app.use("/api/audit", adminAuth, auditRouter);

// ── Admin UI (static files) ────────────────────────────────────────

app.use(express.static(resolve(__dirname, "ui")));

// ── Start server ───────────────────────────────────────────────────

const PORT = parseInt(process.env.POLICY_PORT || "3456");
const HOST = process.env.POLICY_HOST || "127.0.0.1";
const keyCount = getApiKeyCount();
const userCount = getAdminUserCount();

app.listen(PORT, HOST, () => {
  const baseUrl = HOST === "0.0.0.0" ? `http://localhost:${PORT}` : `http://${HOST}:${PORT}`;
  console.log(`[server] Policy enforcement server running on ${HOST}:${PORT}`);
  console.log(`[server] Admin UI: ${baseUrl}`);
  console.log(`[server] Hook endpoints:`);
  console.log(`  POST ${baseUrl}/hooks/pre-tool-use`);
  console.log(`  POST ${baseUrl}/hooks/post-tool-use`);
  console.log(`[server] API Keys: ${keyCount} configured`);
  console.log(`[server] Admin Users: ${userCount} configured`);
  console.log(`[server] Auth: ${isAuthEnabled() ? "enabled" : "disabled"}`);
});
