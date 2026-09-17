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

## The three "twist" features — assumptions and reasoning

**Simulated clock (`/clock`).** A grading harness can't wait real days to pass, so
"today" moved from `new Date()` calls scattered through the code into a single
`settings` table value that every route reads via `getCurrentDate()`. This was a
deliberate refactor, not a bolt-on: `fefo.js`'s functions already took `today` as a
parameter from the start (rather than calling `new Date()` internally), which is
exactly what made this swap possible without touching the core FEFO logic at all —
a small design choice early on paid off here. Quarantine is a distinct `status`
column rather than just relying on the expiry-date check, because the spec asked
for an explicit quarantine action with a countable result, not just "still filtered
out of stock" — the two happen to produce the same dispensing behavior, but only
one of them is auditable as an event.

**Messy import.** The date-parsing bug worth calling out: `new Date('2026-02-31')`
in JavaScript doesn't throw or return an invalid date — it silently rolls over to
March 3rd. Relying on `isNaN(new Date(...))` to validate a date string (my first
draft) would have let non-existent calendar dates like Feb 31 or Apr 31 through as
"valid." Fixed by checking day-of-month against `new Date(year, month, 0).getDate()`
(which correctly returns 28/29 for February depending on leap year) instead of
trusting the Date constructor's own validation. Tested explicitly against Feb 29 in
a leap year (2028, valid) vs. a non-leap year (2026, invalid) to confirm the leap
logic itself is right, not just the rejection.

Deduplication happens against both the current import batch AND what's already in
the database — re-uploading the same file twice, or a file with an overlapping
batch code from an earlier import, doesn't fail or crash; it just gets silently
skipped and counted under `deduped` rather than `imported`.

**Reorder alerts.** The task didn't specify the Notification Service's actual
contract (base URL, path, payload shape), so this is intentionally configurable via
`NOTIFICATION_SERVICE_URL`/`NOTIFICATION_SERVICE_PATH` env vars rather than
hardcoded — same "state the assumption, make it easy to correct" approach as the
partial-dispense decision earlier. The alert is edge-triggered (fires only on the
dispense that causes stock to cross below the threshold) rather than level-triggered
(fires on every dispense while stock happens to be low), to avoid spamming
duplicate alerts for a medicine that stays low for days. The notification send is
fire-and-forget — a failed or unreachable Notification Service never blocks or
fails the dispense request itself, since a stock movement is the primary action and
a downstream integration failing shouldn't roll it back.
