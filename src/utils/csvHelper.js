/**
 * Converts an array of transaction objects into a CSV string
 * @param {Array} transactions - The parsed transactions
 * @returns {string} - CSV formatted string
 */
export const generateCSV = (transactions) => {
  if (!transactions || transactions.length === 0) {
    return "Date,Description,Amount,Balance";
  }

  // Define headers
  const headers = ["Date", "Description", "Amount", "Balance"];
  
  // Map transactions to rows
  const rows = transactions.map(t => [
    t.date || '',
    `"${(t.description || '').replace(/"/g, '""')}"`, // Escape quotes for CSV safety
    t.amount || 0,
    t.balance || 0
  ]);

  // Combine headers and rows
  return [
    headers.join(','),
    ...rows.map(row => row.join(','))
  ].join('\n');
};