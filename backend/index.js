const express = require('express');
const path = require('path');
const db = require('./db');
const { router: authRouter, requireAuth } = require('./auth');
const medicinesRouter = require('./medicines');
const { getExpiringBatches } = require('./fefo');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.use('/api/auth', authRouter);
app.use('/api/medicines', medicinesRouter);

// Alerts across every medicine at once — used by the dashboard's
// "expiring soon" panel.
app.get('/api/alerts/expiring', requireAuth, (req, res) => {
  const days = Number(req.query.days) || 30;
  const medicines = db.prepare('SELECT * FROM medicines').all();
  const results = [];
  for (const m of medicines) {
    const batches = db.prepare('SELECT * FROM batches WHERE medicine_id = ?').all(m.id);
    const expiring = getExpiringBatches(batches, days);
    if (expiring.length) results.push({ medicine: m.name, medicineId: m.id, batches: expiring });
  }
  res.json({ days, results });
});

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`✅ Pharmacy service running: http://localhost:${PORT}`);
});
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Port ${PORT} is already in use.`);
    console.error(`   Fix: close whatever else is using port ${PORT}, or open backend/index.js`);
    console.error(`   and change "process.env.PORT || 3000" to a different number.\n`);
    process.exit(1);
  }
  throw err;
});
