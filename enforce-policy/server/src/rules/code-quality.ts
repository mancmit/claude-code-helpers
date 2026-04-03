import type { Rule } from "../engine.js";

export function evaluateContent(
  content: string,
  filePath: string,
  rules: Rule[]
): boolean {
  for (const rule of rules) {
    if (rule.type === "path_outside_cwd") continue;

    // Skip rules for excepted file paths (e.g. test files)
    if (rule.except_path) {
      const isExcepted = rule.except_path.some((ex) =>
        new RegExp(ex, "i").test(filePath)
      );
      if (isExcepted) continue;
    }

    const regex = new RegExp(rule.pattern, rule.flags || "");
    if (!regex.test(content)) continue;

    // Check content-based exceptions
    if (rule.except) {
      const exceptions = Array.isArray(rule.except)
        ? rule.except
        : [rule.except];
      const isExcepted = exceptions.some((ex) =>
        new RegExp(ex).test(content)
      );
      if (isExcepted) continue;
    }

    return true;
  }

  return false;
}
