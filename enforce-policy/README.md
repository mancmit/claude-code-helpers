# enforce-policy

HTTP-based policy enforcement server for Claude Code. Block dangerous commands, restrict file access, and enforce code quality via configurable YAML policies. Includes an Admin UI for managing policies and viewing audit logs in real time.

## Table of Contents

- [What does the hook do?](#what-does-the-hook-do)
- [Prerequisites](#prerequisites)
- [File structure](#file-structure)
- [Quick start](#quick-start)
- [Authentication](#authentication)
- [Policy configuration](#policy-configuration)
- [Admin UI](#admin-ui)
- [API reference](#api-reference)
- [Setup (Global)](#setup-global)
- [Setup (Per-project)](#setup-per-project)
- [Troubleshooting](#troubleshooting)

## What does the hook do?

| Property | Value |
|----------|-------|
| **Type** | HTTP hook |
| **Events** | `PreToolUse` (all tools), `PostToolUse` (Write, Edit) |
| **Behavior** | Evaluates tool calls against YAML-defined policies. Blocks dangerous commands, restricts file access, detects hardcoded secrets. |
| **Output** | Returns `allow`, `deny`, or `block` decisions. Logs all decisions to JSONL audit file. |
| **Admin UI** | Dashboard with live stats, policy management, and filterable audit log at `http://localhost:3456`. |

### How it works

1. Claude Code sends an HTTP POST to the policy server before/after each tool use
2. The server evaluates the tool call against enabled policies
3. If a policy rule matches, the server returns a deny/block response
4. Claude Code respects the decision and shows the reason to the user
5. All decisions (allow + deny) are logged for auditing

## Prerequisites

- **Node.js** >= 18
- **npm** (comes with Node.js)
- **Claude Code** CLI installed

## File structure

```
enforce-policy/
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env.example              # Environment variables template
│   └── src/
│       ├── index.ts              # Express server entry point
│       ├── engine.ts             # Policy loading + evaluation engine
│       ├── logger.ts             # Audit logger (JSONL + ring buffer + SSE)
│       ├── middleware/
│       │   └── auth.ts           # API key + admin auth middleware
│       ├── handlers/
│       │   ├── pre-tool-use.ts   # PreToolUse hook handler
│       │   └── post-tool-use.ts  # PostToolUse hook handler
│       ├── rules/
│       │   ├── command.ts        # Bash command rule matching
│       │   ├── file-access.ts    # File path rule matching
│       │   └── code-quality.ts   # Code content rule matching
│       ├── api/
│       │   ├── policies.ts       # Policy management API
│       │   └── audit.ts          # Audit log query API
│       └── ui/
│           ├── index.html        # Admin UI (Alpine.js + Tailwind)
│           ├── styles.css
│           └── app.js
├── policies.example.yml          # Example policy configuration
├── settings-snippet.json         # Claude Code settings to merge
└── README.md
```

## Quick start

### 1. Install dependencies

```bash
cd enforce-policy/server
npm install
```

### 2. Create policy file

```bash
cd enforce-policy
cp policies.example.yml policies.yml
# Edit policies.yml to customize rules
```

> The server auto-creates `policies.yml` from the example on first start if missing.

### 3. Start the server

```bash
cd enforce-policy/server
npm run dev
```

The server starts on `http://localhost:3456` by default. Set `POLICY_PORT` to change port, `POLICY_HOST` to change bind address (e.g. `0.0.0.0` for remote access).

### 4. Configure Claude Code

Merge the contents of `settings-snippet.json` into your Claude Code settings file:

- **Global**: `~/.claude/settings.json`
- **Per-project**: `.claude/settings.local.json`

### 5. Test it

```bash
# Should DENY (destructive command)
curl -s -X POST http://localhost:3456/hooks/pre-tool-use \
  -H "Content-Type: application/json" \
  -d '{"tool_name":"Bash","tool_input":{"command":"rm -rf /"},"cwd":"/tmp","session_id":"test"}'

# Should ALLOW (safe command)
curl -s -X POST http://localhost:3456/hooks/pre-tool-use \
  -H "Content-Type: application/json" \
  -d '{"tool_name":"Bash","tool_input":{"command":"ls -la"},"cwd":"/tmp","session_id":"test"}'
```

Open `http://localhost:3456` to see the Admin UI.

## Authentication

Authentication is **optional** and configured via environment variables. When no env vars are set, the server runs without auth (backward compatible for local use).

### Enable/disable auth

Use `AUTH_ENABLED` for explicit control:

| `AUTH_ENABLED` | Behavior |
|----------------|----------|
| Not set | Auto-detect: auth is enabled if `API_KEYS` or `ADMIN_USERS` is set |
| `true` | Same as auto-detect (explicit opt-in) |
| `false` | Force-disable auth even if keys/users are configured |

```bash
# Force-disable auth (e.g. for local development)
AUTH_ENABLED=false npm run dev
```

There are two types of env vars — **server-side** (read from `.env` file via dotenv) and **client-side** (must be in Claude Code's process environment):

### Server-side: API Key auth (hook endpoints)

Protects `/hooks/*` endpoints so only authorized Claude Code clients can send hook requests.

Add to `enforce-policy/server/.env`:

```env
# Format: API_KEYS="name1:secret1,name2:secret2"
API_KEYS="dev-laptop:mysecret123,ci-server:othersecret456"
```

The API key name (e.g. `dev-laptop`) is recorded in the audit log for traceability.

### Server-side: Admin auth (UI + API)

Protects the Admin UI and `/api/*` endpoints with username/password login.

Add to `enforce-policy/server/.env`:

```env
# Format: ADMIN_USERS="user1:password1,user2:password2"
ADMIN_USERS="admin:strongpassword,viewer:viewerpass"
```

When configured, the Admin UI shows a login form. Sessions are stored in memory (server restart requires re-login).

### Client-side: Claude Code API key

Claude Code sends the API key via the `X-API-Key` header (configured in `settings-snippet.json`). This env var must be available in **Claude Code's process environment**, not the server's.

**Important:** Setting `export VAR=...` in an interactive terminal only affects that session. Claude Code (especially when launched from VS Code or another IDE) runs in a separate process and won't inherit it.

Add to `~/.zshenv` (macOS/zsh) so **all** processes receive it:

```bash
echo 'export CLAUDE_CODE_ENFORCE_POLICY_SERVER_API_KEY=mysecret123' >> ~/.zshenv
```

For bash users, add to `~/.bashrc` or `~/.bash_profile` instead.

> **After adding the env var, restart Claude Code** (or your IDE) for it to take effect.

### Full example

Server `.env` file (`enforce-policy/server/.env`):

```env
AUTH_ENABLED=true
API_KEYS="dev:key123,ci:key456"
ADMIN_USERS="admin:adminpass"
```

Client (`~/.zshenv`):

```bash
export CLAUDE_CODE_ENFORCE_POLICY_SERVER_API_KEY=key123
```

Then start the server:

```bash
cd enforce-policy/server
npm run dev
```

### Behavior summary

| Env var | Not set | Set |
|---------|---------|-----|
| `AUTH_ENABLED` | Auto-detect from keys/users | `true` = enable, `false` = force-disable |
| `API_KEYS` | Hook endpoints open (no auth) | Requires `X-API-Key` or `Authorization: Bearer` header |
| `ADMIN_USERS` | Admin UI/API open (no auth) | Requires login via UI or `Authorization: Bearer` token |

## Policy configuration

Policies are defined in `policies.yml` (YAML format). The server hot-reloads on file changes.

### Policy structure

```yaml
version: 1

audit:
  enabled: true
  log_file: audit.jsonl

policies:
  - name: Policy name                # Unique identifier
    enabled: true                     # Toggle on/off
    event: PreToolUse                 # PreToolUse or PostToolUse
    tool: Bash                        # Tool name or array: [Read, Write]
    action: deny                      # deny, block, or warn
    reason: Why this is blocked       # Shown to user
    rules:
      - pattern: "dangerous_regex"    # Regex pattern to match
        flags: i                      # Optional regex flags
        except: "safe_pattern"        # Exception regex (skip if matches)
        except_path:                  # Skip for these file paths
          - "\\.test\\."
          - "__tests__"
      - type: path_outside_cwd       # Special: block paths outside project
        except_path:
          - /tmp
```

### Built-in policy types

| Policy | Event | Tools | Description |
|--------|-------|-------|-------------|
| Block destructive commands | PreToolUse | Bash | `rm -rf`, `mkfs`, `dd`, `chmod 777` |
| Block force operations | PreToolUse | Bash | `git push --force`, `git reset --hard` |
| Block destructive SQL | PreToolUse | Bash | `DROP TABLE`, `TRUNCATE`, unfiltered `DELETE` |
| Block secret file access | PreToolUse | Read, Glob | `.env`, private keys, AWS credentials |
| Block write outside project | PreToolUse | Write, Edit | Files outside `cwd` |
| No hardcoded secrets | PostToolUse | Write, Edit | AWS keys, private keys, password strings |

### Rule types

**Regex pattern** — Match content against regex:
```yaml
- pattern: "rm\\s+-rf"
  flags: i
  except: "node_modules"
```

**Path outside CWD** — Block file access outside project directory:
```yaml
- type: path_outside_cwd
  except_path:
    - /tmp
```

## Admin UI

Open `http://localhost:3456` in your browser.

### Dashboard
- Live stats: Allowed / Denied / Blocked / Active Policies (today)
- Recent violations list with auto-refresh via SSE

### Policies
- View all policies with their status, event, tool, and action
- Toggle policies on/off (runtime only, does not modify YAML)
- Reload policies from YAML file

### Audit Log
- Filterable table: Time, Decision, Policy, Tool, Detail
- Filters: decision, tool, date range, session ID
- Pagination and JSON export

## API reference

### Hook endpoints (called by Claude Code)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/hooks/pre-tool-use` | Evaluate PreToolUse policies |
| POST | `/hooks/post-tool-use` | Evaluate PostToolUse policies |

### Auth endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Login with `{ username, password }`, returns `{ token, username }` |
| POST | `/api/auth/logout` | Invalidate session token |
| GET | `/api/auth/me` | Check auth status, returns `{ authRequired, username? }` |

### Admin endpoints (requires admin auth when `ADMIN_USERS` is set)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/policies` | List all policies |
| GET | `/api/policies/:name` | Get policy detail |
| PATCH | `/api/policies/:name/toggle` | Toggle policy on/off |
| POST | `/api/policies/reload` | Reload from YAML |
| GET | `/api/audit?limit=50&offset=0&decision=deny&tool=Bash` | Query audit log |
| GET | `/api/audit/stats` | Today's stats |
| GET | `/api/audit/stream` | SSE realtime feed (pass `?token=xxx` for auth) |
| GET | `/api/health` | Server health check (no auth required) |

## Setup (Global)

Install for all Claude Code sessions:

1. Start the server (keep running):
   ```bash
   cd enforce-policy/server && npm run dev
   ```

2. Add hooks to `~/.claude/settings.json`:
   ```json
   {
     "hooks": {
       "PreToolUse": [
         {
           "matcher": "",
           "hooks": [
             {
               "type": "http",
               "url": "http://localhost:3456/hooks/pre-tool-use",
               "timeout": 10,
               "statusMessage": "Checking policy...",
               "headers": {
                 "X-API-Key": "$CLAUDE_CODE_ENFORCE_POLICY_SERVER_API_KEY"
               },
               "allowedEnvVars": ["CLAUDE_CODE_ENFORCE_POLICY_SERVER_API_KEY"]
             }
           ]
         }
       ],
       "PostToolUse": [
         {
           "matcher": "Write|Edit",
           "hooks": [
             {
               "type": "http",
               "url": "http://localhost:3456/hooks/post-tool-use",
               "timeout": 10,
               "statusMessage": "Validating code quality...",
               "headers": {
                 "X-API-Key": "$CLAUDE_CODE_ENFORCE_POLICY_SERVER_API_KEY"
               },
               "allowedEnvVars": ["CLAUDE_CODE_ENFORCE_POLICY_SERVER_API_KEY"]
             }
           ]
         }
       ]
     }
   }
   ```

   If using API key auth, add the env var to `~/.zshenv` (see [Authentication](#authentication) for details):
   ```bash
   echo 'export CLAUDE_CODE_ENFORCE_POLICY_SERVER_API_KEY=your-secret-key' >> ~/.zshenv
   ```
   Then restart Claude Code / your IDE.

## Setup (Per-project)

Install for a specific project only:

1. Start the server from the project directory
2. Add the same hook config to `.claude/settings.local.json` in your project root

## Troubleshooting

### Remote deployment

To allow remote clients to connect, bind the server to all interfaces:

```bash
POLICY_HOST=0.0.0.0 npm run dev
```

> **Warning:** When binding to `0.0.0.0`, always enable authentication (`API_KEYS` + `ADMIN_USERS`) and use a reverse proxy (nginx, Caddy) with HTTPS in front.

### Server won't start

```bash
# Check if port is in use
lsof -i :3456

# Use a different port
POLICY_PORT=4000 npm run dev
```

### Policies not loading

```bash
# Check YAML syntax
node -e "const y = require('js-yaml'); console.log(y.load(require('fs').readFileSync('policies.yml','utf8')))"

# Check server logs for errors
npm run dev  # Logs reload events and errors
```

### Hook not connecting

```bash
# Test the endpoint directly
curl -s http://localhost:3456/api/health

# Check Claude Code hook config
cat ~/.claude/settings.json | jq '.hooks'
```

### "PreToolUse hook error" or 401 from hooks

This usually means the `CLAUDE_CODE_ENFORCE_POLICY_SERVER_API_KEY` env var is not available in Claude Code's process, even if it works in your terminal.

```bash
# Verify the server requires API key auth
curl -s -w "\nHTTP %{http_code}" -X POST http://localhost:3456/hooks/pre-tool-use \
  -H "Content-Type: application/json" \
  -d '{"tool_name":"Bash","tool_input":{"command":"echo test"}}'
# If you see "API key required" / HTTP 401, auth is active

# Verify the env var is set in your shell profile (not just the current session)
grep CLAUDE_CODE_ENFORCE_POLICY_SERVER_API_KEY ~/.zshenv ~/.zshrc ~/.bashrc 2>/dev/null
```

**Fix:** Add the env var to `~/.zshenv` and restart Claude Code (see [Authentication](#authentication)).

### Too many false positives

Edit `policies.yml` and add `except` patterns to rules, or disable the policy:

```yaml
- pattern: "rm\\s+-rf"
  except: "rm -rf node_modules|rm -rf dist"
```

### Build for production

```bash
cd enforce-policy/server
npm run build
npm start
```
