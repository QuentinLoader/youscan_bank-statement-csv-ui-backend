export const parseFnb = (text) => {
  const transactions = [];
  
  console.log("🔍 DEBUG: Full text length:", text.length);
  console.log("🔍 DEBUG: First 500 chars:", text.substring(0, 500));

  // 1. METADATA EXTRACTION
  const accountMatch = text.match(/(\d{11})/);
  const account = accountMatch ? accountMatch[1] : "Unknown";
  console.log("🔍 DEBUG: Account found:", account);

  const statementIdMatch = text.match(/BBST(\d+)/i);
  const statementId = statementIdMatch ? statementIdMatch[1] : "Unknown";
  console.log("🔍 DEBUG: Statement ID found:", statementId);

  const clientMatch = text.match(/\*([A-Z\s]+PROPERTIES[A-Z\s]*)/);
  const clientName = clientMatch ? clientMatch[1].trim() : "Unknown";
  console.log("🔍 DEBUG: Client name found:", clientName);

  let statementYear = 2025;
  const yearMatch = text.match(/(\d{4})\/\d{2}\/\d{2}/);
  if (yearMatch) statementYear = parseInt(yearMatch[1]);

  // 2. FIND TRANSACTION DATA
  // Look for the distinctive pattern of dates followed by descriptions and amounts
  // FNB format: "17 Jan Internet Trf From... 9,500.00Cr 9,977.15Cr"
  
  // First, let's see if we can find any date patterns
  const dateTest = text.match(/\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/gi);
  console.log("🔍 DEBUG: Found date patterns:", dateTest ? dateTest.length : 0);
  if (dateTest) console.log("🔍 DEBUG: First few dates:", dateTest.slice(0, 5));

  // Try to find "Transactions in RAND" section
  let transSection = text;
  const transMatch = text.match(/Transactions in RAND[^]*?(?:Closing Balance|Turnover|$)/i);
  if (transMatch) {
    transSection = transMatch[0];
    console.log("🔍 DEBUG: Found Transactions section, length:", transSection.length);
  } else {
    console.log("🔍 DEBUG: No 'Transactions in RAND' section found, using full text");
  }

  // 3. ENHANCED PATTERN MATCHING
  // Try multiple regex patterns to handle different PDF extraction formats
  
  // Pattern 1: Standard format with spacing
  const pattern1 = /(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))\s+(.+?)\s+([\d,]+\.\d{2})(Cr)?\s+([\d,]+\.\d{2})(Cr)?/gi;
  let matches = [...transSection.matchAll(pattern1)];
  console.log("🔍 DEBUG: Pattern 1 matches:", matches.length);

  // Pattern 2: Minimal spacing (for heavily compressed PDF text)
  if (matches.length === 0) {
    const pattern2 = /(\d{1,2}\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))\s*([A-Za-z][^0-9]*?)\s*([\d,]+\.\d{2})(Cr)?\s*([\d,]+\.\d{2})(Cr)?/gi;
    matches = [...transSection.matchAll(pattern2)];
    console.log("🔍 DEBUG: Pattern 2 matches:", matches.length);
  }

  // Pattern 3: Split by date and process blocks
  if (matches.length === 0) {
    console.log("🔍 DEBUG: Trying line-by-line approach...");
    const datePattern = /(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))/gi;
    const parts = transSection.split(datePattern).filter(p => p.trim().length > 0);
    console.log("🔍 DEBUG: Split into", parts.length, "parts");
    
    for (let i = 0; i < parts.length - 1; i += 2) {
      if (parts[i].match(datePattern)) {
        const dateStr = parts[i].trim();
        const dataBlock = parts[i + 1];
        
        // Look for amounts in this block
        const amountMatches = [...dataBlock.matchAll(/([\d,]+\.\d{2})(Cr)?/g)];
        console.log(`🔍 DEBUG: Date ${dateStr} has ${amountMatches.length} amounts`);
        
        if (amountMatches.length >= 2) {
          const amountMatch = amountMatches[amountMatches.length - 2];
          const balanceMatch = amountMatches[amountMatches.length - 1];
          
          // Extract description (everything before first amount)
          const firstAmountIndex = amountMatch.index;
          const description = dataBlock.substring(0, firstAmountIndex).trim();
          
          const amount = parseFloat(amountMatch[1].replace(/,/g, ''));
          const balance = parseFloat(balanceMatch[1].replace(/,/g, ''));
          const isCr = amountMatch[2] === 'Cr';
          
          const [day, monthName] = dateStr.split(/\s+/);
          const monthMap = {
            jan: "01", feb: "02", mar: "03", apr: "04",
            may: "05", jun: "06", jul: "07", aug: "08",
            sep: "09", oct: "10", nov: "11", dec: "12"
          };
          const month = monthMap[monthName.toLowerCase().substring(0, 3)] || "01";
          const formattedDate = `${day.padStart(2, '0')}/${month}/${statementYear}`;
          
          matches.push({
            groups: {
              date: dateStr,
              description: description,
              amount: isCr ? amount : -amount,
              balance: balance,
              formattedDate: formattedDate
            }
          });
        }
      }
    }
  }

  // 4. PROCESS MATCHES
  console.log("🔍 DEBUG: Total matches to process:", matches.length);

  for (const match of matches) {
    let dateStr, description, amount, balance, formattedDate;
    
    if (match.groups) {
      // Pattern 3 format
      dateStr = match.groups.date;
      description = match.groups.description;
      amount = match.groups.amount;
      balance = match.groups.balance;
      formattedDate = match.groups.formattedDate;
    } else {
      // Pattern 1 or 2 format
      dateStr = match[1];
      description = match[2];
      const amountStr = match[3];
      const amountCr = match[4];
      const balanceStr = match[5];
      
      // Skip headers
      if (description.toLowerCase().includes('opening balance') ||
          description.toLowerCase().includes('description') ||
          description.length < 3) {
        continue;
      }
      
      description = description.trim().replace(/\s{2,}/g, ' ');
      amount = parseFloat(amountStr.replace(/,/g, ''));
      if (amountCr !== 'Cr') amount = -amount;
      balance = parseFloat(balanceStr.replace(/,/g, ''));
      
      const [day, monthName] = dateStr.split(/\s+/);
      const monthMap = {
        jan: "01", feb: "02", mar: "03", apr: "04",
        may: "05", jun: "06", jul: "07", aug: "08",
        sep: "09", oct: "10", nov: "11", dec: "12"
      };
      const month = monthMap[monthName.toLowerCase().substring(0, 3)] || "01";
      formattedDate = `${day.padStart(2, '0')}/${month}/${statementYear}`;
    }
    
    transactions.push({
      date: formattedDate,
      description: description,
      amount: amount,
      balance: balance,
      account: account,
      clientName: clientName,
      uniqueDocNo: statementId,
      bankName: "FNB"
    });
  }

  console.log("✅ DEBUG: Successfully parsed", transactions.length, "transactions");
  return transactions;
};