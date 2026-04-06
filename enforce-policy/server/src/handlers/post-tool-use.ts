import type { NextFunction, Request, Response } from "express";
import { evaluatePostToolUse, type HookInput } from "../engine.js";
import { logDecision } from "../logger.js";

export async function postToolUseHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const input: HookInput = {
      session_id: req.body.session_id || "unknown",
      cwd: req.body.cwd || process.cwd(),
      hook_event_name: "PostToolUse",
      tool_name: req.body.tool_name || "",
      tool_input: req.body.tool_input || {},
      tool_response: req.body.tool_response,
    };

    const result = evaluatePostToolUse(input);

    await logDecision({
      timestamp: new Date().toISOString(),
      session_id: input.session_id,
      event: "PostToolUse",
      tool_name: input.tool_name,
      decision: result.decision,
      policy_name: result.policy_name,
      reason: result.reason,
      detail: result.detail,
      cwd: input.cwd,
      api_key_name: req.apiKeyName,
    });

    if (result.decision === "block") {
      res.json({
        decision: "block",
        reason: result.reason,
      });
      return;
    }

    // Allow: return empty 200
    res.json({});
  } catch (err) {
    next(err);
  }
}
