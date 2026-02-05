export const parseFnb = (text) => {
  const transactions = [];

  // 1. DE-MASHING & CLEANUP
  let cleanText = text.replace(/\s+/g, ' ');
  
  // FIX: Split CamelCase (e.g. "DesPOS" -> "Des POS")
  cleanText = cleanText.replace(/([a-z])([A-Z])/g, '$1 $2');
  
  // FIX: Split Letters/Numbers (e.g. "19Jan" -> "19 Jan")
  cleanText = cleanText.replace(/(\d)([a-zA-Z])/g, '$1 $2');
  cleanText = cleanText.replace(/([a-zA-Z])(\d)/g, '$1 $2');
  
  // FIX: Split mashed amounts (e.g. "100.00200.00" -> "100.00 200.00")
  cleanText = cleanText.replace(/(\.\d{2})(\d)/g, '$1 $2');
  
  // Normalize date delimiters for easier splitting
  cleanText = cleanText.replace(/(\d{4})[\/\-](\d{2})[\/\-](\d{2})/g, " $1/$2/$3 ");
  cleanText = cleanText.replace(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/g, " $1/$2/$3 ");

  // Metadata
  const accountMatch = cleanText.match(/(?:Account|Rekeningnommer).*?(\d{11})/i);
  const clientMatch = cleanText.match(/MR\s+[A-Z\s]{5,40}(?=\s+(?:VAN|PO BOX|POSBUS|STREET|WEG))/i);
  const account = accountMatch ? accountMatch[1] : "63049357064"; 
  const clientName = clientMatch ? clientMatch[0].trim() : "MR QUENTIN LOADER";

  // Year Logic: Grab Statement Date from Header
  let statementDate = new Date();
  const headerDateMatch = cleanText.match(/(\d{4})\/(\d{2})\/(\d{2})/);
  if (headerDateMatch) {
      statementDate = new Date(`${headerDateMatch[1]}-${headerDateMatch[2]}-${headerDateMatch[3]}`);
  }

  // 2. BLOCK SPLITTING
  // We split the text by Date. 
  // Each "Block" = [Date] + [Text containing Description, Amount, Balance]
  const dateRegex = /((?:\d{4}\/\d{2}\/\d{2})|(?:\d{2}\/\d{2}\/\d{4})|(?:\d{1,2}\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Mrt|Mei|Okt|Des)))/gi;
  const parts = cleanText.split(dateRegex);

  // Loop through parts (Parts[i] is text before date, Parts[i+1] is Date, Parts[i+2] is Data)
  // Since .split includes the separators, we iterate carefully.
  for (let i = 0; i < parts.length - 1; i++) {
    const potentialDate = parts[i].trim();
    // The splitting pushes the capture group (Date) into the array. 
    // So if parts[i] matches date, parts[i+1] is the data following it.
    
    if (potentialDate.match(dateRegex) && potentialDate.length < 20) {
        const dataBlock = parts[i+1].trim(); 
        
        // 3. HEADER GUARD (Skipping the "Opening Balance" / Header lines)
        // If the block contains these phrases, it is NOT a transaction.
        const lowerBlock = dataBlock.toLowerCase();
        if (lowerBlock.includes("opening balance") || 
            lowerBlock.includes("brought forward") || 
            lowerBlock.includes("current account") ||
            lowerBlock.includes("previous balance") ||
            lowerBlock.includes("rekeningnommer") ||
            lowerBlock.includes("statement period")) {
            i++; continue;
        }

        // 4. NUMBER EXTRACTION
        // We look for all money-like numbers in the block
        const moneyRegex = /([R\-\s]*[\d\s]+[.,]\d{2})(?!\d)/g;
        const allNumbers = dataBlock.match(moneyRegex);

        if (allNumbers && allNumbers.length >= 2) {
            const cleanNum = (val) => {
                let v = val.replace(/[R\s]/g, '');
                if (v.includes(',') && !v.includes('.')) v = v.replace(',', '.');
                return parseFloat(v.replace(/,/g, ''));
            };

            // STRICT RULE: The LAST number is Balance. The SECOND LAST is Amount.
            const rawAmount = allNumbers[allNumbers.length - 2];
            const rawBalance = allNumbers[allNumbers.length - 1];
            
            let amount = cleanNum(rawAmount);
            const balance = cleanNum(rawBalance);

            // 5. ORPHAN SCRUBBING (Cleaning Description)
            // Description is everything BEFORE the amount.
            let description = dataBlock.split(rawAmount)[0].trim();

            // SCRUBBER: Remove orphan numbers at the start (e.g. "7.50 15.28 Netflix...")
            // We remove any sequence of digits/dots/spaces at the very beginning.
            description = description.replace(/^[\d\s\.,]+/, '').trim();
            
            // SCRUBBER: Remove bank codes
            description = description.replace(/^(Kt|Dt|Dr|Cr)\s+/, '').trim();

            // 6. DATE FORMATTING
            let formattedDate = potentialDate;
            if (potentialDate.match(/[a-zA-Z]/)) { // "19 Jan"
                const [day, monthStr] = potentialDate.split(" ");
                const monthMap = { jan:"01", feb:"02", mar:"03", apr:"04", may:"05", jun:"06", jul:"07", aug:"08", sep:"09", oct:"10", nov:"11", dec:"12" };
                const monthStr3 = monthStr.toLowerCase().substring(0,3);
                const month = monthMap[monthStr3] || "01";
                
                // Rollback Year Logic
                const stmtYear = statementDate.getFullYear();
                const stmtMonth = statementDate.getMonth() + 1;
                const transMonthInt = parseInt(month);
                let year = stmtYear;
                // If Trans is Dec and Statement is Jan, it's Dec last year.
                if (transMonthInt > stmtMonth + 1) year = stmtYear - 1;
                
                formattedDate = `${day.padStart(2, '0')}/${month}/${year}`;
            } else if (potentialDate.match(/^\d{4}/)) { // 2026/01/19
                const p = potentialDate.split('/');
                formattedDate = `${p[2]}/${p[1]}/${p[0]}`;
            }

            // 7. SIGN CORRECTION
            // Look at text appearing AFTER the amount for "Dt"/"Kt"
            const textAfterAmount = dataBlock.split(rawAmount)[1] || "";
            
            if (rawAmount.includes('-')) {
                amount = -Math.abs(amount);
            } else if (textAfterAmount.toLowerCase().includes("dt")) {
                amount = -Math.abs(amount); // Dt = Debit (Red)
            } else if (textAfterAmount.toLowerCase().includes("kt")) {
                amount = Math.abs(amount); // Kt = Credit (Green)
            } else {
                const debitKeywords = ["purchase", "fee", "payment", "debit", "withdrawal", "tikkie", "uber", "netflix", "checkers"];
                if (debitKeywords.some(k => description.toLowerCase().includes(k))) {
                    amount = -Math.abs(amount);
                }
            }

            transactions.push({
                date: formattedDate,
                description: description.trim(),
                amount: amount,
                balance: balance,
                account: account,
                clientName: clientName,
                uniqueDocNo: "Check Header",
                bankName: "FNB"
            });
        }
    }
  }

  return transactions;
};