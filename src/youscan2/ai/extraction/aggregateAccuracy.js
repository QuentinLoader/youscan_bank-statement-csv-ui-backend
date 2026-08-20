/**
 * YouScan V2
 * Aggregate privacy-safe accuracy/agreement reports across labelled bank
 * statement samples. Raw statement values are never accepted or returned.
 */

function round4(value) {
  return Math.round(value * 10_000) / 10_000;
}

function safeRate(numerator, denominator) {
  return denominator > 0 ? round4(numerator / denominator) : null;
}

function increment(target, key, amount = 1) {
  target[key] = (target[key] || 0) + amount;
}

function mergeCounts(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    increment(target, key, Number(value) || 0);
  }
}

export function aggregateBankStatementAccuracy(scores = []) {
  const validScores = Array.isArray(scores) ? scores : [];
  const comparable = validScores.filter((score) => score?.comparable);
  const exactMatches = comparable.filter((score) => score.exactMatch).length;
  const fieldTotals = {};
  const bankTotals = {};
  const disagreement = {
    issueCount: 0,
    affectedTransactionRowCount: 0,
    byCategory: {},
    bySeverity: {},
    byField: {},
  };
  let comparedSignals = 0;
  let matchedSignals = 0;

  for (const score of comparable) {
    comparedSignals += score.signals?.compared || 0;
    matchedSignals += score.signals?.matched || 0;

    for (const [field, stats] of Object.entries(score.fieldAccuracy || {})) {
      fieldTotals[field] ||= { compared: 0, matched: 0 };
      fieldTotals[field].compared += stats.compared || 0;
      fieldTotals[field].matched += stats.matched || 0;
    }

    const bank = score.bankName || "unknown";
    bankTotals[bank] ||= {
      sampleCount: 0,
      exactMatchCount: 0,
      comparedSignals: 0,
      matchedSignals: 0,
    };
    bankTotals[bank].sampleCount += 1;
    bankTotals[bank].exactMatchCount += score.exactMatch ? 1 : 0;
    bankTotals[bank].comparedSignals += score.signals?.compared || 0;
    bankTotals[bank].matchedSignals += score.signals?.matched || 0;

    disagreement.issueCount += score.disagreement?.issueCount || 0;
    disagreement.affectedTransactionRowCount +=
      score.disagreement?.affectedTransactionRowCount || 0;
    mergeCounts(disagreement.byCategory, score.disagreement?.byCategory);
    mergeCounts(disagreement.bySeverity, score.disagreement?.bySeverity);
    mergeCounts(disagreement.byField, score.disagreement?.byField);
  }

  const fieldAccuracy = Object.fromEntries(
    Object.entries(fieldTotals).map(([field, stats]) => [
      field,
      {
        compared: stats.compared,
        matched: stats.matched,
        accuracy: safeRate(stats.matched, stats.compared),
      },
    ])
  );

  const banks = Object.fromEntries(
    Object.entries(bankTotals).map(([bank, stats]) => [
      bank,
      {
        sampleCount: stats.sampleCount,
        exactMatchCount: stats.exactMatchCount,
        exactMatchRate: safeRate(stats.exactMatchCount, stats.sampleCount),
        comparedSignals: stats.comparedSignals,
        matchedSignals: stats.matchedSignals,
        accuracy: safeRate(stats.matchedSignals, stats.comparedSignals),
      },
    ])
  );

  return {
    sampleCount: validScores.length,
    comparableSampleCount: comparable.length,
    nonComparableSampleCount: validScores.length - comparable.length,
    exactMatchCount: exactMatches,
    exactMatchRate: safeRate(exactMatches, comparable.length),
    signals: {
      compared: comparedSignals,
      matched: matchedSignals,
      accuracy: safeRate(matchedSignals, comparedSignals),
    },
    fieldAccuracy,
    banks,
    disagreement,
  };
}
