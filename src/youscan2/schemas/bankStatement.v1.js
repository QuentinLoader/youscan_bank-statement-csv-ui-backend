/**
 * YouScan V2
 * Canonical bank statement data contract, schema version 1.
 *
 * This is deliberately dependency-free. It defines the stable normalized
 * shape that every V2 bank adapter must eventually produce.
 */

import { isFiniteNumber, isStringOrNull } from "./common.js";

export const BANK_STATEMENT_SCHEMA_V1 = Object.freeze({
  schemaKey: "bank_statement.v1",
  documentType: "bank_statement",
  version: 1,
  transactionFields: Object.freeze([
    "date",
    "description",
    "amount",
    "balance",
  ]),
});

export function validateBankStatementShape(data) {
  const issues = [];

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return {
      valid: false,
      issues: ["Bank statement data must be an object."],
    };
  }

  if (typeof data.bankName !== "string" || !data.bankName.trim()) {
    issues.push("bankName must be a non-empty string.");
  }

  const nullableStringFields = [
    "accountNumber",
    "clientName",
    "statementPeriodStart",
    "statementPeriodEnd",
    "sourceFileName",
  ];

  for (const field of nullableStringFields) {
    if (!isStringOrNull(data[field])) {
      issues.push(`${field} must be a string or null.`);
    }
  }

  for (const field of ["openingBalance", "closingBalance"]) {
    if (data[field] !== null && !isFiniteNumber(data[field])) {
      issues.push(`${field} must be a finite number or null.`);
    }
  }

  if (!Array.isArray(data.transactions)) {
    issues.push("transactions must be an array.");
    return { valid: false, issues };
  }

  data.transactions.forEach((transaction, index) => {
    if (!transaction || typeof transaction !== "object" || Array.isArray(transaction)) {
      issues.push(`transactions[${index}] must be an object.`);
      return;
    }

    if (!isStringOrNull(transaction.date)) {
      issues.push(`transactions[${index}].date must be a string or null.`);
    }

    if (typeof transaction.description !== "string") {
      issues.push(`transactions[${index}].description must be a string.`);
    }

    if (!isFiniteNumber(transaction.amount)) {
      issues.push(`transactions[${index}].amount must be a finite number.`);
    }

    if (transaction.balance !== null && !isFiniteNumber(transaction.balance)) {
      issues.push(`transactions[${index}].balance must be a finite number or null.`);
    }
  });

  return {
    valid: issues.length === 0,
    issues,
  };
}
