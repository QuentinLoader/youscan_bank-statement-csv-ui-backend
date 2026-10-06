# Production cleanup verification — 6 October 2026

## Included checkpoints

- `55ab430`: FNB AI brand/legal-name variants.
- `82b9764`: tracked dependency removal, safe environment template and CI baseline.
- Earlier merged page-reading, attached-fee, bank identity, row-count and status fixes remain in history.

## Verification

- Compatible dependency security updates applied after consolidation: backend npm audit reports zero vulnerabilities. Follow-up changes: `package-lock.json`, `CHANGELOG.md`, this release record, and the stale build comment in `src/server.js`.

- Current backend suite: 244 tests, 241 passed, zero failed, three optional live-provider tests skipped.
- Frontend: 36 tests passed; TypeScript check, production build and changed-component lint passed.
- Legacy bank-parser tests were retired with their implementation; the pre-cleanup archive tag retains the complete previous 389-test checkpoint. The smaller current suite is intentional and still covers AI extraction, validation, availability, commercial behavior and audit support.
- All existing remote feature/revival heads were checked as ancestors of the current canonical branches before deletion.
- Live deployment and original-PDF acceptance are recorded in the release handover; mocked tests do not establish financial accuracy.

## Runtime changes

Only AI extraction can execute a production parse job. The legacy `/parse` route and duplicate server are removed. Unused V1 parsing/auth/billing scaffolds and bank-specific extractors/normalizers are removed; active auth, billing, validation, review and usage modules remain.

Shared date/text helpers moved from the retired extractor tree into `src/youscan2/utils`. Historical AI comparison/proposal utilities remain for the encrypted review/audit compatibility layer and controlled synthetic diagnostics; they cannot supply a bank-parser result.

## Changed-file inventory for consolidation

