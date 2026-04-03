import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

// ── Types ──────────────────────────────────────────────────────────

interface ApiKey {
  name: string;
  secret: string;
}

interface AdminUser {
  username: string;
  password: string;
}

interface Session {
  username: string;
  createdAt: number;
}

// Extend Express Request to carry auth info
declare global {
  namespace Express {
    interface Request {
      apiKeyName?: string;
    }
  }
}

// ── Parse env vars ─────────────────────────────────────────────────

// API_KEYS="key1:secret1,key2:secret2"
function parseApiKeys(): ApiKey[] {
  const raw = process.env.API_KEYS;
  if (!raw) return [];
  return raw
    .split(",")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const idx = pair.indexOf(":");
      if (idx === -1) return null;
      return { name: pair.slice(0, idx), secret: pair.slice(idx + 1) };
    })
    .filter((k): k is ApiKey => k !== null);
}

// ADMIN_USERS="user1:pw1,user2:pw2"
function parseAdminUsers(): AdminUser[] {
  const raw = process.env.ADMIN_USERS;
  if (!raw) return [];
  return raw
    .split(",")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const idx = pair.indexOf(":");
      if (idx === -1) return null;
      return { username: pair.slice(0, idx), password: pair.slice(idx + 1) };
    })
    .filter((u): u is AdminUser => u !== null);
}

// ── State (lazy-initialized via initAuth) ──────────────────────────

let apiKeys: ApiKey[] = [];
let adminUsers: AdminUser[] = [];
let apiKeyAuthEnabled = false;
let adminAuthEnabled = false;
const sessions = new Map<string, Session>();

/**
 * Initialize auth from environment variables.
 * Must be called AFTER dotenv.config() so .env values are available.
 */
export function initAuth(): void {
  // AUTH_ENABLED=true|false (explicit toggle, default: auto-detect)
  const authEnabled =
    process.env.AUTH_ENABLED !== undefined
      ? process.env.AUTH_ENABLED === "true"
      : undefined; // undefined = auto-detect

  apiKeys = parseApiKeys();
  adminUsers = parseAdminUsers();

  // Effective auth state: explicit flag overrides auto-detect
  apiKeyAuthEnabled = authEnabled === false ? false : apiKeys.length > 0;
  adminAuthEnabled = authEnabled === false ? false : adminUsers.length > 0;
}

export function isAuthEnabled(): boolean {
  return apiKeyAuthEnabled || adminAuthEnabled;
}

export function getApiKeyCount(): number {
  return apiKeys.length;
}

export function getAdminUserCount(): number {
  return adminUsers.length;
}

// ── API Key middleware (for /hooks/*) ──────────────────────────────

export function apiKeyAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Skip auth if disabled
  if (!apiKeyAuthEnabled) {
    next();
    return;
  }

  // Check X-API-Key header first, then Authorization: Bearer
  let key = req.headers["x-api-key"] as string | undefined;
  if (!key) {
    const auth = req.headers.authorization;
    if (auth?.startsWith("Bearer ")) {
      key = auth.slice(7);
    }
  }

  if (!key) {
    res.status(401).json({ error: "API key required" });
    return;
  }

  const match = apiKeys.find((k) => k.secret === key);
  if (!match) {
    res.status(401).json({ error: "Invalid API key" });
    return;
  }

  // Attach key name for audit logging
  req.apiKeyName = match.name;
  next();
}

// ── Admin auth middleware (for /api/*) ─────────────────────────────

function validateToken(token: string | undefined): Session | null {
  if (!token) return null;
  return sessions.get(token) ?? null;
}

export function adminAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Skip auth if disabled
  if (!adminAuthEnabled) {
    next();
    return;
  }

  // Check Authorization: Bearer <token> or query param ?token=
  let token: string | undefined;
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    token = auth.slice(7);
  } else if (req.query.token) {
    token = String(req.query.token);
  }

  const session = validateToken(token);
  if (!session) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}

// ── Login handler ──────────────────────────────────────────────────

export function loginHandler(req: Request, res: Response): void {
  const { username, password } = req.body || {};

  if (!username || !password) {
    res.status(400).json({ error: "Username and password required" });
    return;
  }

  const user = adminUsers.find(
    (u) => u.username === username && u.password === password
  );

  if (!user) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const token = randomUUID();
  sessions.set(token, { username: user.username, createdAt: Date.now() });

  res.json({ token, username: user.username });
}

// ── Logout handler ─────────────────────────────────────────────────

export function logoutHandler(req: Request, res: Response): void {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    sessions.delete(auth.slice(7));
  }
  res.json({ message: "Logged out" });
}

// ── Me handler ─────────────────────────────────────────────────────

export function meHandler(req: Request, res: Response): void {
  // Auth is disabled
  if (!adminAuthEnabled) {
    res.json({ authRequired: false });
    return;
  }

  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.json({ authRequired: true });
    return;
  }

  const session = sessions.get(auth.slice(7));
  if (!session) {
    res.json({ authRequired: true });
    return;
  }

  res.json({ authRequired: true, username: session.username });
}
