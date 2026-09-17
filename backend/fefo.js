// ---------------------------------------------------------------------
// Core stock rules for the pharmacy — kept as pure functions so they
// can be unit-tested without touching the database.
//
//   - A batch counts as expired only from the day AFTER its expiry
//     date (it's still sellable ON the expiry date itself).
//   - "In-date stock" = quantity summed across non-expired batches.
//   - Dispensing always drains the soonest-expiring in-date batch
//     first (FEFO), and never touches an expired batch.
// ---------------------------------------------------------------------

function stripTime(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function isExpired(batch, today = new Date()) {
  return stripTime(today) > stripTime(batch.expiry_date);
}

function getInDateBatches(batches, today = new Date()) {
  // Quarantined batches are excluded even if somehow not yet past their
  // expiry date — quarantine is a deliberate override, not just a label.
  return batches.filter((b) => !isExpired(b, today) && b.status !== 'quarantined');
}

function getInDateStock(batches, today = new Date()) {
  return getInDateBatches(batches, today).reduce((sum, b) => sum + b.quantity, 0);
}

/**
 * Decides how much to take from each batch, oldest-expiry-first, to
 * satisfy `quantityNeeded`. Does NOT mutate `batches` or touch the DB —
 * callers apply the returned deductions inside a transaction.
 *
 * Assumption (spec leaves this open): if in-date stock is insufficient,
 * this does a PARTIAL dispense and reports the shortfall, rather than
 * rejecting the whole request. Pass `allowPartial: false` to reject
 * instead of partially fulfilling.
 */
function planDispense(batches, quantityNeeded, { today = new Date(), allowPartial = true } = {}) {
  const sorted = getInDateBatches(batches, today)
    .slice()
    .sort((a, b) => new Date(a.expiry_date) - new Date(b.expiry_date));

  const available = sorted.reduce((sum, b) => sum + b.quantity, 0);

  if (available < quantityNeeded && !allowPartial) {
    return { success: false, deductions: [], totalDispensed: 0, shortfall: quantityNeeded - available };
  }

  let remaining = quantityNeeded;
  const deductions = [];
  for (const batch of sorted) {
    if (remaining <= 0) break;
    const take = Math.min(batch.quantity, remaining);
    if (take > 0) {
      deductions.push({ batchId: batch.id, take });
      remaining -= take;
    }
  }

  return {
    success: remaining === 0,
    deductions,
    totalDispensed: quantityNeeded - remaining,
    shortfall: remaining,
  };
}

function getExpiringBatches(batches, daysThreshold, today = new Date()) {
  const t = stripTime(today);
  return batches
    .filter((b) => {
      const daysLeft = (stripTime(b.expiry_date) - t) / (1000 * 60 * 60 * 24);
      return daysLeft >= 0 && daysLeft <= daysThreshold;
    })
    .sort((a, b) => new Date(a.expiry_date) - new Date(b.expiry_date));
}

/**
 * Finds active batches that have now passed their expiry date and need
 * to be quarantined. Pure — the caller applies the DB update and persists
 * the "quarantined" status; this just decides which ones qualify.
 */
function findBatchesToQuarantine(batches, today = new Date()) {
  return batches.filter((b) => (b.status || 'active') === 'active' && isExpired(b, today));
}

module.exports = {
  isExpired,
  getInDateBatches,
  getInDateStock,
  planDispense,
  getExpiringBatches,
  findBatchesToQuarantine,
};
