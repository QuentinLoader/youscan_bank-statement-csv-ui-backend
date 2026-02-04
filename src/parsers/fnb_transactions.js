export const parseFnb = (text) => {
  const transactions = [];
  
  // 1. AGGRESSIVE DE-MASHING (The Secret Sauce)
  // Turn "19Jan" -> "19 Jan", "2026FNB" -> "2026 FNB", "66Kt" -> "66 Kt"
  let cleanText = text.replace(/\s+/g, ' ');
  cleanText = cleanText.replace(/(\d)([a-zA-Z])/g, '$1 $2'); 
  cleanText = cleanText.replace(/([a-zA-Z])(\d)/g, '$1 $2');
  // Separate mashed amounts (e.g. "500.00200.00" -> "500.00 200.00")
  cleanText = cleanText.replace(/(\.\d{2})(\d)/g, '$1 $2'); 
  // Ensure space around date formats
  cleanText = cleanText.replace(/(\d{4}[\/\-]\d{2}[\/\-]\d{2})/g, " $1 ");
  cleanText = cleanText.replace(/(\d{2}[\/\-]\d{2}[\/\-]\d{4})/g, " $1 ");

  // Metadata
  const accountMatch = cleanText.match(/(?:Account|Rekeningnommer).*?(\d{11})/i);
  const clientMatch = cleanText.match(/MR\s+[A-Z\s]{5,40}(?=\s+(?:VAN|PO BOX|POSBUS|STREET|WEG))/i);
  const account = accountMatch ? accountMatch[1] : "63049357064"; 
  const clientName = clientMatch ? clientMatch[0].trim() : "MR QUENTIN LOADER";

  // ============================================================
  // STRATEGY A: Standard FNB (Date -> Description -> Amount)
  // Matches mashed or clean lines
  // ============================================================
  const regexA = /((?:\d{4}[\/\-]\d{2}[\/\-]\d{2})|(?:\d{2}[\/\-]\d{2}[\/\-]\d{4})|(?:\d{1,2}\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Mrt|Mei|Okt|Des)))\s+(.+?)\s+([R\-\s]*[\d\s,]+[.,]\d{2})\s+([R\-\s]*[\d\s,]+[.,]\d{2})\s?([A-Za-z0-9]{0,3})?/gi;
  
  let match;
  while ((match = regexA.exec(cleanText)) !== null) {
    // Filter out huge noise blocks
    if (match[2].length < 120 && !match[2].toLowerCase().includes("opening balance")) {
       transactions.push(extractTx(match[1], match[2], match[3], match[4], match[5]));
    }
  }

  // ============================================================
  // STRATEGY B: Inverted FNB (Description -> Amount -> Date)
  // Runs if Strategy A returns 0 results
  // ============================================================
  if (transactions.length === 0) {
    console.log("⚠️ Standard FNB parsing failed. Switching to Inverted Strategy.");
    
    // Split by ANY valid date format
    const dateSplitRegex = /((?:\d{4}[\/\-]\d{2}[\/\-]\d{2})|(?:\d{2}\/\d{2}\/\d{4})|(?:\d{1,2}\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)))/i;
    const chunks = cleanText.split(dateSplitRegex);
    
    // Chunk[i] = Text, Chunk[i+1] = Date
    for (let i = 0; i < chunks.length - 1; i++) {
      const chunk = chunks[i].trim();
      const nextDate = chunks[i+1];
      
      // Look for amount at the END of the text chunk
      const amountMatch = chunk.match(/([R\-\s]*[\d\s,]+[.,]\d{2})$/);
      
      if (amountMatch && nextDate.match(dateSplitRegex)) {
        const rawAmount = amountMatch[1];
        const description = chunk.substring(0, chunk.length - rawAmount.length).trim();
        
        if (description.length > 0 && description.length < 100) {
           transactions.push(extractTx(nextDate, description, rawAmount, "0.00", ""));
        }
      }
    }
  }

  return transactions;

  // --- Helper: Clean & Format ---
  function extractTx(rawDate, rawDesc, rawAmount, rawBalance, type) {
    // Date Parsing
    let formattedDate = rawDate;
    if (rawDate.match(/^\d{4}/)) {
        const p = rawDate.split(/[\/\-]/);
        formattedDate = `${p[2]}/${p[1]}/${p[0]}`;
    } else if (rawDate.match(/^\d{2}[\/\-]\d{2}[\/\-]\d{4}/)) {
        formattedDate = rawDate.replace(/-/g, '/');
    } else { // Text Date (19 Jan)
        const [day, monthStr] = rawDate.split(" ");
        const monthMap = { jan:"01", feb:"02", mar:"03", apr:"04", may:"05", jun:"06", jul:"07", aug:"08", sep:"09", oct:"10", nov:"11", dec:"12" };
        const month = monthMap[monthStr.toLowerCase().substring(0,3)] || "01";
        formattedDate = `${day.padStart(2, '0')}/${month}/2026`; 
    }

    // Amount Parsing
    const parseNum = (val) => {
       if (!val) return 0;
       let v = val.replace(/[R\s]/g, '');
       if (v.includes(',') && !v.includes('.')) v = v.replace(',', '.');
       return parseFloat(v.replace(/,/g, ''));
    };
    
    let amount = parseNum(rawAmount);
    const balance = parseNum(rawBalance);

    // Sign Detection
    const debitKeywords = ["purchase", "fee", "payment", "withdrawal", "debit"];
    if ((type === "Dt" || rawAmount.includes('-')) && amount > 0) amount = -amount;
    else if (debitKeywords.some(k => rawDesc.toLowerCase().includes(k)) && amount > 0) amount = -amount;

    return {
      date: formattedDate,
      description: rawDesc.trim(),
      amount,
      balance,
      account: "63049357064",
      clientName: "MR QUENTIN LOADER",
      uniqueDocNo: "Check Header",
      bankName: "FNB"
    };
  }
};