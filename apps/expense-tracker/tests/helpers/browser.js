/*
 * Zero-dependency browser harness for end-to-end tests.
 *  - startServer(): tiny static file server for the app directory
 *  - launchBrowser(): headless Chrome/Edge/Chromium driven over the
 *    Chrome DevTools Protocol using Node's built-in WebSocket (Node >= 22)
 * If no browser is found, findBrowser() returns null and the E2E suite skips.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json'
};

function startServer(rootDir) {
  const root = path.resolve(rootDir);
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (urlPath === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok\n');
      return;
    }
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}/`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge'
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

function waitForDevtoolsUrl(proc) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('Browser did not start in time')), 20000);
    proc.stderr.on('data', (chunk) => {
      buf += chunk.toString();
      const m = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error('Browser exited early with code ' + code));
    });
  });
}

class Page {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener('message', (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method && this.listeners.has(msg.method)) {
        this.listeners.get(msg.method).splice(0).forEach((fn) => fn(msg.params));
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  once(method) {
    return new Promise((resolve) => {
      if (!this.listeners.has(method)) this.listeners.set(method, []);
      this.listeners.get(method).push(resolve);
    });
  }

  /** Run a function inside the page and return its (JSON-serialisable) result. */
  async run(fn, ...args) {
    const expression = `(${fn.toString()})(...${JSON.stringify(args)})`;
    const res = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) {
      const detail = res.exceptionDetails.exception && res.exceptionDetails.exception.description;
      throw new Error('Page error: ' + (detail || res.exceptionDetails.text));
    }
    return res.result.value;
  }

  async goto(url) {
    const loaded = this.once('Page.loadEventFired');
    await this.send('Page.navigate', { url });
    await loaded;
    await this.waitFor(() => document.documentElement.getAttribute('data-ready') === 'true');
  }

  async reload() {
    const loaded = this.once('Page.loadEventFired');
    await this.send('Page.reload', { ignoreCache: true });
    await loaded;
    await this.waitFor(() => document.documentElement.getAttribute('data-ready') === 'true');
  }

  async waitFor(fn, timeout = 5000) {
    const start = Date.now();
    for (;;) {
      if (await this.run(fn)) return;
      if (Date.now() - start > timeout) throw new Error('Timed out waiting for: ' + fn.toString());
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}

async function launchBrowser() {
  const executable = findBrowser();
  if (!executable) throw new Error('No Chromium-based browser found (set CHROME_PATH).');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'plodphai-e2e-'));
  const proc = spawn(executable, [
    '--headless=new',
    '--remote-debugging-port=0',
    '--user-data-dir=' + profile,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-extensions',
    '--window-size=1280,900',
    'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const browserWs = await waitForDevtoolsUrl(proc);
  const port = new URL(browserWs).port;
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  const page = new Page(ws);
  await page.send('Page.enable');
  await page.send('Runtime.enable');

  async function close() {
    try { ws.close(); } catch (e) { /* ignore */ }
    await new Promise((resolve) => {
      proc.once('exit', resolve);
      proc.kill();
      setTimeout(resolve, 3000);
    });
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch (e) { /* ignore */ }
  }

  return { page, close };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { startServer, findBrowser, launchBrowser, sleep };
