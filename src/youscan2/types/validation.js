/**
 * YouScan V2
 * JSDoc-only validation contracts.
 */

/** @typedef {"info"|"warning"|"error"} ValidationSeverity */
/** @typedef {"passed"|"passed_with_warnings"|"failed"} ValidationStatus */

/**
 * @typedef {Object} ValidationIssue
 * @property {ValidationSeverity} severity
 * @property {string} issueType
 * @property {string} message
 * @property {number|null} [rowIndex]
 * @property {Object<string, unknown>} [metadata]
 */

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} valid
 * @property {ValidationStatus} status
 * @property {ValidationIssue[]} issues
 * @property {number} score
 */

export {};
