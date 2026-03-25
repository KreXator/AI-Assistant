'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') }); 

const fs = require('fs');
const turso = require('../src/db/turso');

async function backupDatabase() {
  console.log('[Backup] Starting database backup...');
  try {
    const backupDir = path.join(__dirname, '../backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    // Get all custom tables
    const tablesRes = await turso.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
    const tables = tablesRes.rows.map(row => row[0]);

    const backupData = {};
    for (const table of tables) {
      const res = await turso.execute(`SELECT * FROM ${table}`);
      const cols = res.columns;
      const data = res.rows.map(row => {
        const obj = {};
        cols.forEach((col, i) => {
          obj[col] = row[i];
        });
        return obj;
      });
      backupData[table] = data;
    }

    const now = new Date();
    const pad = (n) => n.toString().padStart(2, '0');
    const timestamp = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    
    const filename = `backup_${timestamp}.json`;
    const filepath = path.join(backupDir, filename);

    fs.writeFileSync(filepath, JSON.stringify(backupData, null, 2), 'utf-8');
    console.log(`[Backup] Success! File created: backups/${filename}`);

    // Rotate backups - keep last 10
    const files = fs.readdirSync(backupDir)
      .filter(f => f.startsWith('backup_') && f.endsWith('.json'))
      .sort((a, b) => b.localeCompare(a)); // Descending order (newest first)

    if (files.length > 10) {
      for (let i = 10; i < files.length; i++) {
        fs.unlinkSync(path.join(backupDir, files[i]));
        console.log(`[Backup] Cleaned up old backup: backups/${files[i]}`);
      }
    }
  } catch (err) {
    console.error(`[Backup] Failed: ${err.message}`);
    process.exit(1);
  }
}

// Only execute directly if run from CLI (allows module import for scheduling without exit(1))
if (require.main === module) {
  backupDatabase();
}

module.exports = { backupDatabase };
