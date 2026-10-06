import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { operationsOverview } from '../src/operations/adminOperations.js';
import pool from '../src/config/db.js';
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout = '5s'");
  await client.query(await readFile(new URL('../src/operations/schema.sql', import.meta.url), 'utf8'));
  await client.query('COMMIT');
  await operationsOverview(pool);
  console.info('Operations schema and dashboard queries verified');
} catch {
  await client.query('ROLLBACK');
  console.error('Operations migration failed; deployment must stop');
  process.exitCode = 1;
} finally { client.release(); await pool.end(); }
