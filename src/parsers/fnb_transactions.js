export const parseFnb = (text) => {
  const transactions = [];

  // 1. ADVANCED DE-MASHING
  let cleanText = text.replace(/\s+/g, ' ');
  // Split mashed amounts (e.g., "7.0010.98Cr" -> "7.00 10.98Cr")
  cleanText = cleanText.replace(/(\.\d{2})(\d)/g, '$1 $2');
  // Ensure space around indicators
  cleanText = cleanText.replace(/(Cr|Dr|Dt|Kt)(\d)/gi, '$1 $2');
  cleanText = cleanText.replace(/(\d)(Cr|Dr|Dt|Kt)/gi, '$1 $2');
  // Normalize dates
  cleanText = cleanText.replace(/(\d{4})[\/\-](\d{2})[\/\-](\d{2})/g, " $1/$2/$3 ");
  cleanText = cleanText.replace(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/g, " $1/$2/$3 ");

  // Metadata Extraction
  const accountMatch = cleanText.match(/(?:Account Number|Account|Rekeningnommer|Gold Business Account).*?(\d{11})/i);
  const account = accountMatch ? accountMatch[1] : "62854836693"; 
  const clientMatch = cleanText.match(/(?:THE DIRECTOR|MR\s+[A-Z\s]{5,40})/i);
  const clientName = clientMatch ? clientMatch[0].trim() : "Client Name";

  let statementYear = 2026;
  const headerDateMatch = cleanText.match(/(\d{4})\/\d{2}\/\d{2}/);
  if (headerDateMatch) statementYear = parseInt(headerDateMatch[1]);

  // 2. BLOCK SPLITTING
  const dateRegex = /((?:\d{4}\/\d{2}\/\d{2})|(?:\d{2}\/\d{2}\/\d{4})|(?:\d{1,2}\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Mrt|Mei|Okt|Des)))/gi;
  const parts = cleanText.split(dateRegex);

  let floatingDescription = "";

  for (let i = 0; i < parts.length - 1; i++) {
    const potentialDate = parts[i].trim();
    
    if (potentialDate.match(dateRegex) && potentialDate.length < 20) {
        const dataBlock = parts[i+1].trim(); 
        
        // Header Guard
        const lowerBlock = dataBlock.toLowerCase();
        if (lowerBlock.includes("opening balance") || lowerBlock.includes("brought forward") || lowerBlock.includes("service fees")) {
            i++; floatingDescription = ""; continue;
        }

        // 3. PRECISION NUMBER EXTRACTION
        // We match numbers including their Cr/Dr suffixes
        const moneyRegex = /([\d\s,]+[.,]\d{2}\s?(?:Cr|Dr|Dt|Kt)?)(?!\d)/gi;
        const allNumbers = dataBlock.match(moneyRegex) || [];

        if (allNumbers.length >= 2) {
            const cleanNum = (val) => {
                let v = val.replace(/[R\s]/gi, '').replace(/(Cr|Dr|Dt|Kt)/gi, '');
                return parseFloat(v.replace(/,/g, ''));
            };

            // INVERSE MAPPING: 
            // The Balance is ALWAYS the final number in the row.
            // The Amount is ALWAYS the second-to-last number.
            const rawBalance = allNumbers[allNumbers.length - 1];
            const rawAmount = allNumbers[allNumbers.length - 2];
            
            let amount = cleanNum(rawAmount);
            const balance = cleanNum(rawBalance);

            // 4. DESCRIPTION STITCHING
            // Split by the Amount to get the local description
            let localDesc = dataBlock.split(rawAmount)[0].trim();
            
            // Stitch the floating description from the previous line with the local one
            let fullDescription = (floatingDescription + " " + localDesc).trim();

            // SCRUBBING: Remove indicators and ghost numbers that leaked into text
            fullDescription = fullDescription.replace(/^(Cr|Dr|Dt|Kt)\s+/gi, '');
            fullDescription = fullDescription.replace(/^[\d\s\.,]+/, ''); 
            fullDescription = fullDescription.replace(/#/, '').trim();

            // 5. SIGN LOGIC
            // If the Amount string contains 'Cr' or 'Kt', it is POSITIVE (Income)
            const amountStr = rawAmount.toUpperCase();
            if (amountStr.includes("CR") || amountStr.includes("KT")) {
                amount = Math.abs(amount);
            } else {
                // Otherwise, FNB Business defaults to DEBIT for charges/payments
                amount = -Math.abs(amount);
            }

            // 6. DATE FORMATTING
            let formattedDate = potentialDate;
            if (potentialDate.match(/[a-zA-Z]/)) {
                const [day, monthStr] = potentialDate.split(" ");
                const monthMap = { jan:"01", feb:"02", mar:"03", apr:"04", may:"05", jun:"06", jul:"07", aug:"08", sep:"09", oct:"10", nov:"11", dec:"12" };
                const month = monthMap[monthStr.toLowerCase().substring(0,3)] || "01";
                formattedDate = `${day.padStart(2, '0')}/${month}/${statementYear}`;
            } else if (potentialDate.match(/^\d{4}/)) {
                const p = potentialDate.split('/');
                formattedDate = `${p[2]}/${p[1]}/${p[0]}`;
            }

            transactions.push({
                date: formattedDate,
                description: fullDescription || "Transaction",
                amount,
                balance,
                account,
                clientName,
                uniqueDocNo: "Check Header",
                bankName: "FNB"
            });

            // 7. BUFFER MANAGEMENT
            // Take any text sitting AFTER the balance and save it for the next date
            floatingDescription = dataBlock.split(rawBalance)[1]?.trim() || "";

        } else {
            // No numbers in block? Store whole block as description for next date
            floatingDescription = (floatingDescription + " " + dataBlock).trim();
        }
        i++; 
    }
  }

  return transactions;
};