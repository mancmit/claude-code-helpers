import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Response } from "express";
import { Client } from "pg";

// ── Types ──────────────────────────────────────────────────────────

export interface AuditEntry {
  timestamp: string;
  session_id: string;
  event: string;
  tool_name: string;
  decision: "allow" | "deny" | "block" | "warn";
  policy_name?: string;
  reason?: string;
  detail: string;
  cwd: string;
  api_key_name?: string;
}

export interface AuditFilters {
  decision?: string;
  tool?: string;
  session?: string;
  from?: string;
  to?: string;
}

export type AuditBackend = "sqlite" | "postgres";

export interface LoggerOptions {
  backend: AuditBackend;
  sqliteFile?: string;
  postgresUrl?: string;
}

// ── Ring Buffer ────────────────────────────────────────────────────

const BUFFER_SIZE = 1000;
const buffer: AuditEntry[] = [];
let sqliteFile: string | null = null;
let sqliteDb: DatabaseSync | null = null;
let postgresClient: Client | null = null;
let activeBackend: AuditBackend = "sqlite";

// SSE clients
const sseClients = new Set<Response>();

function createSqliteSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS audit_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      session_id TEXT NOT NULL,
      event TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      decision TEXT NOT NULL,
      policy_name TEXT,
      reason TEXT,
      detail TEXT NOT NULL,
      cwd TEXT NOT NULL,
      api_key_name TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_audit_timestamp
      ON audit_entries(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_decision_timestamp
      ON audit_entries(decision, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_tool_timestamp
      ON audit_entries(tool_name, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_session_timestamp
      ON audit_entries(session_id, timestamp DESC);
  `);
}

async function createPostgresSchema(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS audit_entries (
      id BIGSERIAL PRIMARY KEY,
      timestamp TIMESTAMPTZ NOT NULL,
      session_id TEXT NOT NULL,
      event TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      decision TEXT NOT NULL,
      policy_name TEXT,
      reason TEXT,
      detail TEXT NOT NULL,
      cwd TEXT NOT NULL,
      api_key_name TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_audit_timestamp
      ON audit_entries(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_decision_timestamp
      ON audit_entries(decision, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_tool_timestamp
      ON audit_entries(tool_name, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_session_timestamp
      ON audit_entries(session_id, timestamp DESC);
  `);
}

function hydrateBuffer(entries: AuditEntry[]): void {
  buffer.length = 0;
  for (const entry of entries.slice(-BUFFER_SIZE)) {
    buffer.push(entry);
  }
}

function loadBufferFromSqlite(): void {
  if (!sqliteDb) return;

  const rows = sqliteDb
    .prepare(
      `
        SELECT timestamp, session_id, event, tool_name, decision, policy_name,
               reason, detail, cwd, api_key_name
        FROM audit_entries
        ORDER BY timestamp DESC
        LIMIT ?
      `
    )
    .all(BUFFER_SIZE) as unknown as AuditEntry[];

  hydrateBuffer(rows.reverse());
  console.log(`[logger] Loaded ${buffer.length} entries from ${sqliteFile}`);
}

async function loadBufferFromPostgres(): Promise<void> {
  if (!postgresClient) return;

  const result = await postgresClient.query<AuditEntry>(
    `
      SELECT timestamp::text, session_id, event, tool_name, decision, policy_name,
             reason, detail, cwd, api_key_name
      FROM audit_entries
      ORDER BY timestamp DESC
      LIMIT $1
    `,
    [BUFFER_SIZE]
  );

  hydrateBuffer(result.rows.reverse());
  console.log(`[logger] Loaded ${buffer.length} entries from postgres`);
}

export async function initLogger(options: LoggerOptions): Promise<void> {
  activeBackend = options.backend;

  if (options.backend === "sqlite") {
    if (!options.sqliteFile) {
      throw new Error("SQLite backend requires sqliteFile");
    }
    sqliteFile = options.sqliteFile;
    mkdirSync(dirname(options.sqliteFile), { recursive: true });
    sqliteDb = new DatabaseSync(options.sqliteFile);
    createSqliteSchema(sqliteDb);
    loadBufferFromSqlite();
    console.log(`[logger] Audit backend: sqlite`);
    console.log(`[logger] Audit database: ${options.sqliteFile}`);
  } else {
    if (!options.postgresUrl) {
      throw new Error("Postgres backend requires postgresUrl");
    }
    postgresClient = new Client({ connectionString: options.postgresUrl });
    await postgresClient.connect();
    await createPostgresSchema(postgresClient);
    await loadBufferFromPostgres();
    console.log(`[logger] Audit backend: postgres`);
  }
}

// ── Log Decision ───────────────────────────────────────────────────

export async function logDecision(entry: AuditEntry): Promise<void> {
  // Add to ring buffer
  buffer.push(entry);
  if (buffer.length > BUFFER_SIZE) {
    buffer.shift();
  }

  if (sqliteDb) {
    try {
      sqliteDb.prepare(
        `
          INSERT INTO audit_entries (
            timestamp, session_id, event, tool_name, decision,
            policy_name, reason, detail, cwd, api_key_name
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      ).run(
        entry.timestamp,
        entry.session_id,
        entry.event,
        entry.tool_name,
        entry.decision,
        entry.policy_name ?? null,
        entry.reason ?? null,
        entry.detail,
        entry.cwd,
        entry.api_key_name ?? null
      );
    } catch (err) {
      console.error(`[logger] Failed to write audit database:`, err);
    }
  }

  if (postgresClient) {
    try {
      await postgresClient.query(
        `
          INSERT INTO audit_entries (
            timestamp, session_id, event, tool_name, decision,
            policy_name, reason, detail, cwd, api_key_name
          ) VALUES ($1::timestamptz, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
        [
          entry.timestamp,
          entry.session_id,
          entry.event,
          entry.tool_name,
          entry.decision,
          entry.policy_name ?? null,
          entry.reason ?? null,
          entry.detail,
          entry.cwd,
          entry.api_key_name ?? null,
        ]
      );
    } catch (err) {
      console.error(`[logger] Failed to write audit postgres:`, err);
    }
  }

  // Notify SSE clients
  for (const client of sseClients) {
    try {
      client.write(`data: ${JSON.stringify(entry)}\n\n`);
    } catch {
      sseClients.delete(client);
    }
  }
}

// ── Query ──────────────────────────────────────────────────────────

function normalizeFromDate(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizeExclusiveToDate(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
}

export async function getRecentEntries(
  limit: number = 50,
  offset: number = 0,
  filters?: AuditFilters
): Promise<{ entries: AuditEntry[]; total: number }> {
  if (sqliteDb) {
    const clauses: string[] = [];
    const params: Array<string | number> = [];

    if (filters?.decision) {
      clauses.push("decision = ?");
      params.push(filters.decision);
    }
    if (filters?.tool) {
      clauses.push("tool_name = ?");
      params.push(filters.tool);
    }
    if (filters?.session) {
      clauses.push("session_id = ?");
      params.push(filters.session);
    }
    const from = normalizeFromDate(filters?.from);
    if (from) {
      clauses.push("timestamp >= ?");
      params.push(from);
    }
    const to = normalizeExclusiveToDate(filters?.to);
    if (to) {
      clauses.push("timestamp < ?");
      params.push(to);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const total = (
      sqliteDb.prepare(`SELECT COUNT(*) AS count FROM audit_entries ${where}`).get(
        ...params
      ) as { count: number }
    ).count;

    const entries = sqliteDb
      .prepare(
        `
          SELECT timestamp, session_id, event, tool_name, decision, policy_name,
                 reason, detail, cwd, api_key_name
          FROM audit_entries
          ${where}
          ORDER BY timestamp DESC
          LIMIT ? OFFSET ?
        `
      )
      .all(...params, limit, offset) as unknown as AuditEntry[];

    return { entries, total };
  }

  if (postgresClient) {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    let index = 1;

    if (filters?.decision) {
      clauses.push(`decision = $${index++}`);
      params.push(filters.decision);
    }
    if (filters?.tool) {
      clauses.push(`tool_name = $${index++}`);
      params.push(filters.tool);
    }
    if (filters?.session) {
      clauses.push(`session_id = $${index++}`);
      params.push(filters.session);
    }
    const from = normalizeFromDate(filters?.from);
    if (from) {
      clauses.push(`timestamp >= $${index++}::timestamptz`);
      params.push(from);
    }
    const to = normalizeExclusiveToDate(filters?.to);
    if (to) {
      clauses.push(`timestamp < $${index++}::timestamptz`);
      params.push(to);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const totalResult = await postgresClient.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM audit_entries ${where}`,
      params
    );

    const entriesResult = await postgresClient.query<AuditEntry>(
      `
        SELECT timestamp::text, session_id, event, tool_name, decision, policy_name,
               reason, detail, cwd, api_key_name
        FROM audit_entries
        ${where}
        ORDER BY timestamp DESC
        LIMIT $${index++} OFFSET $${index++}
      `,
      [...params, limit, offset]
    );

    return {
      entries: entriesResult.rows,
      total: Number(totalResult.rows[0]?.count ?? "0"),
    };
  }

  let filtered = [...buffer].reverse();

  if (filters?.decision) {
    filtered = filtered.filter((e) => e.decision === filters.decision);
  }
  if (filters?.tool) {
    filtered = filtered.filter((e) => e.tool_name === filters.tool);
  }
  if (filters?.session) {
    filtered = filtered.filter((e) => e.session_id === filters.session);
  }
  if (filters?.from) {
    const from = new Date(filters.from).getTime();
    filtered = filtered.filter((e) => new Date(e.timestamp).getTime() >= from);
  }
  if (filters?.to) {
    const to = new Date(filters.to).getTime() + 86400000; // end of day
    filtered = filtered.filter((e) => new Date(e.timestamp).getTime() < to);
  }

  const total = filtered.length;
  const entries = filtered.slice(offset, offset + limit);
  return { entries, total };
}

// ── Stats ──────────────────────────────────────────────────────────

export async function getStats(): Promise<{
  allowed: number;
  denied: number;
  blocked: number;
  warned: number;
  policies: number;
}> {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(`${today}T00:00:00.000Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  if (sqliteDb) {
    const rows = sqliteDb
      .prepare(
        `
          SELECT decision, COUNT(*) AS count
          FROM audit_entries
          WHERE timestamp >= ? AND timestamp < ?
          GROUP BY decision
        `
      )
      .all(`${today}T00:00:00.000Z`, tomorrow.toISOString()) as Array<{
      decision: AuditEntry["decision"];
      count: number;
    }>;

    const counts = new Map(rows.map((row) => [row.decision, row.count]));

    return {
      allowed: counts.get("allow") ?? 0,
      denied: counts.get("deny") ?? 0,
      blocked: counts.get("block") ?? 0,
      warned: counts.get("warn") ?? 0,
      policies: 0,
    };
  }

  if (postgresClient) {
    const result = await postgresClient.query<{
      decision: AuditEntry["decision"];
      count: string;
    }>(
      `
        SELECT decision, COUNT(*)::text AS count
        FROM audit_entries
        WHERE timestamp >= $1::timestamptz AND timestamp < $2::timestamptz
        GROUP BY decision
      `,
      [`${today}T00:00:00.000Z`, tomorrow.toISOString()]
    );

    const counts = new Map(
      result.rows.map((row) => [row.decision, Number(row.count)])
    );

    return {
      allowed: counts.get("allow") ?? 0,
      denied: counts.get("deny") ?? 0,
      blocked: counts.get("block") ?? 0,
      warned: counts.get("warn") ?? 0,
      policies: 0,
    };
  }

  const todayEntries = buffer.filter((e) => e.timestamp.startsWith(today));

  return {
    allowed: todayEntries.filter((e) => e.decision === "allow").length,
    denied: todayEntries.filter((e) => e.decision === "deny").length,
    blocked: todayEntries.filter((e) => e.decision === "block").length,
    warned: todayEntries.filter((e) => e.decision === "warn").length,
    policies: 0, // will be set by caller
  };
}

// ── SSE Stream ─────────────────────────────────────────────────────

export function addSSEClient(res: Response): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
  sseClients.add(res);

  res.on("close", () => {
    sseClients.delete(res);
  });
}
