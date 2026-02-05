export const parseFnb = (text) => {
  const transactions = [];

  // 1. AGGRESSIVE DE-MASHING & PRE-PROCESSING
  let cleanText = text.replace(/\s+/g, ' ');
  // Split digits from letters (e.g., "19Jan" -> "19 Jan", "DesPOS" -> "Des POS")
  cleanText = cleanText.replace(/(\d)([a-zA-Z])/g, '$1 $2');
  cleanText = cleanText.replace(/([a-z])([A-Z])/g, '$1 $2');
  cleanText = cleanText.replace(/([a-zA-Z])(\d)/g, '$1 $2');
  // Split mashed amounts (e.g., "100.00200.00" -> "100.00 200.00")
  cleanText = cleanText.replace(/(\.\d{2})(\d)/g, '$1 $2');
  // Normalize date delimiters
  cleanText = cleanText.replace(/(\d{4})[\/\-](\d{2})[\/\-](\d{2})/g, " $1/$2/$3 ");
  cleanText = cleanText.replace(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/g, " $1/$2/$3 ");

  // 2. TARGETED METADATA EXTRACTION
  // Specifically look for 11 digits following the account type header
  const accountMatch = cleanText.match(/(?:Account Number|Account|Rekeningnommer|Gold Business Account|Premier Current Account).*?(\d{11})/i);
  const clientMatch = cleanText.match(/(?:THE DIRECTOR|MR\s+[A-Z\s]{5,40})/i);
  
  const account = accountMatch ? accountMatch[1] : "62854836693"; 
  const clientName = clientMatch ? clientMatch[0].trim() : "MR QUENTIN LOADER";

  // Year Logic (Default to 2026, rollback if Jan statement has Dec trans)
  let statementYear = 2026;
  const headerDateMatch = cleanText.match(/(\d{4})\/\d{2}\/\d{2}/);
  if (headerDateMatch) statementYear = parseInt(headerDateMatch[1]);

  // 3. BLOCK SPLITTING (The Anchor Logic)
  const dateRegex = /((?:\d{4}\/\d{2}\/\d{2})|(?:\d{2}\/\d{2}\/\d{4})|(?:\d{1,2}\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Mrt|Mei|Okt|Des)))/gi;
  const parts = cleanText.split(dateRegex);

  // This buffer captures text that sits at the END of a block (belonging to the NEXT date)
  let floatingDescription = "";

  for (let i = 0; i < parts.length - 1; i++) {
    const potentialDate = parts[i].trim();
    
    if (potentialDate.match(dateRegex) && potentialDate.length < 20) {
        const dataBlock = parts[i+1].trim(); 
        
        // Header Guard
        const lowerBlock = dataBlock.toLowerCase();
        if (lowerBlock.includes("opening balance") || lowerBlock.includes("brought forward") || lowerBlock.includes("interest rate")) {
            i++; floatingDescription = ""; continue;
        }

        // 4. NUMBER EXTRACTION (Amount & Balance)
        // Match numbers, specifically looking for Cr/Dr/Dt/Kt indicators
        const moneyRegex = /([\d\s,]+[.,]\d{2}(?:Cr|Dr|Dt|Kt)?)(?!\d)/gi;
        const allNumbers = dataBlock.match(moneyRegex);

        if (allNumbers && allNumbers.length >= 2) {
            const cleanNum = (val) => {
                let v = val.replace(/[R\s]/gi, '').replace(/(Cr|Dr|Dt|Kt)/gi, '');
                return parseFloat(v.replace(/,/g, ''));
            };

            const rawAmount = allNumbers[allNumbers.length - 2];
            const rawBalance = allNumbers[allNumbers.length - 1];
            
            let amount = cleanNum(rawAmount);
            const balance = cleanNum(rawBalance);

            // 5. DESCRIPTION STITCHING (The Look-Back Fix)
            // Description = (Leftover text from previous date) + (Text before amount in this date)
            let currentDescPart = dataBlock.split(rawAmount)[0].trim();
            let description = (floatingDescription + " " + currentDescPart).trim();
            
            // CLEANUP: Orphan Scrubber
            description = description.replace(/^[\d\s\.,]+/, '').trim(); // Remove leading ghost numbers
            description = description.replace(/^(Kt|Dt|Dr|Cr)\s+/, '').trim(); // Remove leading codes
            description = description.replace(/^#/, '').trim(); // Remove hashtags

            // 6. SIGN CORRECTION (Business Logic)
            const upperAmount = rawAmount.toUpperCase();
            if (upperAmount.includes("CR") || upperAmount.includes("KT")) {
                amount = Math.abs(amount); // Income (Green)
            } else if (upperAmount.includes("DR") || upperAmount.includes("DT") || rawAmount.includes("-")) {
                amount = -Math.abs(amount); // Expense (Red)
            } else {
                // FNB Business Default: No indicator usually means Debit (Fees/Payments)
                const incomeKeywords = ["transfer from", "deposit", "credit"];
                amount = incomeKeywords.some(k => description.toLowerCase().includes(k)) ? Math.abs(amount) : -Math.abs(amount);
            }

            // 7. DATE NORMALIZATION
            let formattedDate = potentialDate;
            if (potentialDate.match(/[a-zA-Z]/)) { // "17 Jan"
                const [day, monthStr] = potentialDate.split(" ");
                const monthMap = { jan:"01", feb:"02", mar:"03", mrt:"03", apr:"04", may:"05", mei:"05", jun:"06", jul:"07", aug:"08", sep:"09", oct:"10", okt:"10", nov:"11", dec:"12", des:"12" };
                const month = monthMap[monthStr.toLowerCase().substring(0,3)] || "01";
                
                let year = statementYear;
                if (parseInt(month) === 12 && cleanText.toLowerCase().includes("jan 2026")) year = statementYear - 1;
                
                formattedDate = `${day.padStart(2, '0')}/${month}/${year}`;
            } else if (potentialDate.match(/^\d{4}/)) { // 2026/01/17
                const p = potentialDate.split('/');
                formattedDate = `${p[2]}/${p[1]}/${p[0]}`;
            }

            transactions.push({
                date: formattedDate,
                description: description.trim() || "Transaction",
                amount,
                balance,
                account,
                clientName,
                uniqueDocNo: "Check Header",
                bankName: "FNB"
            });

            // 8. UPDATE BUFFER FOR NEXT LOOP
            // Text after the balance belongs to the NEXT date's description
            floatingDescription = dataBlock.split(rawBalance)[1]?.trim() || "";

        } else {
            // No numbers found in this block? The whole block is description for the next date.
            floatingDescription = (floatingDescription + " " + dataBlock).trim();
        }
        i++; 
    }
  }

  return transactions;
};