/**
 * YouScan V2
 * JSDoc-only classification contracts.
 *
 * The repository is JavaScript/ESM. These definitions intentionally contain
 * no TypeScript syntax so Node can parse every .js file in src/youscan2.
 */

/**
 * @typedef {"bank_statement"|"invoice"|"delivery_note"|"proof_of_delivery"|"waybill"|"unknown"} DocumentType
 */

/**
 * @typedef {"absa_statement"|"fnb_statement"|"nedbank_statement"|"capitec_statement"|"discovery_statement"|"standard_bank_statement"|"generic_invoice"|"generic_delivery_note"|"generic_pod"|"generic_waybill"|"unknown"} DocumentSubtype
 */

/**
 * @typedef {Object} ClassificationResult
 * @property {DocumentType} documentType
 * @property {DocumentSubtype} documentSubtype
 * @property {number} confidence
 * @property {boolean} supported
 * @property {string[]} reasons
 * @property {string|null} [suggestedPipeline]
 * @property {string} [fileName]
 * @property {"heuristic"|"ai"|"hybrid"} [classificationMethod]
 * @property {boolean} [aiAttempted]
 */

export {};
