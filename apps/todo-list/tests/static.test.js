'use strict';

// Static checks on the shipped files: required UI elements, safe coding
// patterns, no external dependencies, and container/Nginx expectations.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const html = read('index.html');
const appJs = read('js/app.js');
const coreJs = read('js/core.js');
const css = read('css/style.css');
const nginx = read('nginx.conf');
const dockerfile = read('Dockerfile');

test('application files exist', () => {
  for (const rel of ['index.html', 'css/style.css', 'js/core.js', 'js/app.js', 'assets/favicon.svg', 'nginx.conf', 'Dockerfile', '.dockerignore', 'README.md']) {
    assert.ok(fs.existsSync(path.join(root, rel)), rel + ' is missing');
  }
});

test('index.html contains the required UI elements', () => {
  const ids = [
    'task-form', 'task-title', 'task-description', 'task-priority', 'task-due',
    'task-list', 'empty-state', 'search-input', 'sort-select',
    'stat-total', 'stat-completed', 'stat-pending',
    'sample-btn', 'clear-btn', 'edit-dialog', 'confirm-dialog', 'toast-region'
  ];
  for (const id of ids) assert.match(html, new RegExp(`id="${id}"`), `#${id} missing`);
  for (const f of ['all', 'pending', 'completed']) assert.match(html, new RegExp(`data-filter="${f}"`));
  for (const p of ['low', 'medium', 'high']) assert.match(html, new RegExp(`<option value="${p}"`));
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(html, /<label for="task-title">/);
});

test('scripts and styles are local only (no CDN / external requests)', () => {
  const all = html + appJs + coreJs + css;
  assert.doesNotMatch(all, /\b(?:src|href)\s*=\s*["']https?:/i);
  assert.doesNotMatch(css, /@import|url\(\s*["']?https?:/i);
  assert.doesNotMatch(appJs + coreJs, /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/);
});

test('no unsafe DOM or dynamic code patterns', () => {
  const js = appJs + coreJs;
  assert.doesNotMatch(js, /\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(js, /\beval\s*\(|new\s+Function\s*\(|setTimeout\s*\(\s*["'`]/);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i, 'inline event handler attribute found');
  assert.doesNotMatch(html, /\sstyle\s*=/i, 'inline style attribute conflicts with CSP');
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, 'inline <script> conflicts with CSP');
});

test('nginx serves on 8080 with a /health endpoint and hides version', () => {
  assert.match(nginx, /listen\s+8080;/);
  assert.match(nginx, /location\s*=\s*\/health\s*\{[^}]*return\s+200/);
  assert.match(nginx, /server_tokens\s+off;/);
  assert.match(nginx, /pid\s+\/tmp\/nginx\.pid;/);
  assert.match(nginx, /Content-Security-Policy/);
});

test('Dockerfile uses a pinned non-root nginx image on port 8080', () => {
  const from = dockerfile.match(/^FROM\s+(\S+)/m);
  assert.ok(from, 'FROM missing');
  assert.match(from[1], /^nginxinc\/nginx-unprivileged:\d+\.\d+\.\d+-/);
  assert.match(dockerfile, /^USER\s+101\b/m);
  assert.match(dockerfile, /^EXPOSE\s+8080\b/m);
  assert.doesNotMatch(dockerfile, /^COPY\s+\.\s/m, 'should copy only required files');
  assert.doesNotMatch(dockerfile, /apk add|apt-get|npm |pip /);
});
