import { ParseError } from "../errors/ParseError.js";

const MONTHS = {
  Jan: "01", Januarie: "01",
  Feb: "02", Februarie: "02",
  Mar: "03", Maart: "03",
  Apr: "04", April: "04",
  May: "05", Mei: "05",
  Jun: "06", Junie: "06",
  Jul: "07", Julie: "07",
  Aug: "08", Augustus: "08",
  Sep: "09", September: "09",
  Oct: "10", Oktober: "10",
  Nov: "11", November: "11",
  Dec: "12", Des: "12", Desember: "12"
};

export function parseDate(raw, statementPeriod) {
  raw = raw.trim();

  // 01/12/2025
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
    const [dd, mm, yyyy] = raw.split("/");
    return `${yyyy}-${mm}-${dd}`;
  }

  // 1 Dec 2025 OR 1 Des 2025
  const fullMatch = raw.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (fullMatch) {
    const [, d, m, y] = fullMatch;
    if (!MONTHS[m]) throw new ParseError("INVALID_MONTH", raw);
    return `${y}-${MONTHS[m]}-${d.padStart(2, "0")}`;
  }

  // 01 Dec (year inferred from statement period)
  const shortMatch = raw.match(/^(\d{1,2})\s+([A-Za-z]+)$/);
  if (shortMatch) {
    const [, d, m] = shortMatch;
    if (!MONTHS[m]) throw new ParseError("INVALID_MONTH", raw);

    const year = statementPeriod.from.slice(0, 4);
    return `${year}-${MONTHS[m]}-${d.padStart(2, "0")}`;
  }

  throw new ParseError("UNSUPPORTED_DATE_FORMAT", raw);
}
