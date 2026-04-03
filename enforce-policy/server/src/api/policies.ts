import { Router } from "express";
import { getPolicies, reloadPolicies } from "../engine.js";

const router = Router();

// GET /api/policies - List all policies
router.get("/", (_req, res) => {
  const config = getPolicies();
  if (!config) {
    res.json({ policies: [] });
    return;
  }

  const policies = config.policies.map((p) => ({
    name: p.name,
    enabled: p.enabled,
    event: p.event,
    tool: p.tool,
    action: p.action,
    rules_count: p.rules.length,
    reason: p.reason,
  }));

  res.json({ policies });
});

// GET /api/policies/:name - Get policy detail
router.get("/:name", (req, res) => {
  const config = getPolicies();
  if (!config) {
    res.status(404).json({ error: "No policies loaded" });
    return;
  }

  const policy = config.policies.find(
    (p) => p.name === req.params.name
  );
  if (!policy) {
    res.status(404).json({ error: "Policy not found" });
    return;
  }

  res.json(policy);
});

// PATCH /api/policies/:name/toggle - Toggle policy enabled/disabled
router.patch("/:name/toggle", (req, res) => {
  const config = getPolicies();
  if (!config) {
    res.status(404).json({ error: "No policies loaded" });
    return;
  }

  const policy = config.policies.find(
    (p) => p.name === req.params.name
  );
  if (!policy) {
    res.status(404).json({ error: "Policy not found" });
    return;
  }

  policy.enabled = !policy.enabled;
  console.log(
    `[api] Policy '${policy.name}' ${policy.enabled ? "enabled" : "disabled"}`
  );

  res.json({ name: policy.name, enabled: policy.enabled });
});

// POST /api/policies/reload - Force reload from YAML
router.post("/reload", (_req, res) => {
  try {
    const config = reloadPolicies();
    if (!config) {
      res.status(500).json({ error: "No policy file configured" });
      return;
    }
    res.json({
      message: "Policies reloaded",
      count: config.policies.length,
    });
  } catch (err) {
    res.status(500).json({
      error: "Failed to reload",
      detail: String(err),
    });
  }
});

export default router;
