import type { Rule } from "../engine.js";

export function evaluateCommand(command: string, rules: Rule[]): boolean {
  for (const rule of rules) {
    if (rule.type === "path_outside_cwd") continue;

    const regex = new RegExp(rule.pattern, rule.flags || "");
    if (!regex.test(command)) continue;

    // Check exceptions
    if (rule.except) {
      const exceptions = Array.isArray(rule.except)
        ? rule.except
        : [rule.except];
      const isExcepted = exceptions.some((ex) => new RegExp(ex).test(command));
      if (isExcepted) continue;
    }

    return true;
  }

  return false;
}
