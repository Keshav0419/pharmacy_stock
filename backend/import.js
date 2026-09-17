// ---------------------------------------------------------------------
// Messy batch import: takes a list of loosely-formatted rows (nulls,
// "10 units" style quantities, dd/mm/yyyy vs ISO dates, duplicate rows)
// and turns it into clean, insertable batch records — or a documented
// rejection reason for anything that can't be salvaged.
//
// Kept pure (no DB access) so every parsing rule is unit-testable in
// isolation, the same pattern as fefo.js.
// ---------------------------------------------------------------------

function cleanString(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length ? trimmed : null;
}

// Accepts a plain positive number, or a string like "10 units" / "10" —
// pulls out the first run of digits. Rejects anything with no usable number.
function parseQuantity(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  if (typeof raw === 'string') {
    const match = raw.match(/\d+/);
    if (match) {
      const n = parseInt(match[0], 10);
      if (n > 0) return n;
    }
  }
  return null;
}

function isValidCalendarDate(year, month, day) {
  // Checks the date actually exists on the calendar (leap years included)
  // rather than trusting `new Date(...)`, which silently overflows invalid
  // dates instead of rejecting them (e.g. "2026-02-31" quietly becomes
  // March 3rd rather than throwing) — this is the real trap in messy data.
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(year, month, 0).getDate();
  return day <= daysInMonth;
}

// Accepts ISO "YYYY-MM-DD" or "DD/MM/YYYY" (the two formats the spec calls
// out). Anything else — including null, empty, an unrecognized shape, or a
// calendar date that doesn't actually exist — is rejected rather than
// guessed at, since a wrong guess on a date is worse than refusing it.
function parseExpiryDate(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();

  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [, y, mo, d] = isoMatch;
    return isValidCalendarDate(Number(y), Number(mo), Number(d)) ? trimmed : null;
  }

  const dmyMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmyMatch) {
    const day = Number(dmyMatch[1]);
    const month = Number(dmyMatch[2]);
    const year = dmyMatch[3];
    if (!isValidCalendarDate(Number(year), month, day)) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  return null;
}

/**
 * @param {Array<object>} rows raw messy input rows. Accepts a few common
 *   key spellings per field (medicineName/medicine/name, etc.) since messy
 *   real-world exports rarely agree on column names.
 * @param {Set<string>} existingKeys lowercase "medicine::batchcode" keys
 *   already present in the database, so re-importing the same file twice
 *   dedupes against what's already stored, not just within this one file.
 */
function processImportRows(rows, existingKeys = new Set()) {
  const seen = new Set(existingKeys);
  const toInsert = [];
  const rejected = [];
  let deduped = 0;

  rows.forEach((row, index) => {
    row = row || {};
    const medicineName = cleanString(row.medicineName ?? row.medicine ?? row.name);
    const batchCode = cleanString(row.batchCode ?? row.batch_code ?? row.batch);
    const quantity = parseQuantity(row.quantity ?? row.qty);
    const expiryDate = parseExpiryDate(row.expiryDate ?? row.expiry_date ?? row.expiry);

    if (!medicineName) { rejected.push({ index, row, reason: 'missing or invalid medicine name' }); return; }
    if (!batchCode) { rejected.push({ index, row, reason: 'missing or invalid batch code' }); return; }
    if (!quantity) { rejected.push({ index, row, reason: 'missing or invalid quantity' }); return; }
    if (!expiryDate) { rejected.push({ index, row, reason: 'missing or invalid expiry date' }); return; }

    const key = `${medicineName.toLowerCase()}::${batchCode.toLowerCase()}`;
    if (seen.has(key)) {
      deduped++;
      return;
    }
    seen.add(key);
    toInsert.push({ medicineName, batchCode, quantity, expiryDate });
  });

  return { toInsert, deduped, rejected };
}

module.exports = { processImportRows, parseQuantity, parseExpiryDate, cleanString };
