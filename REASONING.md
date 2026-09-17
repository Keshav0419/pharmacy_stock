# Reasoning

## Data model
`medicines` (one row per distinct name) and `batches` (each tied to a medicine, with
its own `quantity` and `expiry_date`). Keeping batches as their own table — rather than
a single running total per medicine — is what makes FEFO possible at all: dispensing
needs to know about *individual* batches and their expiry order, not just a combined
count.

## Core rules and the decisions the spec left open

1. **Expiry boundary:** a batch is still sellable ON its expiry date itself, and only
   counts as expired starting the day after. This matches how "best before" / "use by"
   dates are conventionally read.
2. **FEFO ordering:** dispensing always sorts in-date batches by `expiry_date` ascending
   and drains them in that order, regardless of which batch was added to the system
   first. Two batches with the same expiry date are drained in whatever order the sort
   happens to return them in — order between equal-expiry batches doesn't matter for
   correctness.
3. **Partial dispense on insufficient stock:** if a request exceeds in-date stock, the
   system dispenses everything it can and reports the shortfall, rather than rejecting
   the whole request. The alternative (all-or-nothing) is a one-line flag change in
   `fefo.js` (`allowPartial: false`) if that's what's expected instead.
4. **Expired stock is invisible to both stock counts and dispensing.** `getInDateStock`
   and `planDispense` both filter expired batches out before doing anything else.

## Testing approach
Tested `fefo.js`'s pure functions directly before wiring up the API:
- Two batches, one expired, one not → in-date stock only counts the valid one.
- Three batches with different expiry dates → dispense drains the soonest-expiring
  one first, then spills into the next only once the first is exhausted.
- Dispense request exceeding total in-date stock → partial fulfillment with the
  correct shortfall, expired batches still untouched.
- All batches expired → in-date stock is 0, dispense returns a full shortfall with
  no deductions.

Then exercised the same scenarios through the REST endpoints (add batches → dispense
→ check remaining batches) to confirm the DB transaction applies the deductions FEFO
chose, and removes any batch that hits zero.

## What I'd fix with more time
- Batch codes are free-text; validating a consistent format would catch typos earlier.
- No audit log of dispense events yet — useful to trace who dispensed what and when.
