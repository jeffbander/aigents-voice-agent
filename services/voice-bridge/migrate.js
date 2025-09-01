const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function migrate() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();
    console.log('Connected to database');
    
    const sql = fs.readFileSync(path.join(__dirname, 'drizzle/0000_lonely_mikhail_rasputin.sql'), 'utf8');
    
    // Remove statement-breakpoint comments
    const cleanSql = sql.replace(/--> statement-breakpoint/g, '');
    
    await client.query(cleanSql);
    console.log('Migration completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await client.end();
  }
}

migrate();