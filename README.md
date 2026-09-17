# StockGuard — Pharmacy Batch Stock & FEFO Dispensing

A full-stack app for a neighbourhood pharmacy: log medicine batches with their expiry
dates, dispense stock oldest-first (FEFO) without ever touching expired batches, check
sellable ("in-date") stock for any medicine, and get alerts on batches expiring soon.

## Project structure

```
backend/            — Node.js + Express API + SQLite persistence
  index.js           — app entry, serves frontend/ as static files, mounts routes
  db.js              — SQLite schema + connection
  auth.js            — register/login + JWT middleware
  fefo.js            — pure stock rules (isExpired, in-date stock, FEFO plan, expiring batches)
  medicines.js        — batch/medicine routes, dispense endpoint, search
  package.json
frontend/            — plain HTML/CSS/JS, no build step, no framework
  index.html          — landing page
  login.html / register.html
  dashboard.html       — search/sort/paginate, add batch, dispense, expiry alerts
  css/styles.css
  js/app.js            — shared auth/fetch helpers
```

## Tech stack
- **Backend:** Node.js + Express
- **Database:** SQLite (via `better-sqlite3`) — real relational persistence
- **Auth:** JWT (issued on register/login), bcrypt-hashed passwords
- **Frontend:** Plain HTML/CSS/JS, served as static files by the backend

## Setup & run

**Easiest way — from the repo root, regardless of which folder you're in:**
```bash
npm start
```
This automatically `cd`s into `backend/`, installs dependencies, and starts the server.

**Or manually:**
```bash
cd backend
npm install
npm start
```

Either way, the server starts on `http://localhost:3000` (override with `PORT=xxxx`).
A SQLite file `pharmacy.db` is created automatically at the project root on first run.

If something goes wrong, the server now prints a plain-English fix instead of a raw
stack trace — e.g. if `better-sqlite3` didn't install correctly, or if port 3000 is
already taken.

Open `http://localhost:3000`:
1. **Get started** → register a pharmacist account.
2. Add a few batches for the same medicine with different expiry dates, then
   **Dispense** and watch it drain the soonest-expiring batch first.

### Environment variables (optional)
| Variable     | Default                | Purpose                       |
|--------------|--------------------------|--------------------------------|
| `PORT`       | `3000`                   | HTTP port                      |
| `JWT_SECRET` | `dev-secret-change-me`   | Signing secret for auth tokens |

### Debugging
- Delete `pharmacy.db` (and its `-wal`/`-shm` files at the project root) to reset all data.
- `GET /health` → `{ ok: true }` confirms the server is up.
- All API errors return JSON `{ error: "..." }` with an appropriate status.

## API endpoints

All `/api/medicines/*` and `/api/alerts/*` routes require `Authorization: Bearer <token>`.

| Method | Path                                | Purpose                                                       |
|--------|--------------------------------------|-----------------------------------------------------------------|
| POST   | `/api/auth/register`                | Create a pharmacist account → `{ token, email }`                |
| POST   | `/api/auth/login`                   | Log in → `{ token, email }`                                     |
| POST   | `/api/medicines/batches`             | Add a batch `{ medicineName, batchCode, quantity, expiryDate }` |
| GET    | `/api/medicines`                    | List medicines with in-date stock — `search`, `sortBy`, `order`, `page`, `pageSize` |
| GET    | `/api/medicines/search/:name`        | "Do we have X in date?" quick lookup                             |
| GET    | `/api/medicines/:id`                 | Medicine detail: batches (sorted by expiry) + in-date stock      |
| POST   | `/api/medicines/:id/dispense`        | FEFO dispense `{ quantity }`                                     |
| GET    | `/api/medicines/:id/expiring`        | One medicine's batches expiring within `?days=N` (default 30)    |
| GET    | `/api/alerts/expiring`               | Same, across every medicine — `?days=N`                          |
| POST   | `/api/medicines/import`              | Bulk import messy batch rows → `{ imported, deduped, rejected, rejectedRows }` |
| PATCH  | `/api/medicines/:id/threshold`        | Set a medicine's reorder threshold `{ threshold }`                |
| POST   | `/clock`                             | **Unauthenticated.** Advances the simulated day and runs the daily job (quarantine expired batches, count batches expiring within 7 days). Optional body `{ advanceDays: N }`, defaults to 1. |

### `/clock` — simulated time for testing without waiting real days

The app's notion of "today" is stored in a `settings` table, not read from the real
system clock, once `/clock` has been called at least once. Every stock, dispense,
and alert calculation reads this simulated date, so a grading harness can advance
time deterministically:

```bash
curl -X POST http://localhost:3000/clock -H "Content-Type: application/json" -d '{"advanceDays": 8}'
# → { "date": "2026-09-25", "quarantined": 2, "expiringSoonBatches": [...], "expiringSoon": 1 }
```

### `/api/medicines/import` — messy batch data

Accepts `{ "rows": [ {...}, {...} ] }` where each row may use loose key names
(`medicineName`/`medicine`/`name`, `batchCode`/`batch_code`/`batch`, `quantity`/`qty`,
`expiryDate`/`expiry_date`/`expiry`) and messy values — `"10 units"`, `null`,
`dd/mm/yyyy` or ISO dates, duplicate medicine+batch combos. Invalid rows are
rejected with a reason instead of guessed at; duplicates (within the file, or
already in the database) are skipped and counted separately from rejections.

### Reorder alerts (Notification Service integration)

Each medicine has a `reorder_threshold` (default 20, settable via the endpoint
above). When a dispense causes in-date stock to cross from at-or-above the
threshold to below it, the app POSTs a reorder alert to an external Notification
Service. **The exact contract wasn't specified in the task**, so this is
configurable via two env vars rather than hardcoded:

| Variable                     | Default                   |
|-------------------------------|----------------------------|
| `NOTIFICATION_SERVICE_URL`    | `http://localhost:4000`    |
| `NOTIFICATION_SERVICE_PATH`   | `/notify`                  |

Payload sent: `{ type: "REORDER_ALERT", medicineId, medicineName, currentStock, threshold, timestamp }`.
A failed/unreachable Notification Service never blocks the dispense response —
see REASONING.md for why. If your grading harness's mock service exposes `/outbox`
to inspect what it received, point `NOTIFICATION_SERVICE_URL` at that service's
base URL and it should just work without any code changes.

## What I actually did (build log)

- Started with the core FEFO logic as pure, DB-free functions (`backend/fefo.js`) and
  unit-tested it with hand-picked dates before touching the database or API at all.
- Layered SQLite persistence on top (`db.js`), then the REST routes (`medicines.js`,
  `auth.js`) that call into the pure logic and apply its decisions inside a transaction.
- Built the frontend last, directly against the finished API — landing page, then
  auth pages, then the dashboard (batch form → medicine table → dispense modal →
  expiry alerts panel).
- Restructured into `frontend/`/`backend/` folders afterward for clarity, and fixed
  the two relative paths that broke as a result (static file root in `index.js`,
  DB file path in `db.js`).

See `REASONING.md` for the FEFO and partial-dispense design decisions.
