/**
 * ABSA Parser - hardened
 * Keeps the useful parts from the current parser:
 * - SA number parsing
 * - running balance reconciliation
 * - footer filtering concept
 * - metadata return shape
 *
 * Fixes:
 * - invalid dates like 86/01/2026
 * - footer/body text leaking into transactions
 * - better client name / statement period extraction
 * - safer account number extraction
 * - more defensive transaction parsing
 */

export const parseAbsa = (text) => {
  const transactions = [];

  // -----------------------------
  // Helpers
  // -----------------------------
  const normalizeWhitespace = (value = "") =>
    value.replace(/\u00A0/g, " ").replace(/[ \t]+/g, " ").trim();

  const titleCase = (value = "") =>
    value
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .replace(/\bAbsa\b/g, "ABSA")
      .replace(/\bFnb\b/g, "FNB");

  const isValidDate = (dd, mm, yyyy) => {
    const day = Number(dd);
    const month = Number(mm);
    const year = Number(yyyy);

    if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) {
      return false;
    }
    if (year < 2000 || year > 2100) return false;
    if (month < 1 || month > 12) return false;
    if (day < 1 || day > 31) return false;

    const dt = new Date(year, month - 1, day);
    return (
      dt.getFullYear() === year &&
      dt.getMonth() === month - 1 &&
      dt.getDate() === day
    );
  };

  const parseNum = (val) => {
    if (!val) return 0;
    let clean = String(val).trim();

    const isNeg =
      clean.endsWith("-") ||
      clean.startsWith("-") ||
      /\bDR\b/i.test(clean);

    clean = clean
      .replace(/\s+/g, "")
      .replace(/[^0-9,.-]/g, "");

    // SA style often uses comma decimals
    // Example: 1 382,23
    if (clean.includes(",") && !clean.includes(".")) {
      clean = clean.replace(",", ".");
    } else if (clean.includes(",") && clean.includes(".")) {
      // if both exist, assume commas are thousand separators
      clean = clean.replace(/,/g, "");
    }

    clean = clean.replace(/-$/, "").replace(/^-/, "");

    const num = parseFloat(clean);
    if (Number.isNaN(num)) return 0;

    return isNeg ? -Math.abs(num) : num;
  };

  const amountPattern = /-?\d[\d\s]*[.,]\d{2}-?/g;

  const footerStopWords = [
    "Our Privacy Notice",
    "Page 1",
    "Page 2",
    "ABSA Bank Limited",
    "Tax Invoice",
    "Authorised Financial Services",
    "Registration Number",
    "Vat Registration",
    "Cheque account statement",
    "Return address",
    "General Enquiries",
    "eStamp",
    "ABSA BUSINESS BANKING",
    "YOUR PRICING PLAN",
    "CHARGE: A = ADMINISTRATION",
    "* = VAT",
    "PLEASE CONTACT YOUR RELATIONSHIP EXECUTIVE",
    "VISIT ABSA.CO.ZA"
  ];

  const containsFooter = (value = "") =>
    footerStopWords.some((w) => value.toUpperCase().includes(w.toUpperCase()));

  const stripFooter = (value = "") => {
    let result = value;
    for (const stopWord of footerStopWords) {
      const idx = result.toUpperCase().indexOf(stopWord.toUpperCase());
      if (idx !== -1) {
        result = result.slice(0, idx);
      }
    }
    return normalizeWhitespace(result);
  };

  const isLikelyNonTransactionText = (description = "") => {
    if (!description) return true;
    const upper = description.toUpperCase();

    if (description.length > 140) return true;
    if (upper.includes("CHEQUE ACCOUNT STATEMENT")) return true;
    if (upper.includes("RETURN ADDRESS")) return true;
    if (upper.includes("PRIVATE BAG")) return true;
    if (upper.includes("POSTNET")) return true;
    if (upper.includes("GENERAL ENQUIRIES")) return true;
    if (upper.includes("PLEASE CONTACT YOUR RELATIONSHIP EXECUTIVE")) return true;

    return false;
  };

  // -----------------------------
  // Text cleanup
  // -----------------------------
  let cleanText = String(text || "")
    .replace(/\r/g, "\n")
    .replace(/[•·]/g, " ")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .replace(/(\.\d{2})(\d)/g, "$1 $2");

  cleanText = normalizeWhitespace(cleanText).replace(/\s{2,}/g, " ");

  // -----------------------------
  // Metadata extraction
  // -----------------------------
  // Account number: prefer formatted cheque account number
  let account = "Unknown";
  const formattedAccountMatch =
    text.match(/Cheque\s+Account\s+Number[:\s]*([0-9]{2}[-\s]?[0-9]{4}[-\s]?[0-9]{4})/i) ||
    text.match(/Account\s+Number[:\s]*([0-9]{2}[-\s]?[0-9]{4}[-\s]?[0-9]{4})/i);

  if (formattedAccountMatch) {
    account = formattedAccountMatch[1].replace(/[-\s]/g, "");
  } else {
    const fallbackAccountMatch =
      text.match(/\b\d{10}\b/) ||
      text.match(/\b\d{2}[-\s]?\d{4}[-\s]?\d{4}\b/);
    if (fallbackAccountMatch) {
      account = fallbackAccountMatch[0].replace(/[-\s]/g, "");
    }
  }

  // Statement period
  let statementPeriod = "";
  const periodMatch = text.match(
    /\b(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})\s+to\s+(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})\b/i
  );
  if (periodMatch) {
    statementPeriod = `${periodMatch[1]} to ${periodMatch[2]}`;
  }

  // Client name / business name
  let clientName = "";
  const clientMatch =
    text.match(/Cheque account statement\s+([A-Z0-9&.,'()\-\/ ]+?)\s+\d{2}[-\s]?\d{4}[-\s]?\d{4}/i) ||
    text.match(/\b([A-Z][A-Z0-9&.,'()\-\/ ]{5,})\s+\d{2}[-\s]?\d{4}[-\s]?\d{4}\b/);
  if (clientMatch) {
    clientName = normalizeWhitespace(clientMatch[1]);
  }

  // Opening balance
  let openingBalance = 0;
  const openingMatch =
    text.match(/Bal(?:ance)?\s+Brought\s+Forward\s+([0-9\s.,-]+)/i) ||
    text.match(/Balance\s+Brought\s+Forward\s+([0-9\s.,-]+)/i);
  if (openingMatch) {
    openingBalance = parseNum(openingMatch[1]);
  }

  // -----------------------------
  // Transaction parsing
  // -----------------------------
  // Split only on valid-looking dd/mm/yyyy boundaries
  const chunks = cleanText.split(/(?=\b\d{1,2}\/\d{2}\/\d{4}\b)/);
  let runningBalance = openingBalance;

  for (const chunk of chunks) {
    const dateMatch = chunk.match(/^\b(\d{1,2})\/(\d{2})\/(\d{4})\b/);
    if (!dateMatch) continue;

    const dd = dateMatch[1].padStart(2, "0");
    const mm = dateMatch[2];
    const yyyy = dateMatch[3];

    if (!isValidDate(dd, mm, yyyy)) {
      continue;
    }

    const dateStr = `${dd}/${mm}/${yyyy}`;
    let rawContent = normalizeWhitespace(chunk.slice(dateMatch[0].length));
    rawContent = stripFooter(rawContent);

    if (!rawContent) continue;

    // Explicit brought-forward row
    if (/bal(?:ance)?\s+brought\s+forward/i.test(rawContent)) {
      transactions.push({
        date: dateStr,
        description: "Bal Brought Forward",
        amount: 0,
        balance: openingBalance,
        account,
        bankName: "ABSA"
      });
      runningBalance = openingBalance;
      continue;
    }

    // Pull numeric candidates
    const numMatches = rawContent.match(amountPattern) || [];
    if (numMatches.length === 0) continue;

    let finalAmount = null;
    let currentBalance = null;
    let matchedAmountStr = "";
    let matchedBalanceStr = "";

    // 1) Best method: use running-balance math
    for (let i = numMatches.length - 1; i >= 0; i--) {
      const balanceCandidate = parseNum(numMatches[i]);

      for (let j = i - 1; j >= 0; j--) {
        const amountCandidate = parseNum(numMatches[j]);
        if (Math.abs((runningBalance + amountCandidate) - balanceCandidate) < 0.05) {
          currentBalance = balanceCandidate;
          finalAmount = amountCandidate;
          matchedBalanceStr = numMatches[i];
          matchedAmountStr = numMatches[j];
          break;
        }
      }

      if (currentBalance !== null) break;
    }

    // 2) Fallback: assume rightmost number is balance
    if (currentBalance === null) {
      currentBalance = parseNum(numMatches[numMatches.length - 1]);
      matchedBalanceStr = numMatches[numMatches.length - 1];

      if (numMatches.length >= 2) {
        const candidate = parseNum(numMatches[numMatches.length - 2]);
        if (Math.abs((runningBalance + candidate) - currentBalance) < 0.05) {
          finalAmount = candidate;
          matchedAmountStr = numMatches[numMatches.length - 2];
        } else {
          finalAmount = currentBalance - runningBalance;
        }
      } else {
        finalAmount = currentBalance - runningBalance;
      }
    }

    if (currentBalance === null || finalAmount === null) continue;

    // Build description
    let description = rawContent;
    if (matchedBalanceStr) description = description.replace(matchedBalanceStr, " ");
    if (matchedAmountStr) description = description.replace(matchedAmountStr, " ");
    description = description.replace(amountPattern, " ");
    description = normalizeWhitespace(description);

    // Normalize common OCR-ish labels a little, but keep conservative
    description = description
      .replace(/\bBal(?:ance)? Brought Forward\b/i, "Bal Brought Forward")
      .replace(/\bProof Of Pmt\b/gi, "Proof Of Pmt")
      .replace(/\bImdte\b/gi, "Imdte")
      .replace(/\bNotific\b/gi, "Notific");

    description = titleCase(description);

    if (!description) {
      description = "Transaction";
    }

    // Hard reject obvious non-transaction rows
    if (isLikelyNonTransactionText(description)) {
      continue;
    }

    transactions.push({
      date: dateStr,
      description,
      amount: Number(finalAmount.toFixed(2)),
      balance: Number(currentBalance.toFixed(2)),
      account,
      bankName: "ABSA"
    });

    runningBalance = currentBalance;
  }

  // -----------------------------
  // Final cleanup
  // -----------------------------
  // Remove trailing garbage transactions if any slipped through
  const cleanedTransactions = transactions.filter((tx) => {
    if (!tx?.date || !tx?.description) return false;
    const [d, m, y] = tx.date.split("/");
    if (!isValidDate(d, m, y)) return false;
    if (isLikelyNonTransactionText(tx.description)) return false;
    return true;
  });

  // Closing balance should come from the final valid transaction
  let closingBalance = 0;
  if (cleanedTransactions.length > 0) {
    closingBalance = cleanedTransactions[cleanedTransactions.length - 1].balance;
  }

  return {
    metadata: {
      accountNumber: account,
      clientName,
      statementPeriod,
      openingBalance: Number(openingBalance.toFixed(2)),
      closingBalance: Number(closingBalance.toFixed(2)),
      bankName: "ABSA"
    },
    transactions: cleanedTransactions
  };
};