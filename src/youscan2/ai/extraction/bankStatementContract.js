/**
 * YouScan V2
 * Strict AI bank-statement extraction contract.
 *
 * Batch 11 defines the shape only. Nothing in this module calls an AI provider
 * or merges AI values into deterministic parser output.
 */

const MAX_TRANSACTIONS = 5000;
const MAX_EVIDENCE_ITEMS = 3;
const MAX_EVIDENCE_CHARS = 500;

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function fieldSchema(valueSchema) {
  return {
    type: "object",
    properties: {
      value: valueSchema,
      confidence: { type: "number", minimum: 0, maximum: 1 },
      evidence: {
        type: "array",
        items: { type: "string", minLength: 1, maxLength: MAX_EVIDENCE_CHARS },
        maxItems: MAX_EVIDENCE_ITEMS,
      },
    },
    required: ["value", "confidence", "evidence"],
    additionalProperties: false,
  };
}

const STRING_FIELD_SCHEMA = fieldSchema({ type: "string" });
const NULLABLE_STRING_FIELD_SCHEMA = fieldSchema({ type: ["string", "null"] });
const NUMBER_FIELD_SCHEMA = fieldSchema({ type: "number" });
const NULLABLE_NUMBER_FIELD_SCHEMA = fieldSchema({ type: ["number", "null"] });

export const AI_BANK_STATEMENT_EXTRACTION_RESPONSE_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    bankName: STRING_FIELD_SCHEMA,
    accountNumber: NULLABLE_STRING_FIELD_SCHEMA,
    clientName: NULLABLE_STRING_FIELD_SCHEMA,
    statementPeriodStart: NULLABLE_STRING_FIELD_SCHEMA,
    statementPeriodEnd: NULLABLE_STRING_FIELD_SCHEMA,
    openingBalance: NULLABLE_NUMBER_FIELD_SCHEMA,
    closingBalance: NULLABLE_NUMBER_FIELD_SCHEMA,
    transactionCount: {
      type: "integer",
      minimum: 0,
      maximum: MAX_TRANSACTIONS,
    },
    transactions: {
      type: "array",
      maxItems: MAX_TRANSACTIONS,
      items: {
        type: "object",
        properties: {
          date: NULLABLE_STRING_FIELD_SCHEMA,
          description: STRING_FIELD_SCHEMA,
          amount: NUMBER_FIELD_SCHEMA,
          balance: NULLABLE_NUMBER_FIELD_SCHEMA,
        },
        required: ["date", "description", "amount", "balance"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "bankName",
    "accountNumber",
    "clientName",
    "statementPeriodStart",
    "statementPeriodEnd",
    "openingBalance",
    "closingBalance",
    "transactionCount",
    "transactions",
  ],
  additionalProperties: false,
});

const TOP_LEVEL_KEYS = new Set([
  "bankName",
  "accountNumber",
  "clientName",
  "statementPeriodStart",
  "statementPeriodEnd",
  "openingBalance",
  "closingBalance",
  "transactionCount",
  "transactions",
]);

const TRANSACTION_KEYS = new Set(["date", "description", "amount", "balance"]);
const FIELD_KEYS = new Set(["value", "confidence", "evidence"]);

function addUnknownKeys(issues, value, allowedKeys, path) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push(`${path}.${key} is not allowed.`);
    }
  }
}

