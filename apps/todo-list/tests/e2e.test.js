'use strict';

// Real-browser tests: serve the app locally and drive headless Chrome/Edge.
// Skipped automatically when no Chromium-based browser is installed.

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { startServer, findBrowser, launchBrowser, sleep } = require('./helpers/browser');

const STORAGE_KEY = 'plodphai.todo.tasks.v1';
const browserPath = findBrowser();

describe('Todo List in a real browser', { skip: browserPath ? false : 'no Chromium-based browser found (set CHROME_PATH)' }, () => {
  let server;
  let browser;
  let page;

  before(async () => {
    server = await startServer(path.join(__dirname, '..'));
    browser = await launchBrowser();
    page = browser.page;
    await page.goto(server.url);
    await page.run((key) => localStorage.removeItem(key), STORAGE_KEY);
    await page.reload();
  });

  after(async () => {
    if (browser) await browser.close();
    if (server) await server.close();
  });

  // ---- helpers executed in the page ----
  const counts = () => page.run(() => ({
    total: document.getElementById('stat-total').textContent,
    completed: document.getElementById('stat-completed').textContent,
    pending: document.getElementById('stat-pending').textContent
  }));
  const titles = () => page.run(() =>
    Array.from(document.querySelectorAll('#task-list .task-title')).map((n) => n.textContent));
  const stored = () => page.run((key) => JSON.parse(localStorage.getItem(key) || '[]'), STORAGE_KEY);
  const addTask = (fields) => page.run((f) => {
    const set = (id, v) => { if (v !== undefined) document.getElementById(id).value = v; };
    set('task-title', f.title);
    set('task-description', f.description);
    set('task-priority', f.priority);
    set('task-due', f.dueDate);
    document.getElementById('task-form').requestSubmit();
  }, fields);
  const clickInItem = (title, action) => page.run((t, a) => {
    const item = Array.from(document.querySelectorAll('#task-list .task-item'))
      .find((li) => li.querySelector('.task-title').textContent === t);
    item.querySelector(`[data-action="${a}"]`).click();
  }, title, action);

  test('page loads with required UI and an empty state', async () => {
    const info = await page.run(() => ({
      title: document.title,
      heading: !!document.querySelector('h1'),
      emptyVisible: !document.getElementById('empty-state').hidden,
      alertRendered: document.getElementById('storage-alert').getClientRects().length > 0,
      form: !!document.getElementById('task-form'),
      filters: document.querySelectorAll('.filter-tabs [data-filter]').length
    }));
    assert.equal(info.title, 'Plod Phai Todo');
    assert.ok(info.heading);
    assert.ok(info.emptyVisible);
    assert.equal(info.alertRendered, false, 'storage warning must not render on a clean start');
    assert.ok(info.form);
    assert.equal(info.filters, 3);
    assert.deepEqual(await counts(), { total: '0', completed: '0', pending: '0' });
  });

  test('blank titles are rejected with an inline error', async () => {
    await addTask({ title: '    ' });
    const res = await page.run(() => ({
      error: document.getElementById('task-title-error').textContent,
      invalid: document.getElementById('task-title').getAttribute('aria-invalid'),
      items: document.querySelectorAll('#task-list .task-item').length
    }));
    assert.match(res.error, /title/i);
    assert.equal(res.invalid, 'true');
    assert.equal(res.items, 0);
    assert.deepEqual(await stored(), []);
  });

  test('a valid task is created, trimmed, counted, and saved', async () => {
    await addTask({ title: '  Write report  ', description: 'Quarterly numbers', priority: 'high', dueDate: '2030-01-15' });
    assert.deepEqual(await titles(), ['Write report']);
    assert.deepEqual(await counts(), { total: '1', completed: '0', pending: '1' });
    const saved = await stored();
    assert.equal(saved.length, 1);
    assert.equal(saved[0].title, 'Write report');
    assert.equal(saved[0].priority, 'high');
    assert.equal(saved[0].dueDate, '2030-01-15');
    const ui = await page.run(() => ({
      formCleared: document.getElementById('task-title').value === '',
      errorCleared: document.getElementById('task-title-error').textContent === '',
      toast: document.getElementById('toast-region').textContent
    }));
    assert.ok(ui.formCleared);
    assert.ok(ui.errorCleared);
    assert.match(ui.toast, /Task added/);
  });

  test('user content is rendered as text, not HTML', async () => {
    await addTask({ title: '<img src=x id=injected>' });
    const res = await page.run(() => ({
      injected: !!document.getElementById('injected'),
      shown: Array.from(document.querySelectorAll('.task-title')).some((n) => n.textContent === '<img src=x id=injected>')
    }));
    assert.equal(res.injected, false);
    assert.equal(res.shown, true);
    await clickInItem('<img src=x id=injected>', 'delete');
    await page.run(() => document.getElementById('confirm-ok').click());
    await sleep(50);
  });

  test('tasks can be completed and marked pending again', async () => {
    await clickInItem('Write report', 'toggle');
    assert.deepEqual(await counts(), { total: '1', completed: '1', pending: '0' });
    const done = await page.run(() => document.querySelector('#task-list .task-item').classList.contains('is-done'));
    assert.ok(done);
    assert.equal((await stored())[0].completed, true);
    assert.equal(await page.run(() => document.getElementById('progress-text').textContent), '100%');
  });

  test('editing pre-fills the form, validates, and preserves status', async () => {
    await clickInItem('Write report', 'edit');
    const prefill = await page.run(() => ({
      open: document.getElementById('edit-dialog').open,
      title: document.getElementById('edit-title-input').value,
      priority: document.getElementById('edit-priority').value,
      due: document.getElementById('edit-due').value
    }));
    assert.deepEqual(prefill, { open: true, title: 'Write report', priority: 'high', due: '2030-01-15' });

    await page.run(() => {
      document.getElementById('edit-title-input').value = ' ';
      document.getElementById('edit-form').requestSubmit();
    });
    const stillOpen = await page.run(() => ({
      open: document.getElementById('edit-dialog').open,
      error: document.getElementById('edit-title-input-error').textContent
    }));
    assert.ok(stillOpen.open);
    assert.match(stillOpen.error, /title/i);

    await page.run(() => {
      document.getElementById('edit-title-input').value = 'Write final report';
      document.getElementById('edit-priority').value = 'low';
      document.getElementById('edit-form').requestSubmit();
    });
    assert.equal(await page.run(() => document.getElementById('edit-dialog').open), false);
    assert.deepEqual(await titles(), ['Write final report']);
    const saved = (await stored())[0];
    assert.equal(saved.title, 'Write final report');
    assert.equal(saved.priority, 'low');
    assert.equal(saved.completed, true, 'completion status must be preserved');
  });

  test('status filters and search combine correctly', async () => {
    await addTask({ title: 'Call the bank', description: 'Ask about statement' });
    await addTask({ title: 'Plan trip', description: 'Book report hotel' });
    assert.deepEqual(await counts(), { total: '3', completed: '1', pending: '2' });

    await page.run(() => document.querySelector('.filter-tabs [data-filter="pending"]').click());
    assert.deepEqual((await titles()).sort(), ['Call the bank', 'Plan trip']);

    await page.run(() => document.querySelector('.filter-tabs [data-filter="completed"]').click());
    assert.deepEqual(await titles(), ['Write final report']);

    await page.run(() => document.querySelector('.filter-tabs [data-filter="all"]').click());
    await page.run(() => {
      const s = document.getElementById('search-input');
      s.value = 'REPORT';
      s.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(250);
    assert.deepEqual((await titles()).sort(), ['Plan trip', 'Write final report']);

    await page.run(() => document.querySelector('.filter-tabs [data-filter="pending"]').click());
    assert.deepEqual(await titles(), ['Plan trip']);

    await page.run(() => {
      const s = document.getElementById('search-input');
      s.value = 'no-such-task';
      s.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(250);
    const empty = await page.run(() => ({
      hidden: document.getElementById('empty-state').hidden,
      title: document.getElementById('empty-title').textContent
    }));
    assert.equal(empty.hidden, false);
    assert.equal(empty.title, 'No matching tasks');

    // Reset via the empty-state action.
    await page.run(() => document.getElementById('empty-action').click());
    assert.equal((await titles()).length, 3);
  });

  test('sorting by priority and due date', async () => {
    await page.run(() => {
      const s = document.getElementById('sort-select');
      s.value = 'priority';
      s.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const prio = await titles();
    assert.equal(prio[prio.length - 1], 'Write final report', 'low priority sorts last');

    await page.run(() => {
      const s = document.getElementById('sort-select');
      s.value = 'due';
      s.dispatchEvent(new Event('change', { bubbles: true }));
    });
    assert.equal((await titles())[0], 'Write final report', 'only task with a due date sorts first');
  });

  test('delete asks for confirmation; cancel keeps the task', async () => {
    await clickInItem('Call the bank', 'delete');
    assert.equal(await page.run(() => document.getElementById('confirm-dialog').open), true);
    await page.run(() => document.querySelector('#confirm-dialog button[value="cancel"]').click());
    await sleep(50);
    assert.equal((await titles()).length, 3);

    await clickInItem('Call the bank', 'delete');
    await page.run(() => document.getElementById('confirm-ok').click());
    await sleep(50);
    assert.ok(!(await titles()).includes('Call the bank'));
    assert.deepEqual(await counts(), { total: '2', completed: '1', pending: '1' });
    assert.equal((await stored()).length, 2);
  });

  test('tasks persist across a page reload', async () => {
    await page.reload();
    assert.deepEqual((await titles()).sort(), ['Plan trip', 'Write final report']);
    assert.deepEqual(await counts(), { total: '2', completed: '1', pending: '1' });
  });

  test('sample tasks are not duplicated', async () => {
    await page.run(() => document.getElementById('sample-btn').click());
    const after1 = (await stored()).length;
    assert.ok(after1 > 2);
    await page.run(() => document.getElementById('sample-btn').click());
    assert.equal((await stored()).length, after1);
  });

  test('clear all requires confirmation and empties storage', async () => {
    await page.run(() => document.getElementById('clear-btn').click());
    await page.run(() => document.getElementById('confirm-ok').click());
    await sleep(50);
    assert.deepEqual(await counts(), { total: '0', completed: '0', pending: '0' });
    assert.deepEqual(await stored(), []);
    assert.equal(await page.run(() => document.getElementById('empty-title').textContent), 'No tasks yet');
  });

  test('malformed stored data does not crash initialisation', async () => {
    await page.run((key) => localStorage.setItem(key, '{this is not json'), STORAGE_KEY);
    await page.reload();
    const res = await page.run(() => ({
      alertShown: document.getElementById('storage-alert').getClientRects().length > 0,
      total: document.getElementById('stat-total').textContent
    }));
    assert.equal(res.alertShown, true);
    assert.equal(res.total, '0');
    // The app still works after recovering.
    await addTask({ title: 'Recovered task' });
    assert.deepEqual(await titles(), ['Recovered task']);

    await page.run((key) => localStorage.setItem(key, JSON.stringify([{ title: 'Valid', priority: 'low' }, { nope: true }])), STORAGE_KEY);
    await page.reload();
    assert.deepEqual(await titles(), ['Valid']);
  });
});
