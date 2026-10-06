# Architecture and data rules

## Runtime

`src/server.js` is the only server entry point. Authentication, billing, usage, webhooks and administration remain existing shared services. The parse route always calls `runParseJob`, which always delegates to `runAiParseJob`. A caller cannot opt out of AI with `requireAi:false`.

PDFs undergo full-page AI transcription and then structured AI extraction. Native PDF text is retained only as preparation metadata in the customer PDF path; native text alone cannot substitute for failed page reading. Non-PDF text preparation follows the supported upload contract. Each required AI step must succeed.

AI provides bank identity, statement metadata, balances, transaction rows, descriptions, signs and attached fee evidence. Brand/legal-name aliases map identity to the supported registry without changing the original AI fields. FNB legal footer variants are accepted; the product name alone and FirstRand alone are insufficient identity evidence.

## Validation and normalization

The AI candidate is checked for schema shape, evidence, confidence, dates, duplicates, row counts, running balances and statement reconciliation. These are deterministic checks of AI data, not deterministic extraction. They do not fill missing balances or derive financial values to force reconciliation.

Signed payment and signed attached fee are retained separately when present. The canonical movement is their rounded sum only under the extraction contract. Fees already included in the printed payment are not added again. FNB `Accrued Bank Charges` are not automatically treated as an immediate deducted fee. Source table rows, including legitimate zero rows, define extracted transaction count; summary turnover counts do not replace it.

## Availability

A process-local cache shares one in-flight probe. A healthy probe is cached for five minutes. Auth/config/quota failures wait five minutes; transient failures wait one minute. Rechecks occur on demand, with no background AI traffic. The browser polls the backend once a minute and rechecks before a batch; these page checks do not each call OpenAI.

Provider failures during processing immediately mark availability false. An older in-flight probe cannot clear a newer failure. Document-specific refusal, unsupported identity or invalid data fails only that document. The cache assumes one Railway replica; multiple replicas require shared state.

## UX and audit

| State | Customer display |
| --- | --- |
| Usable extraction with no unresolved action | `YouScan V2 — Processed successfully`, bank/source, `AI extraction`, extracted transaction count |
| Unresolved customer-confirmable fields | `Review required — X fields` and `Review fields` navigation |
| Unsafe or unusable extraction | `Unable to process reliably` and retry/support instructions |
| Provider unavailable | `Document analysis is temporarily unavailable. Please try again later.` |

Classification scores, warning counts, resolved low-confidence messages and resolution history stay in audit/debug data. They are not normal success banners. Explicit acceptance/corrections resolve customer actions while preserving the underlying evidence and warnings for support.

## Batch, export and privacy

The browser accepts at most three statements and sends them sequentially, one file per request. The backend multipart limit is three. A provider outage stops the remaining batch; other document failures leave successful documents available. Files retained in browser memory may be retried; there is no durable queue or automatic resume.

Only first successful export consumes commercial allowance. Parsing, failed extraction, review, discard and repeat export do not consume allowance. Existing payment and account behavior is preserved.

Logs use reason codes, request IDs, counts, timings and statuses. Do not log documents, financial values, account identifiers, transaction descriptions or credentials. Review persistence requires application encryption and user ownership checks.
