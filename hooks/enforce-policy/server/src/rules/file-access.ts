import { resolve, relative } from "node:path";
import type { Rule } from "../engine.js";

export function evaluateFilePath(
  filePath: string,
  cwd: string,
  rules: Rule[]
): boolean {
  for (const rule of rules) {
    if (rule.type === "path_outside_cwd") {
      if (matchPathOutsideCwd(filePath, cwd)) {
        // Check path-based exceptions
        if (rule.except_path) {
          const isExcepted = rule.except_path.some((ex) =>
            resolve(filePath).startsWith(resolve(ex))
          );
          if (isExcepted) continue;
        }
        return true;
      }
      continue;
    }

    const regex = new RegExp(rule.pattern, rule.flags || "i");
    if (!regex.test(filePath)) continue;

    // Check exceptions
    if (rule.except) {
      const exceptions = Array.isArray(rule.except)
        ? rule.except
        : [rule.except];
      const isExcepted = exceptions.some((ex) =>
        new RegExp(ex, "i").test(filePath)
      );
      if (isExcepted) continue;
    }

    return true;
  }

  return false;
}

function matchPathOutsideCwd(filePath: string, cwd: string): boolean {
  const resolved = resolve(filePath);
  const resolvedCwd = resolve(cwd);
  const rel = relative(resolvedCwd, resolved);
  return rel.startsWith("..");
}
