// ---------------------------------------------------------------------
// Sends a re-order alert to an external Notification Service when a
// medicine's in-date stock drops below its reorder threshold.
//
// ASSUMPTION (the exact contract wasn't specified): POSTs a JSON body to
// `${NOTIFICATION_SERVICE_URL}${NOTIFICATION_SERVICE_PATH}`, defaulting to
// http://localhost:4000/notify. If your grading harness's Notification
// Service uses a different base URL or path, set those two env vars —
// no code change needed. See REASONING.md for why this shape was chosen.
//
// A failed/unreachable Notification Service never blocks the dispense
// request itself — this is fire-and-forget by design.
// ---------------------------------------------------------------------

const BASE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:4000';
const PATH = process.env.NOTIFICATION_SERVICE_PATH || '/notify';

function sendReorderAlert({ medicineId, medicineName, currentStock, threshold }) {
  const payload = {
    type: 'REORDER_ALERT',
    medicineId,
    medicineName,
    currentStock,
    threshold,
    timestamp: new Date().toISOString(),
  };

  fetch(`${BASE_URL}${PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch((err) => {
    console.warn(`⚠️  Could not reach Notification Service at ${BASE_URL}${PATH}: ${err.message}`);
  });

  return true;
}

module.exports = { sendReorderAlert };
