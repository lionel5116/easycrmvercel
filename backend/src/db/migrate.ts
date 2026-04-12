/**
 * Migration script — applies schema.sql to the target database.
 * Run: npm run db:migrate
 */
import fs from 'fs';
import path from 'path';
import { pool } from './pool';

async function migrate() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  const client = await pool.connect();
  try {
    await client.query(sql);
    console.log('✓ Migration complete: schema applied');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
