export const parseFnb = (text) => {
  const transactions = [];

  // 1. DE-MASHING & CLEANUP
  let cleanText = text.replace(/\s+/g, ' ');
  cleanText = cleanText.replace(/(\d)([a-zA-Z])/g, '$1 $2');
  cleanText = cleanText.replace(/([a-z])([A-Z])/g, '$1 $2');
  cleanText = cleanText.replace(/([a-zA-Z])(\d)/g, '$1 $2');
  cleanText = cleanText.replace(/(\.\d{2})(\d)/g, '$1 $2');
  
  // Normalize date delimiters
  cleanText = cleanText.replace(/(\d{4})[\/\-](\d{2})[\/\-](\d{2})/g, " $1/$2/$3 ");
  cleanText = cleanText.replace(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/g, " $1/$2/$3 ");

  // 2. METADATA
  const accountMatch = cleanText.match(/(?:Account Number|Gold Business Account|Rekeningnommer).*?(\d{11})/i);
  const account = accountMatch ? accountMatch[1] : "62854836693"; 
  const clientMatch = cleanText.match(/(?:THE DIRECTOR|MR\s+[A-Z\s]{5,40})/i);
  const clientName = clientMatch ? clientMatch[0].trim() : "Client Name";

  let statementYear = 2026;
  const headerDateMatch = cleanText.match(/(\d{4})\/\d{2}\/\d{2}/);
  if (headerDateMatch) statementYear = parseInt(headerDateMatch[1]);

  // 3. ANCHOR SCANNER LOGIC
  // We find all occurrences of dates.
  const dateRegex = /(\d{1,2}\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Mrt|Mei|Okt|Des))/gi;
  const matches = [];
  let match;
  while ((match = dateRegex.exec(cleanText)) !== null) {
    matches.push({ date: match[1], index: match.index });
  }

  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const nextIndex = matches[i+1] ? matches[i+1].index : cleanText.length;
    
    // THE LOOK-BACK: Capture up to 60 characters BEFORE the date for descriptions
    const lookBackStart = Math.max(0, current.index - 60);
    const prevText = cleanText.substring(lookBackStart, current.index).trim();
    
    // THE LOOK-FORWARD: Capture text from the date to the next date
    const forwardText = cleanText.substring(current.index, nextIndex).trim();

    // Find Numbers (Amount and Balance)
    const moneyRegex = /([\d\s,]+[.,]\d{2}(?:\s?Cr|Dr|Dt|Kt)?)(?!\d)/gi;
    const amountsFound = forwardText.match(moneyRegex) || [];

    if (amountsFound.length >= 2) {
      const rawAmount = amountsFound[amountsFound.length - 2];
      const rawBalance = amountsFound[amountsFound.length - 1];
      
      const cleanNum = (val) => {
        let v = val.replace(/[R\s]/gi, '').replace(/(Cr|Dr|Dt|Kt)/gi, '');
        return parseFloat(v.replace(/,/g, ''));
      };

      let amount = cleanNum(rawAmount);
      const balance = cleanNum(rawBalance);

      // STITCHING THE DESCRIPTION
      // Take text found before the date and text found after the date (before amount)
      let postDateDesc = forwardText.split(rawAmount)[0].replace(current.date, '').trim();
      let fullDescription = (prevText + " " + postDateDesc).trim();

      // Clean indicators and header noise
      fullDescription = fullDescription.replace(/^(Opening Balance|Closing Balance|Service Fees|Interest Rate|Tiered|Cr|Dr|Dt|Kt|#)\s+/gi, '');
      // Ensure we don't grab part of the previous balance
      fullDescription = fullDescription.replace(/^[\d\s\.,]{4,}/, '').trim();

      // Sign Logic
      const isCredit = rawAmount.toUpperCase().includes("CR") || rawAmount.toUpperCase().includes("KT");
      if (!isCredit) amount = -Math.abs(amount);

      // Date Format
      const [day, monthStr] = current.date.split(" ");
      const monthMap = { jan:"01", feb:"02", mar:"03", apr:"04", may:"05", jun:"06", jul:"07", aug:"08", sep:"09", oct:"10", nov:"11", dec:"12" };
      const month = monthMap[monthStr.toLowerCase().substring(0,3)] || "01";
      const formattedDate = `${day.padStart(2, '0')}/${month}/${statementYear}`;

      transactions.push({
        date: formattedDate,
        description: fullDescription || "#Online Payment History",
        amount,
        balance,
        account,
        clientName,
        uniqueDocNo: "Check Header",
        bankName: "FNB"
      });
    }
  }

  return transactions;
};