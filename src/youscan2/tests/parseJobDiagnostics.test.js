import assert from "node:assert/strict";
import test from "node:test";

import { runParseJob } from "../orchestrator/runParseJob.js";
import { PARSE_JOB_STATUSES } from "../schemas/common.js";

test("runParseJob logs safe stage-aware diagnostics for an uncoded failure", async () => {
  const originalConsoleError = console.error;
  const capturedLogs = [];

  console.error = (...args) => {
    capturedLogs.push(args);
  };

  const classificationOptions = new Proxy(
    {},
    {
      ownKeys() {
        throw new Error(
          "Synthetic diagnostic failure 123456 user@example.com"
        );
      },
    }
  );

  let result;

  try {
    result = await runParseJob({
      file: {
        originalname: "diagnostic-test.pdf",
        mimetype: "application/pdf",
      },
      extractedText: "synthetic test input",
      classificationOptions,
    });
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(result.status, PARSE_JOB_STATUSES.FAILED);
  assert.equal(result.error?.code, "V2_PARSE_FAILED");

  const diagnosticLog = capturedLogs.find(
    (args) => args[0] === "V2 PARSE JOB FAILURE:"
  );

  assert.ok(diagnosticLog, "Expected stage-aware diagnostic log");

  const diagnostic = JSON.parse(diagnosticLog[1]);

  assert.equal(diagnostic.stage, "classification");
  assert.equal(diagnostic.code, "V2_PARSE_FAILED");
  assert.equal(diagnostic.name, "Error");
  assert.equal(diagnostic.subtype, null);

  assert.equal(
    diagnostic.message,
    "Synthetic diagnostic failure [redacted-number] [redacted-email]"
  );

  assert.equal(diagnostic.message.includes("123456"), false);
  assert.equal(diagnostic.message.includes("user@example.com"), false);
});