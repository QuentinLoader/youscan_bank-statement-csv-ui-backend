/**
 * YouScan V2 production parsing API.
 *
 * V1 /parse remains mounted separately as rollback code during cutover.
 */

import express from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";

import { recordExport } from "../../controllers/usage.controller.js";
import { authenticateUser } from "../../middleware/auth.middleware.js";
import { checkPlanAccess } from "../../middleware/credits.middleware.js";
import { getDefaultReviewService } from "../review/defaultService.js";
import { extractTextFromFile } from "../utils/extractTextFromFile.js";
import { runParseJob } from "../orchestrator/runParseJob.js";
import {
  aggregateV2Transactions,
  toPublicV2FileResult,
} from "./parseResponse.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 10,
  },
});

const defaultLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
});

function parseHttpError(code, message, status = 422) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function ensureUsableParse(parseResult) {
  if (parseResult?.status === "unsupported") {
    throw parseHttpError(
      "V2_UNSUPPORTED_DOCUMENT",
      parseResult?.message ||
        "This document is not supported by YouScan V2.",
      400
    );
  }

  if (parseResult?.status === "failed") {
    throw parseHttpError(
      parseResult?.error?.code || "V2_PARSE_FAILED",
      parseResult?.error?.message ||
        "YouScan V2 could not parse this document.",
      422
    );
  }

  const data = parseResult?.result?.data;

  if (!data) {
    throw parseHttpError(
      "V2_REVIEW_REQUIRED_BEFORE_PARSE",
      "This document requires review before a usable statement result can be produced.",
      422
    );
  }

  if (
    !Array.isArray(data.transactions) ||
    data.transactions.length === 0
  ) {
    throw parseHttpError(
      "V2_PARSE_EMPTY",
      "No transactions were extracted.",
      422
    );
  }
}

async function maybePersistReview({
  parseResult,
  userId,
  getReviewService,
}) {
  if (!parseResult?.aiCorrectionProposal) {
    return null;
  }

  try {
    const service = getReviewService();

    return await service.createCaseFromParseResult({
      userId,
      parseResult,
    });
  } catch (error) {
    /*
     * Review persistence is supplemental to the authoritative
     * deterministic parse.
     *
     * A temporary review-store failure must never suppress an otherwise
     * usable V2 parse result.
     */
    console.error(
      "V2 REVIEW PERSISTENCE ERROR:",
      error?.code || error?.message || "unknown"
    );

    return null;
  }
}

function sendError(res, error) {
  const status = Number(error?.status) || 500;

  return res.status(status).json({
    error: error?.code || "V2_PARSE_ROUTE_FAILED",
    message:
      status >= 500
        ? "YouScan V2 could not complete the request."
        : error.message,
  });
}

export function createV2ParseRouter({
  authenticate = authenticateUser,
  checkAccess = checkPlanAccess,
  limiter = defaultLimiter,
  extractText = extractTextFromFile,
  runJob = runParseJob,
  getReviewService = getDefaultReviewService,
  recordExportHandler = recordExport,
} = {}) {
  const router = express.Router();

  /*
   * ============================================================
   * PARSE
   * ============================================================
   *
   * V2 commercial rule:
   *
   * Parsing itself does NOT consume a FREE allowance or paid
   * credit.
   *
   * A credit/use is consumed only when a specific parsed document
   * is exported for the first time.
   *
   * checkAccess remains here so normal account/plan access controls
   * continue to protect the parsing service.
   * ============================================================
   */
  router.post(
    "/",
    limiter,
    authenticate,
    checkAccess,
    upload.any(),
    async (req, res) => {
      try {
        const files = req.files || [];

        if (!files.length) {
          return res.status(400).json({
            error: "NO_FILE_UPLOADED",
          });
        }

        const internalResults = [];

        for (const file of files) {
          const extraction = await extractText(file);

          const parseResult = await runJob({
            file: {
              originalname: file.originalname,
              mimetype: file.mimetype,
            },
            extractedText: extraction.text,
            extractionMeta: extraction.meta,
          });

          ensureUsableParse(parseResult);

          internalResults.push({
            file,
            parseResult,
          });
        }

        /*
         * No charge occurs here.
         *
         * Each public V2 file result already contains its own jobId.
         * That jobId becomes the permanent idempotency key when the
         * customer later exports that document.
         */
        const billing = {
          chargingModel: "EXPORT",
          deferredUntilExport: true,
          creditsDeducted: 0,
        };

        const publicFiles = [];

        for (const entry of internalResults) {
          const reviewCase = await maybePersistReview({
            parseResult: entry.parseResult,
            userId: req.user?.userId,
            getReviewService,
          });

          publicFiles.push(
            toPublicV2FileResult({
              fileName: entry.file.originalname,
              parseResult: entry.parseResult,
              reviewCase,
            })
          );
        }

        return res.status(200).json({
          engine: "youscan-v2",
          authoritativeSource: "deterministic",
          fileCount: publicFiles.length,
          files: publicFiles,
          transactions: aggregateV2Transactions(publicFiles),
          billing,
        });
      } catch (error) {
        console.error(
          "V2 PARSE ROUTE ERROR:",
          error?.code || error?.message || "unknown"
        );

        return sendError(res, error);
      }
    }
  );

  /*
   * ============================================================
   * EXPORT AUTHORISATION / CHARGING
   * ============================================================
   *
   * Mounted by server.js at:
   *
   *   /api/v2/parse/export
   *
   * Request body:
   *
   * {
   *   "jobId": "...",
   *   "fileName": "statement.pdf"
   * }
   *
   * The export controller:
   *
   * - charges the first export for a jobId
   * - records it in v2_export_ledger
   * - allows subsequent exports of the same jobId without charging
   *   again
   *
   * Do NOT use checkAccess here. The controller itself performs the
   * commercial decision. This is also important because a previously
   * paid document must remain re-exportable even when the customer's
   * current credit balance is zero.
   * ============================================================
   */
  router.post(
    "/export",
    limiter,
    authenticate,
    recordExportHandler
  );

  return router;
}

export default createV2ParseRouter();