// ---------------------------------------------------------------------
// Simulated system clock + the daily automation job.
//
// Grading needs to advance "time" without waiting for real days to pass,
// so the app's notion of "today" is a value stored in the settings table,
// not the real wall clock. Every stock/dispense/alert calculation reads
// this simulated date via getCurrentDate() instead of `new Date()`.
//
// POST /clock is the trigger: each call represents one (or more) days
// passing, and runs the same job a real daily cron would run:
//   1. Quarantine any active batch that has now passed its expiry date.
//   2. Count (but don't mutate) batches expiring within the next 7 days.
// ---------------------------------------------------------------------

const db = require('./db');
const { findBatchesToQuarantine, getExpiringBatches } = require('./fefo');

const EXPIRY_WARNING_DAYS = 7;

function getCurrentDate() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('simulated_date');
  return row ? new Date(row.value) : new Date();
}

function setCurrentDate(date) {
  const iso = date.toISOString().slice(0, 10);
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('simulated_date', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(iso);
  return iso;
}

function runDailyJob(advanceDays = 1) {
  const days = Number(advanceDays) > 0 ? Number(advanceDays) : 1;
  const current = getCurrentDate();
  const next = new Date(current);
  next.setDate(next.getDate() + days);
  setCurrentDate(next);

  const allBatches = db.prepare('SELECT * FROM batches').all();
  const toQuarantine = findBatchesToQuarantine(allBatches, next);

  if (toQuarantine.length) {
    const quarantineStmt = db.prepare("UPDATE batches SET status = 'quarantined' WHERE id = ?");
    const tx = db.transaction((rows) => {
      for (const b of rows) quarantineStmt.run(b.id);
    });
    tx(toQuarantine);
  }

  const activeBatches = db.prepare("SELECT * FROM batches WHERE status = 'active'").all();
  const expiringSoon = getExpiringBatches(activeBatches, EXPIRY_WARNING_DAYS, next);

  return {
    date: next.toISOString().slice(0, 10),
    quarantined: toQuarantine.length,
    expiringSoon: expiringSoon.length,
    expiringSoonBatches: expiringSoon.map((b) => ({ id: b.id, batch_code: b.batch_code, expiry_date: b.expiry_date })),
  };
}

module.exports = { getCurrentDate, setCurrentDate, runDailyJob, EXPIRY_WARNING_DAYS };
