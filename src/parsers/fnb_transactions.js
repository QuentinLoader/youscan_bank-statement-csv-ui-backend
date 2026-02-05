export const parseFnb = (text) => {
  const transactions = [];

  // 1. DE-MASHING & CLEANUP
  let cleanText = text.replace(/\s+/g, ' ');
  // Split CamelCase
  cleanText = cleanText.replace(/([a-z])([A-Z])/g, '$1 $2');
  // Split Letters/Numbers
  cleanText = cleanText.replace(/(\d)([a-zA-Z])/g, '$1 $2');
  cleanText = cleanText.replace(/([a-zA-Z])(\d)/g, '$1 $2');
  // Split mashed amounts
  cleanText = cleanText.replace(/(\.\d{2})(\d)/g, '$1 $2');
  // Normalize date delimiters
  cleanText = cleanText.replace(/(\d{4})[\/\-](\d{2})[\/\-](\d{2})/g, " $1/$2/$3 ");
  cleanText = cleanText.replace(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/g, " $1/$2/$3 ");

  // Metadata
  const accountMatch = cleanText.match(/(?:Account|Rekeningnommer).*?(\d{11})/i);
  const clientMatch = cleanText.match(/THE DIRECTOR|MR\s+[A-Z\s]{5,40}/i);
  const account = accountMatch ? accountMatch[1] : "63049357064"; 
  const clientName = clientMatch ? clientMatch[0].trim() : "Client Name";

  // Year Logic
  let statementDate = new Date();
  const headerDateMatch = cleanText.match(/(\d{4})\/(\d{2})\/(\d{2})/);
  if (headerDateMatch) {
      statementDate = new Date(`${headerDateMatch[1]}-${headerDateMatch[2]}-${headerDateMatch[3]}`);
  }

  // 2. BLOCK SPLITTING STRATEGY
  const dateRegex = /((?:\d{4}\/\d{2}\/\d{2})|(?:\d{2}\/\d{2}\/\d{4})|(?:\d{1,2}\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Mrt|Mei|Okt|Des)))/gi;
  const parts = cleanText.split(dateRegex);

  // BUFFER: Holds text found at the end of the *previous* block
  let descriptionBuffer = "";

  // Loop through parts: [Text_Before_Date] -> [Date] -> [Text_After_Date]
  for (let i = 0; i < parts.length - 1; i++) {
    const potentialDate = parts[i].trim();
    
    if (potentialDate.match(dateRegex) && potentialDate.length < 20) {
        const dataBlock = parts[i+1].trim(); 
        
        // Header Guard
        const lowerBlock = dataBlock.toLowerCase();
        if (lowerBlock.includes("opening balance") || 
            lowerBlock.includes("brought forward") || 
            lowerBlock.includes("current account") ||
            lowerBlock.includes("statement period")) { 
            i++; descriptionBuffer = ""; continue;
        }

        // 3. NUMBER EXTRACTION
        // Matches numbers like "150.00Cr", "7.00", "100.00"
        const moneyRegex = /([R\-\s]*[\d\s]+[.,]\d{2}(?:Cr|Dr|Dt)?)(?!\d)/gi;
        const allNumbers = dataBlock.match(moneyRegex);

        if (allNumbers && allNumbers.length >= 2) {
            const cleanNum = (val) => {
                let v = val.replace(/[R\s]/g, '');
                // Remove Cr/Dr for parsing to float
                return parseFloat(v.replace(/,/g, '').replace(/(Cr|Dr|Dt)/yi, ''));
            };

            const rawAmount = allNumbers[allNumbers.length - 2];
            const rawBalance = allNumbers[allNumbers.length - 1];
            
            let amount = cleanNum(rawAmount);
            const balance = cleanNum(rawBalance);

            // 4. DESCRIPTION RECONSTRUCTION
            // Text inside current block (Before Amount)
            const textBeforeAmount = dataBlock.split(rawAmount)[0].trim();
            
            // Text inside previous block (From Buffer)
            // If the buffer is long, it's likely our description.
            let description = (descriptionBuffer + " " + textBeforeAmount).trim();

            // CLEANUP: Orphan Scrubber
            description = description.replace(/^[\d\s\.,]+/, '').trim(); // Remove leading digits
            description = description.replace(/^(Kt|Dt|Dr|Cr)\s+/, '').trim(); // Remove leading codes
            description = description.replace(/^#/, '').trim(); // Remove hashtags

            // 5. DEBIT / CREDIT LOGIC (Business Standard)
            const upperAmount = rawAmount.toUpperCase();
            
            // Rule 1: Explicit Indicator
            if (upperAmount.includes("CR") || upperAmount.includes("KT")) {
                amount = Math.abs(amount); // Income
            } else if (upperAmount.includes("DR") || upperAmount.includes("DT")) {
                amount = -Math.abs(amount); // Expense
            } 
            // Rule 2: Explicit Negative Sign
            else if (rawAmount.includes("-")) {
                amount = -Math.abs(amount);
            }
            // Rule 3: No Indicator (Business Default)
            else {
                // In FNB Business, no indicator on 'Transaction' column usually means DEBIT (Fee/Payment)
                // We check for 'Deposit' keywords just in case
                const incomeKeywords = ["transfer from", "deposit", "credit"];
                if (incomeKeywords.some(k => description.toLowerCase().includes(k))) {
                    amount = Math.abs(amount);
                } else {
                    amount = -Math.abs(amount); // Default to Expense
                }
            }

            // 6. DATE FORMATTING
            let formattedDate = potentialDate;
            if (potentialDate.match(/[a-zA-Z]/)) { 
                const [day, monthStr] = potentialDate.split(" ");
                const monthMap = { jan:"01", feb:"02", mar:"03", apr:"04", may:"05", jun:"06", jul:"07", aug:"08", sep:"09", oct:"10", nov:"11", dec:"12" };
                const monthStr3 = monthStr.toLowerCase().substring(0,3);
                const month = monthMap[monthStr3] || "01";
                
                const stmtYear = statementDate.getFullYear();
                const stmtMonth = statementDate.getMonth() + 1;
                const transMonthInt = parseInt(month);
                let year = stmtYear;
                if (transMonthInt > stmtMonth + 1) year = stmtYear - 1;
                
                formattedDate = `${day.padStart(2, '0')}/${month}/${year}`;
            } else if (potentialDate.match(/^\d{4}/)) { 
                const p = potentialDate.split('/');
                formattedDate = `${p[2]}/${p[1]}/${p[0]}`;
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

            // 7. FILL BUFFER FOR NEXT LOOP
            // Capture text appearing AFTER the balance in this block.
            // This is likely the description for the NEXT transaction.
            const textAfterBalance = dataBlock.split(rawBalance)[1] || "";
            descriptionBuffer = textAfterBalance.trim();

        } else {
            // No numbers found? This block might be purely a description for the next date.
            // Add entire block to buffer.
            descriptionBuffer = (descriptionBuffer + " " + dataBlock).trim();
        }
        i++; 
    }
  }

  return transactions;
};