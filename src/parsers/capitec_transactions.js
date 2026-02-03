// ... (keep the top part of the script the same)

      if (amountMatch) {
        // The first match is the transaction amount (Money In/Out)
        amount = parseFloat(amountMatch[0].replace(/\s|,/g, ''));
        
        // NEW: If there's a second amount match, that is our Balance
        let balance = null;
        if (amountMatch.length >= 2) {
          balance = parseFloat(amountMatch[amountMatch.length - 1].replace(/\s|,/g, ''));
        }

        description = content.split(amountMatch[0])[0].trim();
        
        pendingTx = { 
          date, 
          description, 
          amount, 
          balance, // Added to the object
          approved: true 
        };
      }
// ... (keep the rest of the script the same)