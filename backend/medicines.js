const express = require('express');
const db = require('./db');
const { getInDateStock, planDispense, getExpiringBatches } = require('./fefo');
const { requireAuth } = require('./auth');

const router = express.Router();
router.use(requireAuth);

function getOrCreateMedicine(name) {
  let med = db.prepare('SELECT * FROM medicines WHERE name = ?').get(name);
  if (!med) {
    const info = db.prepare('INSERT INTO medicines (name) VALUES (?)').run(name);
    med = db.prepare('SELECT * FROM medicines WHERE id = ?').get(info.lastInsertRowid);
  }
  return med;
}

function batchesFor(medicineId) {
  return db.prepare('SELECT * FROM batches WHERE medicine_id = ?').all(medicineId);
}

// ---- Add a stock batch (creates the medicine if it doesn't exist) -------
router.post('/batches', (req, res) => {
  const { medicineName, batchCode, quantity, expiryDate } = req.body || {};
  if (!medicineName || !batchCode || !quantity || !expiryDate) {
    return res.status(400).json({ error: 'medicineName, batchCode, quantity and expiryDate are required' });
  }
  if (Number(quantity) <= 0) {
    return res.status(400).json({ error: 'quantity must be positive' });
  }
  const medicine = getOrCreateMedicine(medicineName.trim());
  try {
    const info = db
      .prepare('INSERT INTO batches (medicine_id, batch_code, quantity, expiry_date) VALUES (?, ?, ?, ?)')
      .run(medicine.id, batchCode.trim(), Number(quantity), expiryDate);
    const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({ medicine, batch });
  } catch (err) {
    if (String(err).includes('UNIQUE')) {
      return res.status(409).json({ error: 'this batch code already exists for this medicine' });
    }
    res.status(500).json({ error: 'could not add batch' });
  }
});

// ---- List medicines with in-date stock summary: search/sort/paginate ---
router.get('/', (req, res) => {
  const { search = '', sortBy = 'name', order = 'asc', page = 1, pageSize = 10 } = req.query;

  const conditions = [];
  const params = [];
  if (search) {
    conditions.push('name LIKE ?');
    params.push(`%${search}%`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = db.prepare(`SELECT COUNT(*) as count FROM medicines ${where}`).get(...params).count;

  const limit = Math.max(1, Math.min(100, Number(pageSize) || 10));
  const pageNum = Math.max(1, Number(page) || 1);
  const offset = (pageNum - 1) * limit;

  const medicines = db
    .prepare(`SELECT * FROM medicines ${where} ORDER BY name ASC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);

  const today = new Date();
  let rows = medicines.map((m) => {
    const batches = batchesFor(m.id);
    return {
      id: m.id,
      name: m.name,
      inDateStock: getInDateStock(batches, today),
      totalBatches: batches.length,
    };
  });

  const allowedSort = ['name', 'inDateStock', 'totalBatches'];
  const sortCol = allowedSort.includes(sortBy) ? sortBy : 'name';
  rows.sort((a, b) => {
    if (a[sortCol] < b[sortCol]) return order === 'desc' ? 1 : -1;
    if (a[sortCol] > b[sortCol]) return order === 'desc' ? -1 : 1;
    return 0;
  });

  res.json({ total, page: pageNum, pageSize: limit, medicines: rows });
});

// ---- Quick lookup: "do we have X in date?" -------------------------------
router.get('/search/:name', (req, res) => {
  const medicine = db.prepare('SELECT * FROM medicines WHERE name LIKE ?').get(`%${req.params.name}%`);
  if (!medicine) return res.json({ found: false });
  const batches = batchesFor(medicine.id);
  const inDateStock = getInDateStock(batches);
  res.json({ found: true, medicine: medicine.name, inDateStock, inDate: inDateStock > 0 });
});

// ---- One medicine's detail + batches -------------------------------------
router.get('/:id', (req, res) => {
  const medicine = db.prepare('SELECT * FROM medicines WHERE id = ?').get(req.params.id);
  if (!medicine) return res.status(404).json({ error: 'not found' });
  const batches = batchesFor(medicine.id).sort((a, b) => new Date(a.expiry_date) - new Date(b.expiry_date));
  res.json({ ...medicine, batches, inDateStock: getInDateStock(batches) });
});

// ---- Dispense (FEFO) ------------------------------------------------------
router.post('/:id/dispense', (req, res) => {
  const medicine = db.prepare('SELECT * FROM medicines WHERE id = ?').get(req.params.id);
  if (!medicine) return res.status(404).json({ error: 'not found' });

  const quantity = Number((req.body || {}).quantity);
  if (!quantity || quantity <= 0) return res.status(400).json({ error: 'quantity must be positive' });

  const batches = batchesFor(medicine.id);
  const plan = planDispense(batches, quantity);

  const updateStmt = db.prepare('UPDATE batches SET quantity = quantity - ? WHERE id = ?');
  const deleteStmt = db.prepare('DELETE FROM batches WHERE id = ? AND quantity <= 0');
  const tx = db.transaction((deductions) => {
    for (const d of deductions) {
      updateStmt.run(d.take, d.batchId);
      deleteStmt.run(d.batchId);
    }
  });
  tx(plan.deductions);

  res.json({
    medicine: medicine.name,
    requested: quantity,
    totalDispensed: plan.totalDispensed,
    shortfall: plan.shortfall,
    success: plan.success,
    fromBatches: plan.deductions,
  });
});

// ---- Expiry alerts for one medicine ---------------------------------------
router.get('/:id/expiring', (req, res) => {
  const medicine = db.prepare('SELECT * FROM medicines WHERE id = ?').get(req.params.id);
  if (!medicine) return res.status(404).json({ error: 'not found' });
  const days = Number(req.query.days) || 30;
  const batches = batchesFor(medicine.id);
  res.json({ medicine: medicine.name, days, batches: getExpiringBatches(batches, days) });
});

module.exports = router;
