/**
 * YouScan V2
 * Authenticated persistent review API.
 *
 * There is intentionally no apply/merge endpoint in Batch 16.
 */

import express from "express";
import { authenticateUser } from "../../middleware/auth.middleware.js";
import { asReviewError } from "./errors.js";
import { getDefaultReviewService } from "./defaultService.js";

function sendError(res, error) {
  const safe = asReviewError(error);
  return res.status(safe.status || 500).json({
    error: safe.code,
    message: safe.message,
  });
}

export function createReviewRouter({
  authenticate = authenticateUser,
  getService = getDefaultReviewService,
} = {}) {
  const router = express.Router();
  router.use(authenticate);

  router.get("/", async (req, res) => {
    try {
      const service = getService();
      const cases = await service.listCases({
        userId: req.user?.userId,
        status: req.query.status || null,
        limit: req.query.limit,
        offset: req.query.offset,
      });
      return res.json({ cases });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get("/:caseId", async (req, res) => {
    try {
      const service = getService();
      const reviewCase = await service.getCase({
        userId: req.user?.userId,
        caseId: req.params.caseId,
      });
      return res.json(reviewCase);
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post("/:caseId/decisions", async (req, res) => {
    try {
      const service = getService();
      const reviewCase = await service.reviewCase({
        userId: req.user?.userId,
        caseId: req.params.caseId,
        decisions: req.body?.decisions,
      });
      return res.json(reviewCase);
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get("/:caseId/audit", async (req, res) => {
    try {
      const service = getService();
      const events = await service.listAudit({
        userId: req.user?.userId,
        caseId: req.params.caseId,
      });
      return res.json({ events });
    } catch (error) {
      return sendError(res, error);
    }
  });

  return router;
}

export default createReviewRouter();
