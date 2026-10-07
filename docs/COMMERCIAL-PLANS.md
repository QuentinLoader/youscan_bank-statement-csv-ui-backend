# Commercial plans and renewal

`renewal_date` is the authoritative expiry timestamp for paid subscription access. `billing_cycle_end` is retained account metadata and must not replace it. The active payment status and a valid future expiry are both required for subscription access. Missing or invalid expiry fails closed.

| Plan | Entitlement | Renewal |
| --- | --- | --- |
| FREE | 15 lifetime first exports | No periodic reset |
| PAYG_10 | Once-off purchase of 10 credits | Buy more credits; no subscription expiry |
| MONTHLY_25 | 25 first exports during the paid term | New confirmed Ozow payment required for each month |
| PRO_YEAR_UNLIMITED | Unlimited first exports during the paid year | New confirmed Ozow payment required for each year |

Prices are unchanged and served by `/pricing`. Subscription `recurring` is false and `renewal` is manual; a monthly/yearly billing cycle describes the purchased term, not an automatic debit.

## Customer experience

Warn from exactly seven days before expiry, with a stronger warning in the final three days. Both subscription plans offer **Renew subscription** through the existing Ozow payment form, including for the user's current plan. After expiry, hide upload access and show renewal guidance. The backend independently rejects paid-plan parses with `SUBSCRIPTION_EXPIRED` before uploading or calling AI.

Expiry does not change `plan_code`, grant FREE uses, reset lifetime usage, erase account/history or replenish credits. PAYG credits remain once-off and are not expired by an old subscription date/status. Browser warnings recalculate every 30 seconds and on focus; backend enforcement uses the current timestamp on each request.

## Payment confirmation and allowance

Only the verified, matching, successful Ozow webhook applies the subscription update. Payment initiation, browser return, status polling, failed/cancelled/pending callbacks and expiry do not extend the term or grant allowance.

A confirmed MONTHLY_25 payment replenishes the balance to 25 (unused allowance does not roll over); Pro remains unlimited. Early same-plan renewal adds the purchased month/year to the existing future `renewal_date`, preserving paid time. Expired/new/different-plan purchases begin from payment confirmation time. Each successful payment is applied once; later callbacks cannot downgrade a confirmed payment and enable duplicate credit grants. Lifetime FREE usage remains unchanged.

The browser stores the payment's transaction reference before leaving for Ozow. On return, authenticated `/billing/payment-status?reference=...` checks an owned transaction for `Complete` and `processed_at`, and `/billing/status` checks the resulting entitlement. An existing active plan or positive credit balance is not proof that the new payment completed. No saved reference means the browser cannot safely confirm that purchase; show pending/support guidance rather than claim success.

Parsing still consumes no allowance. First successful export consumes allowance, and re-export remains free; this release preserves the existing export ledger behavior.

## Validation

Synthetic tests cover exact expiry, missing/invalid dates, inactive status, preservation of plan/lifetime usage, failed/pending/cancelled payments, successful renewal, webhook replay, transaction ownership and warning boundaries. A real paid renewal is a separate manual acceptance check; do not charge an account merely to run an automated test.

## Administrator entitlement

Effective verified administrators receive a separate unlimited entitlement without a new plan code or paid Pro subscription. No FREE allowance/paid credit is consumed and expiry does not block them. Commercial subscription/credit/renewal metadata remains intact and applies immediately to new requests after revocation. Administrator usage is classified separately from commercial exports and confirmed payment revenue. Only normal verified Ozow payment events alter the underlying purchased term. See [Administrator management](ADMINISTRATOR-MANAGEMENT.md).
