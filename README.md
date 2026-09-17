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
