/**
 * YouScan V2
 * Evidence verification for AI extraction candidates.
 *
 * Evidence snippets are retained in-memory only. The returned verification
 * report contains field paths/reason codes, never the snippets themselves.
 */

function normalizeEvidenceText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u00A0\t\r\n ]+/g, " ")
    .trim()
    .toLowerCase();
}

function collectFields(candidate) {
  const fields = [
    ["bankName", candidate?.bankName],
    ["accountNumber", candidate?.accountNumber],
    ["clientName", candidate?.clientName],
    ["statementPeriodStart", candidate?.statementPeriodStart],
    ["statementPeriodEnd", candidate?.statementPeriodEnd],
    ["openingBalance", candidate?.openingBalance],
    ["closingBalance", candidate?.closingBalance],
  ];

  const transactions = Array.isArray(candidate?.transactions)
    ? candidate.transactions
    : [];

  transactions.forEach((transaction, index) => {
    fields.push([`transactions[${index}].date`, transaction?.date]);
    fields.push([`transactions[${index}].description`, transaction?.description]);
    fields.push([`transactions[${index}].amount`, transaction?.amount]);
    fields.push([`transactions[${index}].balance`, transaction?.balance]);
  });

  return fields;
}

export function verifyAiExtractionEvidence(candidate, sourceText) {
  const normalizedSource = normalizeEvidenceText(sourceText);
  const issues = [];
  let checkedFieldCount = 0;
  let verifiedFieldCount = 0;

  for (const [path, field] of collectFields(candidate)) {
    if (!field || field.value === null) continue;
    checkedFieldCount += 1;

    const snippets = Array.isArray(field.evidence) ? field.evidence : [];
    if (!snippets.length) {
      issues.push({
        severity: "warning",
        issueType: "missing_field_evidence",
        fieldPath: path,
      });
      continue;
    }

    const hasSourceMatch = snippets.some((snippet) => {
      const normalizedSnippet = normalizeEvidenceText(snippet);
      return (
        normalizedSnippet.length >= 3 &&
        normalizedSource.length > 0 &&
        normalizedSource.includes(normalizedSnippet)
      );
    });

    if (!hasSourceMatch) {
      issues.push({
        severity: "warning",
        issueType: "unverifiable_field_evidence",
        fieldPath: path,
      });
      continue;
    }

    verifiedFieldCount += 1;
  }

  return {
    valid: issues.length === 0,
    checkedFieldCount,
    verifiedFieldCount,
    issues,
  };
}
