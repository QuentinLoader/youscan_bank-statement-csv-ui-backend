# Change history

## 6 October 2026 — AI-only production consolidation

- Incorporated FNB brand/legal-name recognition fix and earlier PDF page-reading, fee and source-row-count fixes.
- Made AI mandatory for every parse job; removed the legacy `/parse` mount, duplicate server, bank-specific extraction/normalization implementations and unused V1 scaffolding.
- Preserved V1 and the complete pre-cleanup checkpoint in archive tags.
- Promoted current backend V2 to `main`; frontend also uses `main`.
- Corrected readiness checks to reflect OpenAI extraction without requiring the retired classifier flag.
- Kept arithmetic/evidence validation, customer review, audit history, authentication, billing and export usage behavior.
- Removed tracked dependencies and environment files, supplied safe templates and working CI test commands.
- Replaced contradictory historical README instructions with current architecture, configuration, deployment, support and QA references.

## Earlier 6 October fixes

- Cached provider availability, pre-upload blocking and fail-closed backend processing.
- Mandatory complete PDF page reading; no native-text substitution after failed AI reading.
- AI-only result, reconciliation and export data; no bank-parser fallback.
- AI attached-fee handling and bank-name aliases.
- Three-file sequential batches and elapsed-time/waiting feedback.
- Successful/resolved customer status, actionable field review, unreliable-state messaging and retained audit diagnostics.
