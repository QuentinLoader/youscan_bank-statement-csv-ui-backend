/**
 * YouScan V2
 * Bank statement validator.
 */

import { validateBankStatementShape } from "../../schemas/bankStatement.v1.js";

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function hasTooManyDecimals(value) {
  if (!isNumber(value)) return false;
  return Math.abs(value * 100 - Math.round(value * 100)) > 0.000001;
}

function isValidTransactionDate(value) {
  const match = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return false;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function looksLikeDebit(description = "") {
  const lower = String(description).toLowerCase();
  const debitSignals = [
    "fee",
    "charge",
    "withdrawal",
    "debit",
    "proof of pmt email",
    "admin charge",
    "monthly acc fee",
    "transaction charge",
    "notific fee",
    "card purchase",
  ];

  return debitSignals.some((signal) => lower.includes(signal));
}

function looksLikeCredit(description = "") {
  const lower = String(description).toLowerCase();
  const creditSignals = [
    "credit",
    "payment cr",
    "deposit",
    "acb credit",
    "salary",
    "refund",
    "cash deposit",
  ];

  return creditSignals.some((signal) => lower.includes(signal));
}

function addIssue(issues, issue) {
  issues.push(issue);
}

export async function validateBankStatement(normalized) {
  const issues = [];
  const transactions = Array.isArray(normalized?.transactions)
    ? normalized.transactions
    : [];

  let warningCount = 0;
  let errorCount = 0;

  // First enforce the canonical V2 contract before semantic reconciliation.
  const shapeValidation = validateBankStatementShape(normalized);
  if (!shapeValidation.valid) {
    for (const message of shapeValidation.issues) {
      addIssue(issues, {
        severity: "error",
        issueType: "schema_shape_error",
        message,
        rowIndex: null,
        metadata: {},
      });
      errorCount++;
    }
  }

  if (!transactions.length) {
    addIssue(issues, {
      severity: "error",
      issueType: "no_transactions",
      message: "No transactions were extracted from the statement.",
      rowIndex: null,
      metadata: {},
    });

    return {
      valid: false,
      status: "failed",
      issues,
      score: 0,
    };
  }

  const openingBalance = normalized?.openingBalance;
  const closingBalance = normalized?.closingBalance;
  const accountNumber = normalized?.accountNumber;
  const clientName = normalized?.clientName;
  const statementPeriodStart = normalized?.statementPeriodStart;
  const statementPeriodEnd = normalized?.statementPeriodEnd;

  if (!accountNumber) {
    addIssue(issues, {
      severity: "warning",
      issueType: "missing_account_number",
      message: "Account number could not be extracted.",
      rowIndex: null,
      metadata: {},
    });
    warningCount++;
  }

  if (!clientName) {
    addIssue(issues, {
      severity: "warning",
      issueType: "missing_client_name",
      message: "Client name could not be extracted.",
      rowIndex: null,
      metadata: {},
    });
    warningCount++;
  }

  if (!statementPeriodStart || !statementPeriodEnd) {
    addIssue(issues, {
      severity: "warning",
      issueType: "missing_statement_period",
      message: "Statement period could not be extracted fully.",
      rowIndex: null,
      metadata: { statementPeriodStart, statementPeriodEnd },
    });
    warningCount++;
  }

  if (!isNumber(openingBalance)) {
    addIssue(issues, {
      severity: "warning",
      issueType: "missing_opening_balance",
      message: "Opening balance is missing or invalid.",
      rowIndex: null,
      metadata: { openingBalance },
    });
    warningCount++;
  }

  if (!isNumber(closingBalance)) {
    addIssue(issues, {
      severity: "warning",
      issueType: "missing_closing_balance",
      message: "Closing balance is missing or invalid.",
      rowIndex: null,
      metadata: { closingBalance },
    });
    warningCount++;
  }

  if (isNumber(openingBalance) && hasTooManyDecimals(openingBalance)) {
    addIssue(issues, {
      severity: "warning",
      issueType: "opening_balance_precision_issue",
      message: "Opening balance has suspicious precision and may be inferred incorrectly.",
      rowIndex: null,
      metadata: { openingBalance },
    });
    warningCount++;
  }

  if (isNumber(closingBalance) && hasTooManyDecimals(closingBalance)) {
    addIssue(issues, {
      severity: "warning",
      issueType: "closing_balance_precision_issue",
      message: "Closing balance has suspicious precision.",
      rowIndex: null,
      metadata: { closingBalance },
    });
    warningCount++;
  }

  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    const description = tx?.description || "";
    const amount = tx?.amount;
    const balance = tx?.balance;

    if (!tx?.date) {
      addIssue(issues, {
        severity: "warning",
        issueType: "missing_date",
        message: "Transaction is missing a date.",
        rowIndex: i,
        metadata: { transaction: tx },
      });
      warningCount++;
    } else if (!isValidTransactionDate(tx.date)) {
      addIssue(issues, {
        severity: "error",
        issueType: "invalid_date",
        message: "Transaction date is not a valid DD/MM/YYYY calendar date.",
        rowIndex: i,
        metadata: { transaction: tx },
      });
      errorCount++;
    }

    if (!description) {
      addIssue(issues, {
        severity: "warning",
        issueType: "missing_description",
        message: "Transaction is missing a description.",
        rowIndex: i,
        metadata: { transaction: tx },
      });
      warningCount++;
    }

    if (!isNumber(amount)) {
      addIssue(issues, {
        severity: "error",
        issueType: "invalid_amount",
        message: "Transaction amount is missing or invalid.",
        rowIndex: i,
        metadata: { transaction: tx },
      });
      errorCount++;
      continue;
    }

    if (!isNumber(balance)) {
      addIssue(issues, {
        severity: "warning",
        issueType: "missing_balance",
        message: "Transaction balance is missing or invalid.",
        rowIndex: i,
        metadata: { transaction: tx },
      });
      warningCount++;
    }

    if (amount === 0) {
      addIssue(issues, {
        severity: "warning",
        issueType: "zero_amount",
        message: "Transaction amount is zero. This may indicate a parsing error.",
        rowIndex: i,
        metadata: { transaction: tx },
      });
      warningCount++;
    }

    if (hasTooManyDecimals(amount)) {
      addIssue(issues, {
        severity: "warning",
        issueType: "amount_precision_issue",
        message: "Transaction amount has suspicious precision.",
        rowIndex: i,
        metadata: { transaction: tx },
      });
      warningCount++;
    }

    if (looksLikeDebit(description) && amount > 0) {
      addIssue(issues, {
        severity: "warning",
        issueType: "possible_wrong_sign_debit",
        message: "Debit-like transaction has a positive amount.",
        rowIndex: i,
        metadata: { transaction: tx },
      });
      warningCount++;
    }

    if (looksLikeCredit(description) && amount < 0) {
      addIssue(issues, {
        severity: "warning",
        issueType: "possible_wrong_sign_credit",
        message: "Credit-like transaction has a negative amount.",
        rowIndex: i,
        metadata: { transaction: tx },
      });
      warningCount++;
    }

    if (i > 0) {
      const previous = transactions[i - 1];
      if (isNumber(previous?.balance) && isNumber(balance) && isNumber(amount)) {
        const delta = round2(balance - previous.balance);
        if (delta !== round2(amount)) {
          addIssue(issues, {
            severity: "warning",
            issueType: "balance_continuity_mismatch",
            message: "Balance does not reconcile cleanly with the previous row.",
            rowIndex: i,
            metadata: {
              previousBalance: previous.balance,
              amount,
              currentBalance: balance,
              expectedDelta: delta,
              transaction: tx,
            },
          });
          warningCount++;
        }
      }
    }
  }

  if (isNumber(openingBalance) && transactions.length > 0) {
    const firstTx = transactions[0];
    if (isNumber(firstTx.amount) && isNumber(firstTx.balance)) {
      const expectedFirstBalance = round2(openingBalance + firstTx.amount);
      const actualFirstBalance = round2(firstTx.balance);

      if (expectedFirstBalance !== actualFirstBalance) {
        addIssue(issues, {
          severity: "warning",
          issueType: "opening_balance_mismatch",
          message: "Opening balance does not reconcile with the first transaction.",
          rowIndex: 0,
          metadata: {
            openingBalance,
            firstTransaction: firstTx,
            expectedFirstBalance,
            actualFirstBalance,
          },
        });
        warningCount++;
      }
    }
  }

  if (isNumber(closingBalance) && transactions.length > 0) {
    const lastTx = transactions[transactions.length - 1];
    if (isNumber(lastTx.balance)) {
      const actualClosingBalance = round2(lastTx.balance);
      const expectedClosingBalance = round2(closingBalance);

      if (actualClosingBalance !== expectedClosingBalance) {
        addIssue(issues, {
          severity: "warning",
          issueType: "closing_balance_mismatch",
          message: "Closing balance does not match the final transaction balance.",
          rowIndex: transactions.length - 1,
          metadata: {
            closingBalance,
            lastTransaction: lastTx,
            expectedClosingBalance,
            actualClosingBalance,
          },
        });
        warningCount++;
      }
    }
  }

  let status = "passed";
  let valid = true;

  if (errorCount > 0) {
    status = "failed";
    valid = false;
  } else if (warningCount > 0) {
    status = "passed_with_warnings";
  }

  const rawScore = Math.max(0, 1 - (errorCount * 0.35 + warningCount * 0.05));

  return {
    valid,
    status,
    issues,
    score: round2(rawScore),
  };
}
