#!/bin/bash
# Claude Code Hook: Notify when reading secret/credential files
# Event: PreToolUse (matcher: Read)
# Input: JSON via stdin with tool_input.file_path
# Always exit 0 (allow) — notification only, does not block

INPUT=$(cat)

FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Skip if no file path
[ -z "$FILE_PATH" ] && exit 0

BASENAME=$(basename "$FILE_PATH")
# Lowercase basename for case-insensitive substring matching
BASENAME_LOWER=$(echo "$BASENAME" | tr '[:upper:]' '[:lower:]')

is_secret_file() {
  # 1. Exact filename patterns
  case "$BASENAME" in
    .env|.env.*) return 0 ;;
    credentials.json|credentials.yaml|credentials.yml) return 0 ;;
    id_rsa|id_ed25519) return 0 ;;
    .npmrc|.pypirc|.netrc|.pgpass|.htpasswd) return 0 ;;
    kubeconfig) return 0 ;;
  esac

  # 2. Extension patterns
  case "$BASENAME" in
    *.pem|*.key|*.p12|*.pfx|*.jks|*.keystore) return 0 ;;
  esac

  # 3. Substring patterns (case-insensitive)
  case "$BASENAME_LOWER" in
    *secret*|*token*|*password*) return 0 ;;
  esac

  # 4. Full path patterns
  case "$FILE_PATH" in
    */.aws/credentials|*/.aws/config) return 0 ;;
    */.kube/config) return 0 ;;
    */.ssh/id_*) return 0 ;;
  esac

  return 1
}

if is_secret_file; then
  # macOS notification — non-blocking banner, detail visible in Notification Center
  osascript -e "display notification \"$FILE_PATH\" with title \"Claude Code Hook\" subtitle \"Claude is reading a secret file\" sound name \"Basso\"" 2>/dev/null &

  # Terminal bell via stderr
  echo -ne '\a' >&2
fi

# Always allow — notify only, blocking is handled elsewhere
exit 0