```text
M	.env.example
A	CHANGELOG.md
M	README.md
A	docs/ARCHITECTURE.md
A	docs/OPERATIONS.md
A	docs/QA.md
A	docs/RELEASE-CLEANUP.md
M	package.json
D	src/app.js
D	src/config/Ozow.js
D	src/config/jwt.js
D	src/core/contacts.js
D	src/core/detectBank.js
D	src/core/extractTransactionSection.js
D	src/core/validateLedger.js
D	src/core/validateMetadata.js
D	src/errors/ParseError.js
D	src/middleware/billing.middleware.js
D	src/middleware/enforceExportLimit.js
D	src/middleware/error.middleware.js
D	src/middleware/rateLimit.js
D	src/modules/auth/auth.controller.js
D	src/modules/auth/auth.routes.js
D	src/modules/auth/auth.service.js
D	src/modules/billing/billing.controller.js
D	src/modules/billing/billing.routes.js
D	src/modules/billing/billing.service.js
D	src/modules/parse/parse.controller.js
D	src/modules/parse/parse.routes.js
D	src/modules/parse/parse.service.js
D	src/modules/user/user.controller.js
D	src/modules/user/user.routes.js
D	src/modules/user/user.service.js
D	src/parsers/absa_metadata.js
D	src/parsers/absa_transactions.js
D	src/parsers/capitec.metadata.js
D	src/parsers/capitec_transactions.js
D	src/parsers/discovery_transactions.js
D	src/parsers/fnb.metadata.js
D	src/parsers/fnb_transactions.js
D	src/parsers/nedbank.metadata.js
D	src/parsers/nedbank_transactions.js
D	src/parsers/standardbank.metadata.js
D	src/parsers/standardbank_transactions.js
D	src/routes/billing.routes.js
D	src/routes/convert.js
D	src/routes/export.js
D	src/routes/health.js
D	src/routes/parse.js
D	src/routes/pricing.routes.js
M	src/server.js
D	src/services/billing.service.js
D	src/services/parseStatement.js
D	src/utils/cleanAmount.js
D	src/utils/csv.js
D	src/utils/csvHelper.js
D	src/utils/getOrCreateUsage.js
D	src/utils/hash.util.js
D	src/utils/ozowHash.js
D	src/utils/parseDate.js
D	src/utils/parseExcel.js
D	src/utils/parsePdf.js
D	src/utils/response.util.js
D	src/utils/toCsv.js
M	src/youscan2/ai/extraction/assessCandidate.js
M	src/youscan2/ai/extraction/compareCandidate.js
M	src/youscan2/api/parse.routes.js
D	src/youscan2/classifier/aiClassificationContract.js
D	src/youscan2/classifier/aiClassifier.js
D	src/youscan2/classifier/classificationPolicy.js
D	src/youscan2/classifier/classifyDocument.js
D	src/youscan2/classifier/heuristicClassifier.js
D	src/youscan2/classifier/signals.js
D	src/youscan2/cutover/preflight.js
M	src/youscan2/cutover/readiness.js
D	src/youscan2/extractor/absa/extractor.js
D	src/youscan2/extractor/capitec/extractor.js
D	src/youscan2/extractor/discovery/extractor.js
D	src/youscan2/extractor/fnb/extractor.js
D	src/youscan2/extractor/index.js
D	src/youscan2/extractor/nedbank/extractor.js
D	src/youscan2/extractor/shared/metadata.js
D	src/youscan2/extractor/shared/money.js
D	src/youscan2/extractor/standardBank/extractor.js
D	src/youscan2/normalizer/absa/normalizer.js
D	src/youscan2/normalizer/capitec/normalizer.js
D	src/youscan2/normalizer/discovery/normalizer.js
D	src/youscan2/normalizer/fnb/normalizer.js
D	src/youscan2/normalizer/index.js
D	src/youscan2/normalizer/nedbank/normalizer.js
D	src/youscan2/normalizer/shared/common.js
D	src/youscan2/normalizer/standardbank/normalizer.js
M	src/youscan2/orchestrator/runParseJob.js
D	src/youscan2/plugins/bankStatement/bankStatement.extractor.js
D	src/youscan2/plugins/bankStatement/bankStatement.normalizer.js
D	src/youscan2/plugins/bankStatement/bankStatement.plugin.js
D	src/youscan2/plugins/invoice/invoice.extractor.js
D	src/youscan2/plugins/invoice/invoice.normalizer.js
D	src/youscan2/plugins/invoice/invoice.plugin.js
D	src/youscan2/plugins/invoice/invoice.validator.js
D	src/youscan2/plugins/logistics/deliveryNote.plugin.js
D	src/youscan2/plugins/logistics/pod.plugin.js
D	src/youscan2/plugins/logistics/waybill.plugin.js
D	src/youscan2/registry/parserRegistry.js
D	src/youscan2/review/index.js
D	src/youscan2/schemas/deliveryNote.v1.js
D	src/youscan2/schemas/invoice.v1.js
D	src/youscan2/tests/absa.e2e.test.js
D	src/youscan2/tests/aiClassification.live.test.js
D	src/youscan2/tests/aiClassification.test.js
M	src/youscan2/tests/aiCorrectionProposal.test.js
M	src/youscan2/tests/aiDecisionPolicy.test.js
M	src/youscan2/tests/aiExtractionShadow.test.js
M	src/youscan2/tests/aiOnlyParse.test.js
M	src/youscan2/tests/availability.test.js
D	src/youscan2/tests/bankBrandPriority.test.js
D	src/youscan2/tests/capitec.e2e.test.js
D	src/youscan2/tests/capitecMetadataRealFormat.test.js
D	src/youscan2/tests/capitecRealFormat.test.js
M	src/youscan2/tests/cutoverReadiness.test.js
D	src/youscan2/tests/discovery.e2e.test.js
D	src/youscan2/tests/discoveryCompactPdf.test.js
D	src/youscan2/tests/discoveryRealFormat.test.js
D	src/youscan2/tests/fnb.e2e.test.js
D	src/youscan2/tests/fnbBusinessOcr.test.js
D	src/youscan2/tests/foundation.test.js
D	src/youscan2/tests/nedbank.e2e.test.js
D	src/youscan2/tests/nedbankRealFormat.test.js
M	src/youscan2/tests/parseJobDiagnostics.test.js
A	src/youscan2/tests/productionArchitecture.test.js
M	src/youscan2/tests/productionParseApi.test.js
M	src/youscan2/tests/shadowAccuracy.test.js
D	src/youscan2/tests/standardBank.e2e.test.js
D	src/youscan2/types/classification.js
D	src/youscan2/types/parseJob.js
D	src/youscan2/types/parseResult.js
D	src/youscan2/types/parserPlugin.js
D	src/youscan2/types/validation.js
R099	src/youscan2/extractor/shared/dates.js	src/youscan2/utils/dates.js
R100	src/youscan2/extractor/shared/utils.js	src/youscan2/utils/text.js
```
