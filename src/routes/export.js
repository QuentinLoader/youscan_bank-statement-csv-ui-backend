import express from 'express';
import { generateCSV } from '../utils/csvHelper.js';

// Declare it once here
export const router = express.Router();

router.post('/', (req, res) => {
  try {
    const { transactions } = req.body;

    if (!transactions || !Array.isArray(transactions)) {
      return res.status(400).json({ error: 'Invalid transaction data' });
    }

    const csvData = generateCSV(transactions);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=slimjan_export.csv');
    
    return res.status(200).send(csvData);
  } catch (error) {
    console.error('Export Route Error:', error);
    res.status(500).json({ error: 'Failed to generate CSV' });
  }
});

// DO NOT add another "export const router" line down here!