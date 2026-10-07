# YouScan V2 backend

This repository contains the current AI-only bank-statement service. `main` is the production source of truth. Railway must follow `main`; the frontend repository also uses `main`.

The configured production provider is OpenAI. Historical Anthropic references do not define the current provider. Credentials and the selected model are configured in Railway, never in Git.

## Customer workflow

Authenticated availability check → upload → AI PDF page reading → AI structured extraction → evidence/schema/arithmetic validation → result or actionable review → CSV export.

All statement fields originate from AI extraction. Validation checks consistency without inventing balances, amounts, fees or transactions. An explicit customer edit is retained as a human correction. Failed AI never produces a completed statement or invokes another extractor.

The supported bank registry covers ABSA, FNB, Capitec, Standard Bank, Nedbank and Discovery Bank. Support is a routing contract, not a guarantee that every layout has passed current live accuracy testing.

## APIs

| Endpoint | Purpose |
| --- | --- |
| `GET /health/routes` | Public route inventory; does not probe AI |
| `GET /api/v2/parse/availability` | Authenticated cached AI availability |
| `POST /api/v2/parse` | Authenticated AI-only processing |
| `POST /api/v2/parse/export` | Export authorization and first-export usage recording |
| `/api/v2/reviews` | Authenticated, user-scoped review history |
| `/auth`, `/usage`, `/billing`, `/ozow`, `/api/admin`, `/pricing` | Existing account, usage, payment and administration services |

The retired `/parse` endpoint is not mounted. There is one application entry point: `src/server.js`.

## Setup and verification

Use Node 20 or newer and npm. Copy `.env.example` to a local `.env`, supply the existing database/auth/payment/email settings and required AI configuration, then run:

```sh
npm ci
npm test
node scripts/migrate-operations.js
npm start
```

The JavaScript backend has no compilation step. CI runs the current V2 suite. Optional live AI tests remain opt-in; normal tests use synthetic inputs and mocked providers. Never add confidential PDFs or statement contents to Git.

## Documentation

Paid monthly and annual terms require a new confirmed payment to renew. Expiry uses `renewal_date`, blocks paid-plan parses and preserves the account/history; it never resets the account to FREE.

- [Architecture and data rules](docs/ARCHITECTURE.md)
- [Configuration, deployment and support runbook](docs/OPERATIONS.md)
- [QA and release acceptance](docs/QA.md)
- [Commercial plans and manual renewal](docs/COMMERCIAL-PLANS.md)
- [Admin failures, metrics, retention and support](docs/ADMIN-OPERATIONS.md)
- [Change history](CHANGELOG.md)
- [Historical cleanup record](docs/history/2026-10-06-production-cleanup.md)

## Historical code

`archive/v1-final` preserves old V1 at `20dc938`. `archive/v2-before-production-cleanup` preserves the complete pre-cleanup V2 checkpoint including retired bank extraction code and its tests. Tags are historical references, not deployed branches. Production has no bank-specific deterministic extractor or heuristic bank-classification path.

The encrypted review/audit compatibility layer retains historical proposal structures for support. Its presence does not make legacy extraction executable. Schema names ending in `.v1` describe wire-schema versions, not an alternate application version.


## Admin and hosting

Admin opens separately from scanning. Safe structured failure records and support-resolution history live in Railway Postgres and survive backend restarts. Records begin at the Admin rollout; previous errors are not imported. The default 90-day operational policy is enforced by a protected cleanup endpoint called manually or by an external scheduler, not an automatic TTL. Payment/export/account history is separate.

GitHub holds source, Railway runs the backend and database, and Lovable currently hosts the frontend. Vercel frontend configuration is prepared; hosting has not moved. Admin provider status reads cached availability without a new AI probe.
