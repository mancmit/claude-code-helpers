# Guide: Add "Notify Secret File Read" Hook to Claude Code

This hook **notifies** the user via macOS notification and terminal bell when Claude Code reads files that contain secrets or credentials. It does **not** block the read — it only alerts you.

---

## Table of Contents

1. [What does the hook do?](#1-what-does-the-hook-do)
2. [Prerequisites](#2-prerequisites)
3. [File structure](#3-file-structure)
4. [Setup (Global)](#4-setup-global)
5. [Setup (Per-project)](#5-setup-per-project)
6. [Monitored file patterns](#6-monitored-file-patterns)
7. [Customization](#7-customization)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. What does the hook do?

- **Event:** `PreToolUse` — runs **before** each Claude Code tool use
- **Matcher:** `Read` — only triggers for the Read tool
- **Behavior:** Checks the target file path against known secret/credential patterns. If matched:
  - **Sends a macOS notification** (with sound) via `osascript`
  - **Rings the terminal bell** via stderr
  - **Always allows** the read (exit code 0) — notification only, does not block
- If the file does not match any pattern, it passes silently (exit code 0)

---

## 2. Prerequisites

- **Claude Code** (CLI) installed
- **jq** — JSON processor (used to parse stdin input)

Check jq:
```bash
jq --version
# If not installed:
brew install jq        # macOS
sudo apt install jq    # Ubuntu/Debian
```

---

## 3. File structure

```
~/.claude/
├── hooks/
│   └── notify-secret-read.sh   # Hook script (global)
└── settings.json                # Claude Code global settings
```

---

## 4. Setup (Global)

A global hook applies to **all projects** when using Claude Code.

### Step 1: Create hooks directory

```bash
mkdir -p ~/.claude/hooks
```

### Step 2: Create hook script

Copy the content of [`notify-secret-read.sh`](./notify-secret-read.sh) and save it to `~/.claude/hooks/notify-secret-read.sh`.

### Step 3: Make it executable

```bash
chmod +x ~/.claude/hooks/notify-secret-read.sh
```

### Step 4: Configure settings.json (Global)

Open the global settings file:
```bash
code ~/.claude/settings.json
# or
vim ~/.claude/settings.json
# or
nano ~/.claude/settings.json
```

Add (or merge) the `hooks` block into `~/.claude/settings.json`. The content to add is in [`settings-snippet.json`](./settings-snippet.json).

> **Note:** If `settings.json` already has content, **merge** the `hooks` block into it — do not overwrite the entire file. If you already have a `PreToolUse` array, add the new entry to it.

### Step 5: Verify

```bash
# Test with a secret file — should trigger notification (exit code 0)
echo '{"tool_input":{"file_path":"/home/user/.env"}}' | bash ~/.claude/hooks/notify-secret-read.sh
echo "Exit code: $?"
# Expected: macOS notification + bell, exit code 0

# Test with a normal file — should pass silently (exit code 0)
echo '{"tool_input":{"file_path":"/home/user/README.md"}}' | bash ~/.claude/hooks/notify-secret-read.sh
echo "Exit code: $?"
# Expected: no notification, exit code 0
```

---

## 5. Setup (Per-project)

To enable the hook for a specific project only, use `settings.local.json` inside the project.

### Step 1: Create hooks directory in the project

```bash
cd /path/to/your/project
mkdir -p .claude/hooks
```

### Step 2: Create hook script in the project

Copy the content of [`notify-secret-read.sh`](./notify-secret-read.sh) and save it to `.claude/hooks/notify-secret-read.sh`, then make it executable:

```bash
chmod +x .claude/hooks/notify-secret-read.sh
```

### Step 3: Create/edit .claude/settings.local.json

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Read",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/notify-secret-read.sh"
          }
        ]
      }
    ]
  }
}
```

> **Note:** For per-project setup, use `$CLAUDE_PROJECT_DIR` to reference the project directory instead of `~`.

---

## 6. Monitored file patterns

The hook checks file paths against the following patterns and sends a notification if matched:

| Category | Patterns |
|----------|----------|
| **Exact filename** | `.env`, `.env.*`, `credentials.json`, `credentials.yaml`, `credentials.yml`, `id_rsa`, `id_ed25519`, `.npmrc`, `.pypirc`, `.netrc`, `.pgpass`, `.htpasswd`, `kubeconfig` |
| **Extension** | `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`, `*.keystore` |
| **Substring (case-insensitive)** | `*secret*`, `*token*`, `*password*` |
| **Full path** | `*/.aws/credentials`, `*/.aws/config`, `*/.kube/config`, `*/.ssh/id_*` |

---

## 7. Customization

### Adding new patterns

Edit the `is_secret_file()` function in `notify-secret-read.sh`:

```bash
# Add to exact filename patterns:
case "$BASENAME" in
  .env|.env.*|my-new-secret-file) return 0 ;;
  ...
esac

# Add to extension patterns:
case "$BASENAME" in
  *.pem|*.key|*.my-ext) return 0 ;;
  ...
esac

# Add to substring patterns (case-insensitive):
case "$BASENAME_LOWER" in
  *secret*|*token*|*password*|*apikey*) return 0 ;;
  ...
esac

# Add to full path patterns:
case "$FILE_PATH" in
  */.aws/credentials|*/.my-tool/config) return 0 ;;
  ...
esac
```

### Removing patterns

Simply remove the unwanted pattern from the corresponding `case` statement.

### Excluding a specific file

If you want to skip notification for a specific file, add an early-return check at the top of `is_secret_file()`:

```bash
is_secret_file() {
  # Allowlist: skip check for these specific paths
  case "$FILE_PATH" in
    /path/to/allowed/file.pem) return 1 ;;
  esac

  # ... rest of checks
}
```

---

## 8. Troubleshooting

### Hook not running

1. Check execute permission:
   ```bash
   ls -la ~/.claude/hooks/notify-secret-read.sh
   # Must have x: -rwxr-xr-x
   chmod +x ~/.claude/hooks/notify-secret-read.sh
   ```

2. Check jq is installed:
   ```bash
   which jq
   jq --version
   ```

3. Check settings.json syntax:
   ```bash
   cat ~/.claude/settings.json | jq .
   # If error -> fix JSON format
   ```

### Hook not notifying

1. Ensure the event is `PreToolUse` (not `PostToolUse`) and matcher is `Read`
2. Verify the file path matches one of the patterns in the `is_secret_file()` function

### No macOS notification

1. Check that `osascript` is available (macOS only):
   ```bash
   which osascript
   ```
2. Check System Settings > Notifications — ensure "Script Editor" or "osascript" is allowed

### Test hook manually

```bash
# Test: should notify for .env
echo '{"tool_input":{"file_path":"/home/user/.env"}}' | bash ~/.claude/hooks/notify-secret-read.sh
echo "Exit code: $?"
# Expected: notification + bell, exit code 0

# Test: should notify for .pem
echo '{"tool_input":{"file_path":"/etc/ssl/private/server.pem"}}' | bash ~/.claude/hooks/notify-secret-read.sh
echo "Exit code: $?"
# Expected: notification + bell, exit code 0

# Test: should notify for AWS credentials
echo '{"tool_input":{"file_path":"/home/user/.aws/credentials"}}' | bash ~/.claude/hooks/notify-secret-read.sh
echo "Exit code: $?"
# Expected: notification + bell, exit code 0

# Test: should pass silently for normal file
echo '{"tool_input":{"file_path":"/home/user/src/app.js"}}' | bash ~/.claude/hooks/notify-secret-read.sh
echo "Exit code: $?"
# Expected: no notification, exit code 0
```
