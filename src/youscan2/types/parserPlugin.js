/**
 * YouScan V2
 * JSDoc-only parser plugin contract.
 */

/**
 * @typedef {Object} SchemaRegistryEntry
 * @property {string} schemaKey
 * @property {string} documentType
 * @property {string} version
 * @property {string} parserKey
 * @property {string} validatorKey
 * @property {string} normalizerKey
 * @property {boolean} active
 */

/**
 * @typedef {Object} ParserContext
 * @property {string} jobId
 * @property {Object} [file]
 * @property {string} [extractedText]
 * @property {string} [textPreview]
 * @property {Object} classification
 * @property {SchemaRegistryEntry} schema
 */

/**
 * Parser plugins are runtime objects implementing:
 * canHandle, extract, normalize, validate and toFinalResult.
 * This file documents the contract without introducing TypeScript syntax.
 */

export {};
