# Guide: Add "Log All Bash Commands" Hook to Claude Code (Global)

This hook automatically logs **all Bash commands** executed by Claude Code into a Markdown file, organized by date. Useful for auditing, reviewing, and debugging commands run in each session.

---

## Table of Contents

1. [What does the hook do?](#1-what-does-the-hook-do)
2. [Prerequisites](#2-prerequisites)
3. [File structure](#3-file-structure)
4. [Setup (Global)](#4-setup-global)
5. [Setup (Per-project)](#5-setup-per-project)
6. [Sample output](#6-sample-output)
7. [Troubleshooting](#7-troubleshooting)

---

## 1. What does the hook do?

- **Event:** `PostToolUse` — runs after each Claude Code tool use
- **Matcher:** `Bash` — only triggers for the Bash tool
- **Behavior:** Logs the command, description, session ID, current working directory, and timestamp to a Markdown file
- **Output:** `bash-YYYY-MM-DD.md` in the `.claude/logs/` directory of the project

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
│   └── log-bash.sh          # Hook script (global)
└── settings.json             # Claude Code global settings
```

When the hook runs, it creates logs inside each project:
```
<project-dir>/
└── .claude/
    └── logs/
        ├── bash-2026-03-15.md
        ├── bash-2026-03-16.md
        └── ...
```

---

## 4. Setup (Global)

A global hook applies to **all projects** when using Claude Code.

### Step 1: Create hooks directory

```bash
mkdir -p ~/.claude/hooks
```

### Step 2: Create hook script

Copy the content of [`log-bash.sh`](./log-bash.sh) and save it to `~/.claude/hooks/log-bash.sh`.

### Step 3: Make it executable

```bash
chmod +x ~/.claude/hooks/log-bash.sh
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

> **Note:** If `settings.json` already has content, **merge** the `hooks` block into it — do not overwrite the entire file.

### Step 5: Verify

```bash
# Start Claude Code in any project
cd ~/my-project
claude

# Ask Claude to run a bash command, e.g.:
# > "list files in current directory"

# After Claude runs the command, check the log:
cat .claude/logs/bash-$(date '+%Y-%m-%d').md
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

Copy the content of [`log-bash.sh`](./log-bash.sh) and save it to `.claude/hooks/log-bash.sh`, then make it executable:

```bash
chmod +x .claude/hooks/log-bash.sh
```

### Step 3: Create/edit .claude/settings.local.json

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/log-bash.sh",
            "async": true
          }
        ]
      }
    ]
  }
}
```

> **Note:** For per-project setup, use `$CLAUDE_PROJECT_DIR` to reference the project directory instead of `~`.

### Step 4: Add to .gitignore

```bash
echo ".claude/logs/" >> .gitignore
```

---

## 6. Sample output

File `.claude/logs/bash-2026-03-16.md`:

```markdown
# Claude Code Bash Log - 2026-03-16

**Project:** /Users/admin/my-project

---

## 2026-03-16 10:30:15
**Session:** abc123-def456-session-1
**Description:** List files in current directory
**CWD:** /Users/admin/my-project
` ` ` bash
ls -la
` ` `
---

## 2026-03-16 10:31:02
**Session:** abc123-def456-session-1
**Description:** Check git status
**CWD:** /Users/admin/my-project
` ` ` bash
git status
` ` `
---

## 2026-03-16 14:00:05
**Session:** xyz789-ghi012-session-2
**Description:** Install dependencies
**CWD:** /Users/admin/my-project
` ` ` bash
npm install
` ` `
---
```

> **Note:** Each command entry includes its Session ID, making it easy to filter/group commands by session even when multiple sessions log to the same daily file.

---

## 7. Troubleshooting

### Hook not running

1. Check execute permission:
   ```bash
   ls -la ~/.claude/hooks/log-bash.sh
   # Must have x: -rwxr-xr-x
   chmod +x ~/.claude/hooks/log-bash.sh
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

### Log file empty or not created

1. Check `$CLAUDE_PROJECT_DIR` variable:
   ```bash
   # Inside a Claude Code session, run:
   echo $CLAUDE_PROJECT_DIR
   ```

2. Check write permissions on the project directory:
   ```bash
   ls -la /path/to/project/.claude/
   ```

### Test hook manually

```bash
echo '{"tool_input":{"command":"ls -la","description":"Test"},"cwd":"/tmp","session_id":"test-123"}' \
  | CLAUDE_PROJECT_DIR=/tmp ~/.claude/hooks/log-bash.sh

# Check output:
cat /tmp/.claude/logs/bash-$(date '+%Y-%m-%d').md
```
