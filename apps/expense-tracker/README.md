# Plod Phai Expense — Expense Tracker workload

A personal income/expense tracker used as a **demo workload** for the
Plod Phai Cloud DevSecOps pipeline. It is a static web app: HTML, CSS and
vanilla JavaScript served by Nginx. It has no backend, no database, and no
external APIs or CDNs. It is **not connected to any bank or payment
service**. All amounts are in **Thai Baht (THB, ฿)**.

## Features

- Summary cards for **current balance**, **total income**, and **total expenses**. All three are calculated from the stored transactions; nothing is hard-coded
- **Add transactions**: type (Income / Expense), title, amount, category (the list follows the type), date (defaults to today), and optional notes
  - Amounts must be positive with at most 2 decimals and at most ฿99,999,999.99. Commas and a leading `฿` are accepted
  - Each invalid field shows its own error message
- **Edit** a transaction in the same form, pre-filled with its values. **Delete** asks for confirmation
- **Transaction history** in which income and expenses are distinguished by colour, an arrow icon, a text label, and a `+`/`−` sign
- **Filters** by type, category, date range (from/to), and text search over title and notes. All filters combine. An invalid range shows an error and is ignored
- **Sorting** by newest, oldest, highest amount, or lowest amount
- Totals for the current view (count, income, expenses, net)
- **Charts** drawn locally from the data in the current view:
  - *Spending by category*: labelled horizontal bars with the amount and percentage
  - *Income vs expenses*: an SVG bar chart of the last 6 months. Expense bars are striped so the chart doesn't rely on colour alone. Bars have tooltips, the chart has a screen-reader description, and a "Show chart data as a table" option is available
- **Load sample data** (15 Thai-context transactions, never duplicated) and **Clear all** (with confirmation)
- Responsive layout with light and dark themes, keyboard-accessible controls, and reduced-motion support

### Money handling

Amounts are parsed **as strings** into **integer satang** (1 THB = 100
satang) and stored that way (`amountSatang`). All sums are integer sums, so
the floating-point drift you get with `0.1 + 0.2` cannot happen. Values are
converted to baht only for display, using
`Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' })`.

## Technologies

| Layer | Choice |
|---|---|
| UI | HTML5, CSS, vanilla JavaScript, inline SVG icons and charts |
| Storage | Browser `localStorage` (key `plodphai.expense.transactions.v1`) |
| Server | Nginx `nginxinc/nginx-unprivileged:1.30.6-alpine3.24-slim`, non-root (uid 101), port 8080 |
| Tests | Node.js ≥ 22 built-in test runner (`node:test`). There are **no npm dependencies** |

## Directory structure

```text
apps/expense-tracker/
├── index.html            # markup, icon sprite, confirmation dialog
├── css/style.css         # theme, category colours, responsive layout
├── js/core.js            # pure logic: money parsing, validation, summaries, charts data, storage
├── js/app.js             # DOM rendering, SVG chart drawing, events
├── assets/favicon.svg
├── nginx.conf
├── Dockerfile
├── .dockerignore
├── package.json          # test scripts only, no dependencies
└── tests/
    ├── core.test.js
    ├── static.test.js
    ├── e2e.test.js
    └── helpers/browser.js
```

## Run locally without Docker

```bash
cd apps/expense-tracker
python -m http.server 8082
```

Open <http://localhost:8082>. `/health` exists only in the Nginx container.

## Build and run with Docker

From the repository root:

```bash
docker build -t expense-tracker:local ./apps/expense-tracker
docker run --rm -p 8082:8080 expense-tracker:local
```

- App: <http://localhost:8082>
- Health check: <http://localhost:8082/health>

```bash
curl -i http://localhost:8082/health    # HTTP/1.1 200 OK ... "ok"
```

For an ALB target group, use path `/health`, matcher `200`, and port `8080`.

## Run the tests

```bash
cd apps/expense-tracker
npm test               # all tests (same as: node --test)
npm run test:unit      # core + static checks
npm run test:e2e       # headless browser tests
```

- **Unit tests** cover amount parsing and rejection of invalid, negative, zero and over-precise amounts, exact satang totals, the category breakdown and monthly buckets, filters, sorting, edit/delete, recovery from malformed storage, and sample de-duplication.
- **Static checks** confirm that the required UI elements exist and that there is no `innerHTML`, `eval` or external URLs. They also check that each category has a colour, that Nginx serves `/health` on 8080, and that the Dockerfile is pinned and non-root.
- **Browser tests** run the real UI in headless Chrome/Edge. They create income and expenses and check the exact totals, confirm the charts update, and exercise editing, deletion with confirmation, combined filters and sorting, persistence across reloads, and recovery from malformed data. They are skipped if no Chromium-based browser is found. Set `CHROME_PATH` to point at one.

## Where data is stored

Transactions live **only in the visitor's browser** in `localStorage`. They
are not stored in Docker, AWS, or a database, and they are never sent to any
server.

## Resetting data

- Click **Clear all** in the top bar and confirm.
- Or run `localStorage.removeItem('plodphai.expense.transactions.v1')` in the DevTools console.

## Known limitations

- Single currency (THB). No multi-currency support, recurring entries, budgets, or import/export.
- Data is per browser and per origin, with no sync.
- The monthly chart always shows the 6 months ending with the current month. Older data still counts in the totals and the category chart.
- Security headers (CSP and others) are sent only when served by the bundled Nginx config.