function validateField(
  issues,
  field,
  path,
  { valueType, nullable = false, allowEmptyString = false }
) {
  if (!isPlainObject(field)) {
    issues.push(`${path} must be an object.`);
    return;
  }

  addUnknownKeys(issues, field, FIELD_KEYS, path);

  if (!("value" in field)) {
    issues.push(`${path}.value is required.`);
  } else if (field.value === null) {
    if (!nullable) issues.push(`${path}.value cannot be null.`);
  } else if (valueType === "string") {
    if (typeof field.value !== "string") {
      issues.push(`${path}.value must be a string${nullable ? " or null" : ""}.`);
    } else if (!allowEmptyString && !field.value.trim()) {
      issues.push(`${path}.value must not be empty.`);
    }
  } else if (valueType === "number") {
    if (typeof field.value !== "number" || !Number.isFinite(field.value)) {
      issues.push(`${path}.value must be a finite number${nullable ? " or null" : ""}.`);
    }
  }

  if (
    typeof field.confidence !== "number" ||
    !Number.isFinite(field.confidence) ||
    field.confidence < 0 ||
    field.confidence > 1
  ) {
    issues.push(`${path}.confidence must be a number between 0 and 1.`);
  }

  if (!Array.isArray(field.evidence)) {
    issues.push(`${path}.evidence must be an array.`);
    return;
  }

  if (field.evidence.length > MAX_EVIDENCE_ITEMS) {
    issues.push(`${path}.evidence must contain at most ${MAX_EVIDENCE_ITEMS} snippets.`);
  }

  field.evidence.forEach((snippet, index) => {
    if (typeof snippet !== "string" || !snippet.trim()) {
      issues.push(`${path}.evidence[${index}] must be a non-empty string.`);
    } else if (snippet.length > MAX_EVIDENCE_CHARS) {
      issues.push(`${path}.evidence[${index}] exceeds ${MAX_EVIDENCE_CHARS} characters.`);
    }
  });

  if (field.value === null && field.evidence.length > 0) {
    issues.push(`${path}.evidence must be empty when value is null.`);
  }
}

export function validateAiBankStatementExtractionData(data) {
  const issues = [];

  if (!isPlainObject(data)) {
    return {
      valid: false,
      message: "AI bank-statement extraction data must be an object",
      issues: ["root must be an object."],
    };
  }

  addUnknownKeys(issues, data, TOP_LEVEL_KEYS, "data");

  validateField(issues, data.bankName, "data.bankName", {
    valueType: "string",
  });
  validateField(issues, data.accountNumber, "data.accountNumber", {
    valueType: "string",
    nullable: true,
  });
  validateField(issues, data.clientName, "data.clientName", {
    valueType: "string",
    nullable: true,
  });
  validateField(issues, data.statementPeriodStart, "data.statementPeriodStart", {
    valueType: "string",
    nullable: true,
  });
  validateField(issues, data.statementPeriodEnd, "data.statementPeriodEnd", {
    valueType: "string",
    nullable: true,
  });
  validateField(issues, data.openingBalance, "data.openingBalance", {
    valueType: "number",
    nullable: true,
  });
  validateField(issues, data.closingBalance, "data.closingBalance", {
    valueType: "number",
    nullable: true,
  });

  if (!Number.isInteger(data.transactionCount) || data.transactionCount < 0) {
    issues.push("data.transactionCount must be a non-negative integer.");
  } else if (data.transactionCount > MAX_TRANSACTIONS) {
    issues.push(`data.transactionCount cannot exceed ${MAX_TRANSACTIONS}.`);
  }

  if (!Array.isArray(data.transactions)) {
    issues.push("data.transactions must be an array.");
  } else {
    if (data.transactions.length > MAX_TRANSACTIONS) {
      issues.push(`data.transactions cannot contain more than ${MAX_TRANSACTIONS} rows.`);
    }

    data.transactions.forEach((transaction, index) => {
      const path = `data.transactions[${index}]`;
      if (!isPlainObject(transaction)) {
        issues.push(`${path} must be an object.`);
        return;
      }

      addUnknownKeys(issues, transaction, TRANSACTION_KEYS, path);
      validateField(issues, transaction.date, `${path}.date`, {
        valueType: "string",
        nullable: true,
      });
      validateField(issues, transaction.description, `${path}.description`, {
        valueType: "string",
      });
      validateField(issues, transaction.amount, `${path}.amount`, {
        valueType: "number",
      });
      validateField(issues, transaction.balance, `${path}.balance`, {
        valueType: "number",
        nullable: true,
      });
    });

    if (
      Number.isInteger(data.transactionCount) &&
      data.transactionCount !== data.transactions.length
    ) {
      issues.push(
        `data.transactionCount (${data.transactionCount}) does not match transactions.length (${data.transactions.length}).`
      );
    }
  }

  return {
    valid: issues.length === 0,
    ...(issues.length
      ? {
          message: "AI bank-statement extraction data failed strict contract validation",
          issues,
        }
      : {}),
  };
}

export const AI_BANK_STATEMENT_EXTRACTION_LIMITS = Object.freeze({
  maxTransactions: MAX_TRANSACTIONS,
  maxEvidenceItems: MAX_EVIDENCE_ITEMS,
  maxEvidenceChars: MAX_EVIDENCE_CHARS,
});
