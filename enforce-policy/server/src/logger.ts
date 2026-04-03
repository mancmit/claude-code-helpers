import { appendFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Response } from "express";

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
}

export interface AuditFilters {
  decision?: string;
  tool?: string;
  session?: string;
  from?: string;
  to?: string;
}

// ── Ring Buffer ────────────────────────────────────────────────────

const BUFFER_SIZE = 1000;
const buffer: AuditEntry[] = [];
let logFile: string | null = null;

// SSE clients
const sseClients = new Set<Response>();

export function initLogger(file: string): void {
  logFile = file;
  mkdirSync(dirname(file), { recursive: true });

  // Load existing entries from audit file into ring buffer
  if (existsSync(file)) {
    try {
      const lines = readFileSync(file, "utf-8").split("\n").filter(Boolean);
      // Only load the last BUFFER_SIZE entries
      const tail = lines.slice(-BUFFER_SIZE);
      for (const line of tail) {
        try {
          buffer.push(JSON.parse(line) as AuditEntry);
        } catch {
          // skip malformed lines
        }
      }
      console.log(`[logger] Loaded ${buffer.length} entries from ${file}`);
    } catch (err) {
      console.error(`[logger] Failed to load audit log:`, err);
    }
  }

  console.log(`[logger] Audit log: ${file}`);
}

// ── Log Decision ───────────────────────────────────────────────────

export function logDecision(entry: AuditEntry): void {
  // Add to ring buffer
  buffer.push(entry);
  if (buffer.length > BUFFER_SIZE) {
    buffer.shift();
  }

  // Append to JSONL file
  if (logFile) {
    try {
      appendFileSync(logFile, JSON.stringify(entry) + "\n");
    } catch (err) {
      console.error(`[logger] Failed to write audit log:`, err);
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

export function getRecentEntries(
  limit: number = 50,
  offset: number = 0,
  filters?: AuditFilters
): { entries: AuditEntry[]; total: number } {
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

export function getStats(): {
  allowed: number;
  denied: number;
  blocked: number;
  warned: number;
  policies: number;
} {
  const today = new Date().toISOString().slice(0, 10);
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
