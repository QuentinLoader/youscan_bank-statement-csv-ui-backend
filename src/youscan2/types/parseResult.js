/**
 * YouScan V2
 * JSDoc-only unified parse-result contracts.
 */

/** @typedef {"completed"|"failed"|"needs_review"|"unsupported"} ParseJobStatus */

/**
 * @template TData
 * @typedef {Object} ParseResult
 * @property {string} jobId
 * @property {string} documentType
 * @property {string} documentSubtype
 * @property {string} parserKey
 * @property {string} parserVersion
 * @property {string} schemaKey
 * @property {number} confidence
 * @property {string} validationStatus
 * @property {Array<Object>} issues
 * @property {TData} data
 * @property {ParseJobStatus} status
 */

export {};
