import { readFileSync } from "node:fs";
import { load } from "js-yaml";
import { watch } from "chokidar";
import { evaluateCommand } from "./rules/command.js";
import { evaluateFilePath } from "./rules/file-access.js";
import { evaluateContent } from "./rules/code-quality.js";

// ── Types ──────────────────────────────────────────────────────────

export interface Rule {
  pattern: string;
  flags?: string;
  type?: "path_outside_cwd";
  except?: string | string[];
  except_path?: string[];
}

export interface Policy {
  name: string;
  enabled: boolean;
  event: "PreToolUse" | "PostToolUse";
  tool: string | string[];
  action: "deny" | "block" | "warn";
  rules: Rule[];
  reason: string;
}

export interface PolicyConfig {
  version: number;
  audit: {
    enabled: boolean;
    backend?: "sqlite" | "postgres";
    db_file?: string;
    postgres_url?: string;
  };
  policies: Policy[];
}

export interface HookInput {
  session_id: string;
  cwd: string;
  hook_event_name: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_response?: string;
}

export interface EvalResult {
  decision: "allow" | "deny" | "block" | "warn";
  policy_name?: string;
  reason?: string;
  detail: string;
}

// ── Engine ─────────────────────────────────────────────────────────

let currentConfig: PolicyConfig | null = null;
let policyFilePath: string | null = null;

export function loadPolicies(filePath: string): PolicyConfig {
  const raw = readFileSync(filePath, "utf-8");
  const parsed = load(raw) as PolicyConfig;
  currentConfig = parsed;
  policyFilePath = filePath;
  console.log(
    `[engine] Loaded ${parsed.policies.length} policies from ${filePath}`
  );
  return parsed;
}

export function getPolicies(): PolicyConfig | null {
  return currentConfig;
}

export function reloadPolicies(): PolicyConfig | null {
  if (!policyFilePath) return null;
  return loadPolicies(policyFilePath);
}

export function watchPolicies(filePath: string): void {
  const watcher = watch(filePath, { ignoreInitial: true });
  watcher.on("change", () => {
    console.log(`[engine] Policy file changed, reloading...`);
    try {
      loadPolicies(filePath);
    } catch (err) {
      console.error(`[engine] Failed to reload policies:`, err);
    }
  });
  console.log(`[engine] Watching ${filePath} for changes`);
}

function toolMatches(policyTool: string | string[], toolName: string): boolean {
  if (Array.isArray(policyTool)) {
    return policyTool.includes(toolName);
  }
  return policyTool === toolName;
}

function extractDetail(input: HookInput): string {
  const ti = input.tool_input;
  if (ti.command) return String(ti.command);
  if (ti.file_path) return String(ti.file_path);
  if (ti.url) return String(ti.url);
  if (ti.content) return String(ti.content).slice(0, 200);
  if (ti.new_string) return String(ti.new_string).slice(0, 200);
  return JSON.stringify(ti).slice(0, 200);
}

// ── Evaluate PreToolUse ────────────────────────────────────────────

export function evaluatePreToolUse(input: HookInput): EvalResult {
  if (!currentConfig) {
    return { decision: "allow", detail: extractDetail(input) };
  }

  const matching = currentConfig.policies.filter(
    (p) =>
      p.enabled && p.event === "PreToolUse" && toolMatches(p.tool, input.tool_name)
  );

  for (const policy of matching) {
    const detail = extractDetail(input);
    let matched = false;

    switch (input.tool_name) {
      case "Bash":
        matched = evaluateCommand(
          String(input.tool_input.command || ""),
          policy.rules
        );
        break;
      case "Read":
      case "Write":
      case "Edit":
      case "Glob":
        matched = evaluateFilePath(
          String(input.tool_input.file_path || ""),
          input.cwd,
          policy.rules
        );
        break;
      case "WebFetch":
        matched = evaluateCommand(
          String(input.tool_input.url || ""),
          policy.rules
        );
        break;
      default:
        matched = evaluateCommand(
          JSON.stringify(input.tool_input),
          policy.rules
        );
    }

    if (matched) {
      return {
        decision: policy.action === "warn" ? "warn" : "deny",
        policy_name: policy.name,
        reason: `Policy '${policy.name}': ${policy.reason}`,
        detail,
      };
    }
  }

  return { decision: "allow", detail: extractDetail(input) };
}

// ── Evaluate PostToolUse ───────────────────────────────────────────

export function evaluatePostToolUse(input: HookInput): EvalResult {
  if (!currentConfig) {
    return { decision: "allow", detail: extractDetail(input) };
  }

  const matching = currentConfig.policies.filter(
    (p) =>
      p.enabled && p.event === "PostToolUse" && toolMatches(p.tool, input.tool_name)
  );

  for (const policy of matching) {
    const detail = extractDetail(input);
    let matched = false;

    if (input.tool_name === "Write" || input.tool_name === "Edit") {
      const content =
        String(input.tool_input.content || input.tool_input.new_string || "");
      const filePath = String(input.tool_input.file_path || "");
      matched = evaluateContent(content, filePath, policy.rules);
    } else if (input.tool_name === "Bash") {
      matched = evaluateCommand(
        String(input.tool_input.command || ""),
        policy.rules
      );
    } else {
      matched = evaluateCommand(
        JSON.stringify(input.tool_input),
        policy.rules
      );
    }

    if (matched) {
      return {
        decision: policy.action === "warn" ? "warn" : "block",
        policy_name: policy.name,
        reason: `Policy '${policy.name}': ${policy.reason}`,
        detail,
      };
    }
  }

  return { decision: "allow", detail: extractDetail(input) };
}
