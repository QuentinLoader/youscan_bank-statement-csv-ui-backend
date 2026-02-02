// AFTER collecting section lines

const merged = [];
let buffer = "";

for (const line of section) {
  // Skip repeated headers
  if (/^Date\s+Description/i.test(line)) continue;

  // If line starts with date → new row
  if (/^\d{1,2}[\/\s]/.test(line)) {
    if (buffer) merged.push(buffer.trim());
    buffer = line;
  } else {
    // continuation line (description wrap)
    buffer += " " + line;
  }
}

if (buffer) merged.push(buffer.trim());

if (!merged.length) {
  throw new ParseError("TRANSACTION_SECTION_EMPTY", "No usable transaction rows");
}

return merged;
