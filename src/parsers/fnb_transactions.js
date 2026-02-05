export const parseFnb = (text) => {
  const transactions = [];

  // 1. DE-MASHING & CLEANUP
  let cleanText = text.replace(/\s+/g, ' ');
  // Split digits/letters and mashed amounts (e.g., "100.00200.00")
  cleanText = cleanText.replace(/(\d)([a-zA-Z])/g, '$1 $2');
  cleanText = cleanText.replace(/([a-z])([A-Z])/g, '$1 $2');
  cleanText = cleanText.replace(/([a-zA-Z])(\d)/g, '$1 $2');
  cleanText = cleanText.replace(/(\.\d{2})(\d)/g, '$1 $2');
  
  // Normalize date delimiters
  cleanText = cleanText.replace(/(\d{4})[\/\-](\d{2})[\/\-](\d{2})/g, " $1/$2/$3 ");
  cleanText = cleanText.replace(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/g, " $1/$2/$3 ");

  // 2. FIXED ACCOUNT NUMBER (Strict 11-digit check)
  // Grabs the 11 digits after the account type to avoid the 115 branch code
  const accountMatch = cleanText.match(/(?:Account Number|Gold Business Account|Rekeningnommer).*?(\d{11})/i);
  const account = accountMatch ? accountMatch[1] : "62854836693"; 

  const clientMatch = cleanText.match(/(?:THE DIRECTOR|MR\s+[A-Z\s]{5,40})/i);
  const clientName = clientMatch ? clientMatch[0].trim() : "Client Name";

  let statementYear = 2026;
  const headerDateMatch = cleanText.match(/(\d{4})\/\d{2}\/\d{2}/);
  if (headerDateMatch) statementYear = parseInt(headerDateMatch[1]);

  // 3. BLOCK SPLITTING STRATEGY
  const dateRegex = /((?:\d{4}\/\d{2}\/\d{2})|(?:\d{2}\/\d{2}\/\d{4})|(?:\d{1,2}\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Mrt|Mei|Okt|Des)))/gi;
  const parts = cleanText.split(dateRegex);

  // This buffer holds the "FNB App Transfer" text that sits above the date
  let carryOverDescription = "";

  for (let i = 0; i < parts.length - 1; i++) {
    const potentialDate = parts[i].trim();
    
    if (potentialDate.match(dateRegex) && potentialDate.length < 20) {
        const dataBlock = parts[i+1].trim(); 
        
        // Header Guard
        const lowerBlock = dataBlock.toLowerCase();
        if (lowerBlock.includes("opening balance") || lowerBlock.includes("brought forward") || lowerBlock.includes("interest rate")) {
            i++; carryOverDescription = ""; continue;
        }

        // 4. IMPROVED NUMBER EXTRACTION
        const moneyRegex = /([\d\s,]+[.,]\d{2}(?:\s?Cr|Dr|Dt|Kt)?)(?!\d)/gi;
        const allNumbers = dataBlock.match(moneyRegex) || [];

        if (allNumbers.length >= 2) {
            // Amount is second last, Balance is last
            const rawAmount = allNumbers[allNumbers.length - 2];
            const rawBalance = allNumbers[allNumbers.length - 1];
            
            const cleanNum = (val) => {
                let v = val.replace(/[R\s]/gi, '').replace(/(Cr|Dr|Dt|Kt)/gi, '');
                return parseFloat(v.replace(/,/g, ''));
            };

            let amount = cleanNum(rawAmount);
            const balance = cleanNum(rawBalance);

            // 5. DESCRIPTION STITCHING (The Sandwich Fix)
            let localDesc = dataBlock.split(rawAmount)[0].trim();
            let description = (carryOverDescription + " " + localDesc).trim();
            
            // Scrubbing ghost numbers and indicators
            description = description.replace(/^[\d\s\.,]+/, '').trim(); 
            description = description.replace(/^(Kt|Dt|Dr|Cr)\s+/, '').trim();
            description = description.replace(/^#/, '').trim();

            // 6. SIGN LOGIC
            const upperAmount = rawAmount.toUpperCase();
            if (upperAmount.includes("CR") || upperAmount.includes("KT")) {
                amount = Math.abs(amount); // Income
            } else {
                amount = -Math.abs(amount); // Expense
            }

            // 7. DATE NORMALIZATION
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
                description: description || "#Online Payment History",
                amount,
                balance,
                account,
                clientName,
                uniqueDocNo: "Check Header",
                bankName: "FNB"
            });

            // Capture text AFTER the balance for the NEXT transaction's description
            carryOverDescription = dataBlock.split(rawBalance)[1]?.trim() || "";

        } else {
            // No numbers? Store the whole block as a carry-over for the next date
            carryOverDescription = (carryOverDescription + " " + dataBlock).trim();
        }
        i++; 
    }
  }

  return transactions;
};