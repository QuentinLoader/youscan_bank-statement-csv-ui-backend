import { normalizeWhitespace } from "./text.js";

export function normalizeDateToken(value) {
  const text = normalizeWhitespace(value || "");

  let match = text.match(/\bROL(\d{2})(\d{2})(\d{2})\b/i);
  if (match) {
    const dd = match[1];
    const mm = match[2];
    const yy = Number(match[3]);
    const yyyy = yy <= 49 ? 2000 + yy : 1900 + yy;
    return `${dd}/${mm}/${yyyy}`;
  }

  match = text.match(/\b(\d{2})(\d{2})(\d{2})\b/);
  if (match) {
    const dd = match[1];
    const mm = match[2];
    const yy = Number(match[3]);
    const yyyy = yy <= 49 ? 2000 + yy : 1900 + yy;
    return `${dd}/${mm}/${yyyy}`;
  }

  match = text.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})\b/);
  if (match) {
    const dd = String(match[1]).padStart(2, "0");
    const mm = String(match[2]).padStart(2, "0");
    let yyyy = String(match[3]);

    if (yyyy.length === 2) {
      const yy = Number(yyyy);
      yyyy = String(yy <= 49 ? 2000 + yy : 1900 + yy);
    }

    return `${dd}/${mm}/${yyyy}`;
  }

  return null;
}

export function parseStatementPeriodDate(value) {
  const text = normalizeWhitespace(value || "");
  if (!text) return null;

  let match = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (match) {
    return {
      dd: Number(match[1]),
      mm: Number(match[2]),
      yyyy: Number(match[3]),
    };
  }

  match = text.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (match) {
    const months = {
      jan: 1, january: 1,
      feb: 2, february: 2,
      mar: 3, march: 3,
      apr: 4, april: 4,
      may: 5,
      jun: 6, june: 6,
      jul: 7, july: 7,
      aug: 8, august: 8,
      sep: 9, sept: 9, september: 9,
      oct: 10, october: 10,
      nov: 11, november: 11,
      dec: 12, december: 12,
    };

    const mm = months[String(match[2]).toLowerCase()];
    if (!mm) return null;

    return {
      dd: Number(match[1]),
      mm,
      yyyy: Number(match[3]),
    };
  }

  return null;
}

export function isValidCalendarDateParts(dd, mm, yyyy) {
  if (
    !Number.isInteger(dd) ||
    !Number.isInteger(mm) ||
    !Number.isInteger(yyyy) ||
    dd < 1 || dd > 31 ||
    mm < 1 || mm > 12 ||
    yyyy < 2000 || yyyy > 2100
  ) {
    return false;
  }

  const date = new Date(Date.UTC(yyyy, mm - 1, dd));
  return (
    date.getUTCFullYear() === yyyy &&
    date.getUTCMonth() === mm - 1 &&
    date.getUTCDate() === dd
  );
}

export function formatDateParts(dd, mm, yyyy) {
  return `${String(dd).padStart(2, "0")}/${String(mm).padStart(2, "0")}/${yyyy}`;
}

export function datePartsToUtcMs(parts) {
  if (!parts) return null;
  return Date.UTC(parts.yyyy, parts.mm - 1, parts.dd);
}

export function buildStandardBankDateCandidates(token) {
  if (!/^\d{6}$/.test(String(token || ""))) return [];

  const text = String(token);
  const candidates = [];

  const yy1 = Number(text.slice(0, 2));
  const mm1 = Number(text.slice(2, 4));
  const dd1 = Number(text.slice(4, 6));
  const yyyy1 = 2000 + yy1;

  if (isValidCalendarDateParts(dd1, mm1, yyyy1)) {
    candidates.push({ dd: dd1, mm: mm1, yyyy: yyyy1, strategy: "yymmdd" });
  }

  const dd2 = Number(text.slice(0, 2));
  const mm2 = Number(text.slice(2, 4));
  const yy2 = Number(text.slice(4, 6));
  const yyyy2 = 2000 + yy2;

  if (isValidCalendarDateParts(dd2, mm2, yyyy2)) {
    candidates.push({ dd: dd2, mm: mm2, yyyy: yyyy2, strategy: "ddmmyy" });
  }

  return candidates;
}

export function chooseBestStandardBankDateCandidate(candidates, statementPeriod = null) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const periodStart = parseStatementPeriodDate(statementPeriod?.start);
  const periodEnd = parseStatementPeriodDate(statementPeriod?.end);

  const startMs = datePartsToUtcMs(periodStart);
  const endMs = datePartsToUtcMs(periodEnd);

  const scored = candidates.map((candidate) => {
    const candidateMs = datePartsToUtcMs(candidate);
    let score = 0;

    if (startMs !== null && endMs !== null && candidateMs !== null) {
      if (candidateMs >= startMs && candidateMs <= endMs) {
        score += 1000;
      } else {
        const distanceToStart = Math.abs(candidateMs - startMs);
        const distanceToEnd = Math.abs(candidateMs - endMs);
        const nearestDistance = Math.min(distanceToStart, distanceToEnd);
        score -= nearestDistance / 86400000;
      }
    }

    if (candidate.strategy === "yymmdd") {
      score += 10;
    }

    return { ...candidate, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best) return null;

  return formatDateParts(best.dd, best.mm, best.yyyy);
}

export function extractStandardBankDate(value, statementPeriod = null) {
  const text = normalizeWhitespace(value || "");
  if (!text) return null;

  const tokens = [];

  let match = text.match(/ROL(\d{6})/i);
  if (match) tokens.push(match[1]);

  match = text.match(/(\d{6})$/);
  if (match) tokens.push(match[1]);

  const allMatches = [...text.matchAll(/\b(\d{6})\b/g)];
  for (const item of allMatches) {
    tokens.push(item[1]);
  }

  const uniqueTokens = [...new Set(tokens)];
  if (uniqueTokens.length === 0) return null;

  const candidates = uniqueTokens.flatMap((token) =>
    buildStandardBankDateCandidates(token)
  );

  return chooseBestStandardBankDateCandidate(candidates, statementPeriod);
}
