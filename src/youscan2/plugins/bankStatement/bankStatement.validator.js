/**
 * YouScan 2.0
 * Bank statement validator
 */

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function looksLikeDebit(description = "") {
  const lower = String(description).toLowerCase();

  const debitSignals = [
    "fee",
    "charge",
    "payment dt",
    "digital pmt",
    "debit",
    "withdrawal",
    "proof of pmt email",
    "admin charge",
    "monthly acc fee",
    "transaction charge",
    "notific fee",
  ];

  return debitSignals.some(signal => lower.includes(signal));
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

  return creditSignals.some(signal => lower.includes(signal));
}

export async function validateBankStatement(normalized) {
  const issues = [];
  const transactions = Array.isArray(normalized?.transactions)
    ? normalized.transactions
    : [];

  if (!transactions.length) {
    issues.push({
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

  let warningCount = 0;
  let errorCount = 0;

  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    const description = tx?.description || "";
    const amount = tx?.amount;
    const balance = tx?.balance;

    if (!tx?.date) {
      issues.push({
        severity: "warning",
        issueType: "missing_date",
        message: "Transaction is missing a date.",
        rowIndex: i,
        metadata: { transaction: tx },
      });
      warningCount++;
    }

    if (!description) {
      issues.push({
        severity: "warning",
        issueType: "missing_description",
        message: "Transaction is missing a description.",
        rowIndex: i,
        metadata: { transaction: tx },
      });
      warningCount++;
    }

    if (!isNumber(amount)) {
      issues.push({
        severity: "error",
        issueType: "invalid_amount",
        message: "Transaction amount is missing or invalid.",
        rowIndex: i,
        metadata: { transaction: tx },
      });
      errorCount++;
      continue;
    }

    if (amount === 0) {
      issues.push({
        severity: "warning",
        issueType: "zero_amount",
        message: "Transaction amount is zero. This may indicate a parsing error.",
        rowIndex: i,
        metadata: { transaction: tx },
      });
      warningCount++;
    }

    if (!isNumber(balance)) {
      issues.push({
        severity: "warning",
        issueType: "missing_balance",
        message: "Transaction balance is missing or invalid.",
        rowIndex: i,
        metadata: { transaction: tx },
      });
      warningCount++;
    }

    const debitLike = looksLikeDebit(description);
    const creditLike = looksLikeCredit(description);

    if (debitLike && amount > 0) {
      issues.push({
        severity: "warning",
        issueType: "possible_wrong_sign_debit",
        message: "Debit-like transaction has a positive amount.",
        rowIndex: i,
        metadata: { transaction: tx },
      });
      warningCount++;
    }

    if (creditLike && amount < 0) {
      issues.push({
        severity: "warning",
        issueType: "possible_wrong_sign_credit",
        message: "Credit-like transaction has a negative amount.",
        rowIndex: i,
        metadata: { transaction: tx },
      });
      warningCount++;
    }

    if (i > 0) {
      const prev = transactions[i - 1];

      if (isNumber(prev?.balance) && isNumber(balance) && isNumber(amount)) {
        const expectedIfCredit = round2(prev.balance + amount);
        const expectedIfDebit = round2(prev.balance - Math.abs(amount));
        const actual = round2(balance);

        const matchesCredit = round2(expectedIfCredit) === actual;
        const matchesDebit = round2(expectedIfDebit) === actual;

        if (!matchesCredit && !matchesDebit) {
          issues.push({
            severity: "warning",
            issueType: "balance_continuity_mismatch",
            message: "Balance does not reconcile cleanly with the previous row.",
            rowIndex: i,
            metadata: {
              previousBalance: prev.balance,
              amount,
              currentBalance: balance,
              transaction: tx,
            },
          });
          warningCount++;
        }
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
  const score = round2(rawScore);

  return {
    valid,
    status,
    issues,
    score,
  };
}