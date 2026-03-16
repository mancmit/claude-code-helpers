#!/bin/bash
# Claude Code Hook: Log all Bash commands to a markdown file per day
# Event: PostToolUse (matcher: Bash)
# Input: JSON via stdin with tool_input.command, tool_input.description, cwd

INPUT=$(cat)

COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
DESCRIPTION=$(echo "$INPUT" | jq -r '.tool_input.description // "No description"')
CWD=$(echo "$INPUT" | jq -r '.cwd // "unknown"')
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"')
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# Skip if no command
[ -z "$COMMAND" ] && exit 0

# Log file: one per date in project .claude/logs/
LOG_DIR="$CLAUDE_PROJECT_DIR/.claude/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/bash-$(date '+%Y-%m-%d').md"

# Write daily header if file is new
if [ ! -f "$LOG_FILE" ]; then
  cat >> "$LOG_FILE" <<EOF
# Claude Code Bash Log - $(date '+%Y-%m-%d')

**Project:** $CLAUDE_PROJECT_DIR

---

EOF
fi

# Append command entry with session ID
cat >> "$LOG_FILE" <<EOF
## $TIMESTAMP
**Session:** $SESSION_ID
**Description:** $DESCRIPTION
**CWD:** $CWD
\`\`\`bash
$COMMAND
\`\`\`
---

EOF

exit 0
