/**
 * YouScan 2.0
 * Parse job orchestrator
 */

import crypto from "crypto";
import { classifyDocument } from "../classifier/classifyDocument.js";
import { getParserByKey } from "../registry/parserRegistry.js";
import { getActiveSchemaForDocumentType } from "../registry/schemaRegistry.js";

export async function runParseJob({ file, extractedText = "" }) {
  const jobId = crypto.randomUUID();

  const classification = await classifyDocument({
    extractedText,
    fileName: file?.originalname || "unknown",
  });

  if (!classification.supported) {
    return {
      jobId,
      status: "unsupported",
      classification,
      schema: null,
      result: null,
      message: `Unsupported document type: ${classification.documentType}`,
    };
  }

  const schema = getActiveSchemaForDocumentType(classification.documentType);

  if (!schema) {
    return {
      jobId,
      status: "unsupported",
      classification,
      schema: null,
      result: null,
      message: `No active schema for document type: ${classification.documentType}`,
    };
  }

  const parser = getParserByKey(schema.parserKey);

  if (!parser) {
    return {
      jobId,
      status: "failed",
      classification,
      schema,
      result: null,
      message: `No parser found for key: ${schema.parserKey}`,
    };
  }

  const context = {
    jobId,
    file,
    extractedText,
    textPreview: extractedText.slice(0, 2000),
    classification,
    schema,
  };

  const raw = await parser.extract(context);
  const normalized = await parser.normalize(raw, context);
  const validation = await parser.validate(normalized, context);

  const finalResult = await parser.toFinalResult({
    jobId,
    classification,
    normalized,
    validation,
  });

  return {
    jobId,
    status: finalResult.status === "completed" ? "completed" : "failed",
    classification,
    schema,
    result: finalResult,
    message: "YouScan 2.0 parse job completed",
  };
}