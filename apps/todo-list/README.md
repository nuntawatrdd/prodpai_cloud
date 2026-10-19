# Plod Phai Todo — Todo List workload

A small, self-contained task manager used as a **demo workload** for the
Plod Phai Cloud DevSecOps pipeline (Docker build, Semgrep, Trivy, SBOM, ECR,
AWS deployment). It is a static web app: HTML, CSS and vanilla JavaScript
served by Nginx. It has no backend, no database, no external API calls, and
loads nothing from a CDN.

## Features

- Dashboard layout with a sidebar (status views and data actions), a greeting, and summary cards for **total / completed / pending** tasks plus a progress bar
- **Add tasks** with a title (required, trimmed, max 120 chars), an optional description, a priority (Low / Medium / High), and an optional due date
- **Edit** a task in a dialog that is pre-filled with its current values. Completion status is kept
- **Complete / reopen** tasks with a checkbox button. Counters update immediately
- **Delete** tasks after a confirmation dialog
- **Filter** by All / Pending / Completed and **search** title + description. The filters and search can be combined
- **Sort** by newest, oldest, priority, or due date (tasks without a due date go last)
- Badges for overdue and due-today tasks
- Empty states for "no tasks" and "no matches", inline validation errors, and toast feedback
- **Load sample tasks** (never duplicated) and **Clear all tasks** (with confirmation)
- Responsive from 360 px phones to desktop, with light and dark themes, visible focus rings, a skip link, and reduced-motion support

## Technologies

| Layer | Choice |
|---|---|
| UI | HTML5, CSS (custom properties, grid/flex), vanilla JavaScript (ES5-compatible), inline SVG icons |
| Storage | Browser `localStorage` (key `plodphai.todo.tasks.v1`) |
| Server | Nginx `nginxinc/nginx-unprivileged:1.30.6-alpine3.24-slim`, non-root (uid 101), port 8080 |
| Tests | Node.js ≥ 22 built-in test runner (`node:test`). There are **no npm dependencies** |

## Directory structure

```text
apps/todo-list/
├── index.html            # markup, icon sprite, dialogs
├── css/style.css         # theme + responsive layout
├── js/core.js            # pure logic: validation, filter/sort, storage (unit-tested)
├── js/app.js             # DOM rendering and event handling
├── assets/favicon.svg
├── nginx.conf            # full Nginx config (non-root, /health, security headers)
├── Dockerfile
├── .dockerignore
├── package.json          # test scripts only, no dependencies
└── tests/
    ├── core.test.js      # unit tests for js/core.js
    ├── static.test.js    # file/markup/security/Dockerfile checks
    ├── e2e.test.js       # real-browser tests (headless Chrome/Edge)
    └── helpers/browser.js
```

## Run locally without Docker

Any static file server works. For example, from this directory:

```bash
python -m http.server 8081
# or: npx --yes http-server -p 8081   (needs internet the first time)
```

Open <http://localhost:8081>. Note that `/health` exists only in the Nginx
container. A plain static server returns 404 for it.

## Build and run with Docker

From the repository root:

```bash
docker build -t todo-list:local ./apps/todo-list
docker run --rm -p 8081:8080 todo-list:local
```

- App: <http://localhost:8081>
- Health check: <http://localhost:8081/health>

```bash
curl -i http://localhost:8081/health    # HTTP/1.1 200 OK ... "ok"
```

The image also defines a Docker `HEALTHCHECK` that calls `/health`. For an
AWS ALB target group, use path `/health`, success code `200`, and port `8080`.

## Run the tests

You need Node.js 22 or newer. Nothing has to be installed.

```bash
cd apps/todo-list
npm test               # all tests (same as: node --test)
npm run test:unit      # core + static checks only
npm run test:e2e       # browser tests only
```

- **Unit tests** (`core.test.js`) cover validation, trimming, create/edit/toggle/delete, counters, filters plus search, sorting, sample de-duplication, and recovery from malformed or throwing storage.
- **Static checks** (`static.test.js`) confirm that the required UI elements exist and that there is no `innerHTML`, `eval`, inline handlers or external URLs. They also check that Nginx listens on 8080 with `/health` and that the Dockerfile is pinned and non-root.
- **Browser tests** (`e2e.test.js`) start a local server and drive headless Chrome/Edge over the DevTools protocol. They create, edit, complete and delete tasks, check filters and search, and confirm persistence across reloads and that malformed `localStorage` doesn't crash the app. They are **skipped automatically** when no Chromium-based browser is found. Set `CHROME_PATH` to point at one.

## Where data is stored

Tasks are stored **only in the visitor's browser** in `localStorage`. They are
not stored in Docker, AWS, or any database, and they never leave the browser.
Each browser and each origin (host + port) has its own separate list.

## Resetting data

- In the app, click **Clear all tasks** and confirm.
- Or, in the browser DevTools console, run `localStorage.removeItem('plodphai.todo.tasks.v1')`.
- Clearing site data for the origin also removes the tasks.

## Known limitations

- No sync between devices or browsers, and no accounts (by design).
- Data is lost if the user clears site data. Private windows discard it on close.
- If storage is blocked, the app still works in memory and shows a warning.
- Dates use the browser's local time zone.
- The Content-Security-Policy and other security headers are sent by Nginx only, not by a plain static server.
