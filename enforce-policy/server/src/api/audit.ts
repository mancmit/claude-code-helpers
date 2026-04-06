import { Router } from "express";
import {
  getRecentEntries,
  getStats,
  addSSEClient,
  type AuditFilters,
} from "../logger.js";
import { getPolicies } from "../engine.js";

const router = Router();

// GET /api/audit - Query audit log
router.get("/", async (req, res, next) => {
  const limit = parseInt(String(req.query.limit)) || 50;
  const offset = parseInt(String(req.query.offset)) || 0;

  const filters: AuditFilters = {};
  if (req.query.decision) filters.decision = String(req.query.decision);
  if (req.query.tool) filters.tool = String(req.query.tool);
  if (req.query.session) filters.session = String(req.query.session);
  if (req.query.from) filters.from = String(req.query.from);
  if (req.query.to) filters.to = String(req.query.to);

  try {
    const result = await getRecentEntries(limit, offset, filters);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/audit/stats - Today's stats
router.get("/stats", async (_req, res, next) => {
  try {
    const stats = await getStats();
    const config = getPolicies();
    stats.policies = config?.policies.filter((p) => p.enabled).length ?? 0;
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

// GET /api/audit/stream - SSE realtime feed
// Note: adminAuth middleware already handles token via query param (?token=xxx)
// since EventSource does not support custom headers.
router.get("/stream", (req, res) => {
  addSSEClient(res);
});

export default router;
