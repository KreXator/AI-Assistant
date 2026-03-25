'use strict';

const cron = require('node-cron');
const { backupDatabase } = require('../../scripts/backup_db');

/**
 * Schedule a daily backup at 03:00 AM Europe/Warsaw
 */
function init() {
  const expr = '0 3 * * *'; // 3:00 AM every day
  const tz = process.env.TZ || 'Europe/Warsaw';

  cron.schedule(expr, async () => {
    console.log(`[BackupScheduler] Scheduled backup triggered.`);
    try {
      await backupDatabase();
    } catch (err) {
      console.error('[BackupScheduler] Background backup failed:', err.message);
    }
  }, { timezone: tz });

  console.log(`[BackupScheduler] Initialized — daily backup set for ${expr} (${tz})`);
}

module.exports = { init };
