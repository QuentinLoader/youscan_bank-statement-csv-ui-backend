// Never log model output, evidence snippets, values or unrecognized field names.
export const AI_EXTRACTION_FAILED_MESSAGE =
  "AI could not extract this statement correctly. Please try again.";

const FIELD = /^(?:data\.)?(bankName|accountNumber|clientName|statementPeriodStart|statementPeriodEnd|openingBalance|closingBalance|transactionCount|transactions(?:\[\d{1,4}\])?(?:\.(?:date|description|amount|fee|balance))?)(?:\.(value|confidence|evidence)(?:\[\d{1,4}\])?)?(?=\s|\(|$)/;
const RULES = [
  [/does not match transactions\.length/, "transaction_count_mismatch"],
  [/must be empty when value is null\.$/, "null_field_has_evidence"],
  [/is not allowed\.$/, "unexpected_field"],
  [/is required\.$/, "required_field_missing"],
  [/cannot be null\.$/, "required_value_missing"],
  [/must (?:not be empty|be a non-empty string)\.$/, "empty_string"],
  [/must be a number between 0 and 1\.$/, "invalid_confidence"],
  [/must be a finite number(?: or null)?\.$/, "invalid_number"],
  [/must be a non-negative integer\.$/, "invalid_transaction_count"],
  [/must be a string(?: or null)?\.$/, "invalid_string"],
  [/must be an object\.$/, "invalid_object"],
  [/must be an array\.$/, "invalid_array"],
  [/(?:exceeds \d+ characters|must contain at most \d+ snippets)\.$/, "evidence_limit_exceeded"],
  [/cannot (?:exceed \d+|contain more than \d+ rows)\.$/, "transaction_limit_exceeded"],
];

export function summarizeAiValidationIssues(issues) {
  if (!Array.isArray(issues)) return [];
  return issues.slice(0, 25).map((issue) => {
    if (typeof issue !== "string") return { field: "response", reason: "invalid_response" };
    const field = FIELD.exec(issue)?.[0]?.trim() || "response";
    const reason = RULES.find(([pattern]) => pattern.test(issue))?.[1] || "invalid_response";
    return { field, reason };
  });
}
