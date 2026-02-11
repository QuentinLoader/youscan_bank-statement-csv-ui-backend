# YouScan

**YouScan** converts South African bank statements (PDF) into clean, accountant-ready CSV files.

Designed for:
- Accountants
- Bookkeepers
- Small businesses
- Auditable workflows

---

## Key Principles

- **Deterministic parsing**  
  No AI, no guessing, no categorisation.

- **Fail loudly**  
  If SlimJan is not confident in a statement’s structure, it stops and tells you why.

- **Accountant-friendly output**  
  Explicit debit / credit columns with running balances.

---

## Supported Banks

- Capitec Bank
- FNB (First National Bank)

More banks can be added using the same deterministic rules.

---

## Privacy & Compliance

SlimJan is designed to be POPIA-friendly by default.

- Bank statements are **processed in memory only**
- **No files are stored**, logged, or retained
- No data is written to disk
- No data is shared with third parties

Once conversion is complete, the file is discarded.

---

## How it Works

1. Upload a PDF bank statement
2. SlimJan extracts:
   - Account holder
   - Statement period
   - Transaction ledger
3. You preview the transactions
4. CSV is generated **only after approval**

---

## Output Format

CSV includes:
- Statement metadata at the top
- Canonical transaction table:
  - Date
  - Description
  - Debit
  - Credit
  - Fee (if present)
  - Balance

---

## Disclaimer

SlimJan does not modify, correct, or infer transactions.  
Users remain responsible for verifying exported data before accounting or submission.
