import type { Request, Response } from "express";
import { evaluatePreToolUse, type HookInput } from "../engine.js";
import { logDecision } from "../logger.js";

export function preToolUseHandler(req: Request, res: Response): void {
  const input: HookInput = {
    session_id: req.body.session_id || "unknown",
    cwd: req.body.cwd || process.cwd(),
    hook_event_name: "PreToolUse",
    tool_name: req.body.tool_name || "",
    tool_input: req.body.tool_input || {},
  };

  const result = evaluatePreToolUse(input);

  logDecision({
    timestamp: new Date().toISOString(),
    session_id: input.session_id,
    event: "PreToolUse",
    tool_name: input.tool_name,
    decision: result.decision,
    policy_name: result.policy_name,
    reason: result.reason,
    detail: result.detail,
    cwd: input.cwd,
    api_key_name: req.apiKeyName,
  });

  if (result.decision === "deny") {
    res.json({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: result.reason,
      },
    });
    return;
  }

  // Allow: return empty 200
  res.json({});
}
