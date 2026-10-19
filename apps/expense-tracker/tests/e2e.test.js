'use strict';

// Real-browser tests: serve the app locally and drive headless Chrome/Edge.
// Skipped automatically when no Chromium-based browser is installed.

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { startServer, findBrowser, launchBrowser, sleep } = require('./helpers/browser');

const STORAGE_KEY = 'plodphai.expense.transactions.v1';
const browserPath = findBrowser();

// Normalise formatted currency for comparison (strip NBSP etc.).
const norm = (s) => s.replace(/\s+/g, '');

describe('Expense Tracker in a real browser', { skip: browserPath ? false : 'no Chromium-based browser found (set CHROME_PATH)' }, () => {
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

  const totals = async () => {
    const t = await page.run(() => ({
      income: document.getElementById('sum-income').textContent,
      expense: document.getElementById('sum-expense').textContent,
      balance: document.getElementById('sum-balance').textContent
    }));
    return { income: norm(t.income), expense: norm(t.expense), balance: norm(t.balance) };
  };
  const titles = () => page.run(() =>
    Array.from(document.querySelectorAll('#tx-list .tx-title')).map((n) => n.textContent));
  const stored = () => page.run((key) => JSON.parse(localStorage.getItem(key) || '[]'), STORAGE_KEY);
  const breakdown = () => page.run(() =>
    Array.from(document.querySelectorAll('#breakdown-list .bd-row')).map((r) => [
      r.getAttribute('data-category'),
      r.querySelector('strong').textContent.replace(/\s+/g, ''),
      r.querySelector('.bd-pct').textContent
    ]));
  const fill = (f) => page.run((v) => {
    const radio = document.querySelector(`#tx-form input[name="type"][value="${v.type || 'expense'}"]`);
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
    const set = (id, val) => { if (val !== undefined) document.getElementById(id).value = val; };
    set('tx-title', v.title);
    set('tx-amount', v.amount);
    set('tx-category', v.category);
    set('tx-date', v.date);
    set('tx-notes', v.notes);
    document.getElementById('tx-form').requestSubmit();
  }, f);
  const clickRow = (title, action) => page.run((t, a) => {
    const row = Array.from(document.querySelectorAll('#tx-list .tx-item'))
      .find((li) => li.querySelector('.tx-title').textContent === t);
    row.querySelector(`[data-action="${a}"]`).click();
  }, title, action);
  const setFilter = (id, value, evt = 'change') => page.run((i, v, e) => {
    const n = document.getElementById(i);
    n.value = v;
    n.dispatchEvent(new Event(e, { bubbles: true }));
  }, id, value, evt);

  test('page loads with required UI, zero totals, and empty states', async () => {
    const info = await page.run(() => ({
      title: document.title,
      empty: !document.getElementById('empty-state').hidden,
      breakdownEmpty: !document.getElementById('breakdown-empty').hidden,
      alertRendered: document.getElementById('storage-alert').getClientRects().length > 0,
      chart: !!document.querySelector('#monthly-chart svg'),
      categories: document.getElementById('tx-category').options.length,
      dateDefault: document.getElementById('tx-date').value
    }));
    assert.equal(info.title, 'Plod Phai Expense Tracker');
    assert.ok(info.empty);
    assert.ok(info.breakdownEmpty);
    assert.equal(info.alertRendered, false);
    assert.ok(info.chart);
    assert.equal(info.categories, 8, 'expense categories by default');
    assert.match(info.dateDefault, /^\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual(await totals(), { income: '฿0.00', expense: '฿0.00', balance: '฿0.00' });
  });

  test('invalid amounts and empty titles are rejected', async () => {
    for (const amount of ['', '-50', '0', 'abc', '1.234']) {
      await fill({ title: 'Bad', amount, category: 'food', date: '2026-10-01' });
      const err = await page.run(() => document.getElementById('tx-amount-error').textContent);
      assert.ok(err.length > 0, 'expected an error for amount ' + JSON.stringify(amount));
    }
    await fill({ title: '   ', amount: '10', category: 'food', date: '2026-10-01' });
    assert.match(await page.run(() => document.getElementById('tx-title-error').textContent), /title/i);
    assert.deepEqual(await stored(), []);
    assert.deepEqual(await titles(), []);
  });

  test('category list follows the selected type', async () => {
    const opts = await page.run(() => {
      const r = document.querySelector('#tx-form input[value="income"]');
      r.checked = true;
      r.dispatchEvent(new Event('change', { bubbles: true }));
      return Array.from(document.getElementById('tx-category').options).map((o) => o.value);
    });
    assert.deepEqual(opts, ['salary', 'freelance', 'investment', 'other-income']);
  });

  test('income and expense transactions are created and totals are exact', async () => {
    await fill({ type: 'income', title: 'Salary', amount: '45,000', category: 'salary', date: '2026-10-01', notes: 'October payroll' });
    await fill({ type: 'expense', title: 'Rent', amount: '12000', category: 'bills', date: '2026-10-03' });
    await fill({ type: 'expense', title: 'Coffee', amount: '0.10', category: 'food', date: '2026-10-04' });
    await fill({ type: 'expense', title: 'Snack', amount: '0.20', category: 'food', date: '2026-10-05' });

    assert.deepEqual(await totals(), { income: '฿45,000.00', expense: '฿12,000.30', balance: '฿32,999.70' });
    const saved = await stored();
    assert.equal(saved.length, 4);
    assert.deepEqual(saved.map((t) => t.amountSatang), [4500000, 1200000, 10, 20]);
    assert.equal(saved[0].notes, 'October payroll');
    assert.match(await page.run(() => document.getElementById('toast-region').textContent), /Added/);
    const row = await page.run(() => {
      const li = document.querySelector('#tx-list .tx-income');
      return { amount: li.querySelector('.tx-amount').textContent.replace(/\s+/g, ''), label: li.querySelector('.type-label').textContent };
    });
    assert.deepEqual(row, { amount: '+฿45,000.00', label: 'Income' });
  });

  test('user content is rendered as text, not HTML', async () => {
    await fill({ title: '<img src=x id=pwn>', amount: '1', category: 'food', date: '2026-10-06', notes: '<b id=bold>x</b>' });
    const res = await page.run(() => ({
      injected: !!document.getElementById('pwn') || !!document.getElementById('bold'),
      shown: Array.from(document.querySelectorAll('.tx-title')).some((n) => n.textContent === '<img src=x id=pwn>')
    }));
    assert.equal(res.injected, false);
    assert.equal(res.shown, true);
    await clickRow('<img src=x id=pwn>', 'delete');
    await page.run(() => document.getElementById('confirm-ok').click());
    await sleep(50);
    assert.equal((await stored()).length, 4);
  });

  test('chart reflects stored data and updates on change', async () => {
    assert.deepEqual(await breakdown(), [['bills', '฿12,000.00', '100.0%'], ['food', '฿0.30', '0.0%']]);
    const table = await page.run(() => Array.from(document.querySelectorAll('#monthly-table tr')).length);
    assert.equal(table, 6);
    await fill({ type: 'expense', title: 'Groceries', amount: '12000', category: 'food', date: '2026-10-07' });
    const rows = await breakdown();
    assert.equal(rows[0][2], '50.0%');
    assert.equal(rows.length, 2);
  });

  test('editing pre-fills the form and updates totals', async () => {
    await clickRow('Rent', 'edit');
    const pre = await page.run(() => ({
      title: document.getElementById('tx-title').value,
      amount: document.getElementById('tx-amount').value,
      category: document.getElementById('tx-category').value,
      date: document.getElementById('tx-date').value,
      type: document.querySelector('#tx-form input[name="type"]:checked').value,
      heading: document.getElementById('form-title-text').textContent,
      cancelVisible: !document.getElementById('cancel-edit').hidden
    }));
    assert.deepEqual(pre, { title: 'Rent', amount: '12000.00', category: 'bills', date: '2026-10-03', type: 'expense', heading: 'Edit transaction', cancelVisible: true });

    await page.run(() => { document.getElementById('tx-amount').value = '-1'; document.getElementById('tx-form').requestSubmit(); });
    assert.ok((await page.run(() => document.getElementById('tx-amount-error').textContent)).length > 0);
    assert.equal((await stored()).find((t) => t.title === 'Rent').amountSatang, 1200000, 'invalid edit must not save');

    await page.run(() => { document.getElementById('tx-amount').value = '10000'; document.getElementById('tx-form').requestSubmit(); });
    assert.deepEqual(await totals(), { income: '฿45,000.00', expense: '฿22,000.30', balance: '฿22,999.70' });
    assert.equal((await stored()).length, 5, 'edit must not create a new transaction');
    assert.equal(await page.run(() => document.getElementById('form-title-text').textContent), 'Add transaction');
  });

  test('filters combine and sorting works', async () => {
    await page.run(() => document.querySelector('.segmented [data-type="expense"]').click());
    assert.ok(!(await titles()).includes('Salary'));
    const catOptions = await page.run(() => Array.from(document.getElementById('f-category').options).map((o) => o.value));
    assert.ok(!catOptions.includes('salary'), 'category filter follows type filter');

    await setFilter('f-category', 'food');
    assert.deepEqual((await titles()).sort(), ['Coffee', 'Groceries', 'Snack']);
    assert.deepEqual((await breakdown()).map((r) => r[0]), ['food'], 'chart follows filters');

    await setFilter('f-from', '2026-10-05');
    assert.deepEqual((await titles()).sort(), ['Groceries', 'Snack']);

    await setFilter('f-search', 'snack', 'input');
    await sleep(250);
    assert.deepEqual(await titles(), ['Snack']);

    await setFilter('f-search', 'zzz', 'input');
    await sleep(250);
    assert.equal(await page.run(() => document.getElementById('empty-title').textContent), 'No matching transactions');

    await page.run(() => document.getElementById('reset-filters').click());
    assert.equal((await titles()).length, 5);

    await setFilter('f-sort', 'highest');
    assert.equal((await titles())[0], 'Salary');
    await setFilter('f-sort', 'lowest');
    assert.equal((await titles())[0], 'Coffee');
    await setFilter('f-sort', 'oldest');
    assert.equal((await titles())[0], 'Salary');
    await setFilter('f-sort', 'newest');
    assert.equal((await titles())[0], 'Groceries');

    await setFilter('f-from', '2026-10-10');
    await setFilter('f-to', '2026-10-01');
    assert.match(await page.run(() => document.getElementById('f-range-error').textContent), /From/);
    await page.run(() => document.getElementById('reset-filters').click());
  });

  test('delete asks for confirmation and updates totals', async () => {
    await clickRow('Groceries', 'delete');
    await page.run(() => document.querySelector('#confirm-dialog button[value="cancel"]').click());
    await sleep(50);
    assert.equal((await titles()).length, 5);

    await clickRow('Groceries', 'delete');
    await page.run(() => document.getElementById('confirm-ok').click());
    await sleep(50);
    assert.equal((await titles()).length, 4);
    assert.deepEqual(await totals(), { income: '฿45,000.00', expense: '฿10,000.30', balance: '฿34,999.70' });
  });

  test('data persists across reload', async () => {
    await page.reload();
    assert.equal((await titles()).length, 4);
    assert.deepEqual(await totals(), { income: '฿45,000.00', expense: '฿10,000.30', balance: '฿34,999.70' });
  });

  test('sample data loads once only', async () => {
    await page.run(() => document.getElementById('sample-btn').click());
    const n = (await stored()).length;
    assert.ok(n > 10);
    await page.run(() => document.getElementById('sample-btn').click());
    assert.equal((await stored()).length, n);
  });

  test('clear all requires confirmation', async () => {
    await page.run(() => document.getElementById('clear-btn').click());
    await page.run(() => document.querySelector('#confirm-dialog button[value="cancel"]').click());
    await sleep(50);
    assert.ok((await stored()).length > 0);
    await page.run(() => document.getElementById('clear-btn').click());
    await page.run(() => document.getElementById('confirm-ok').click());
    await sleep(50);
    assert.deepEqual(await stored(), []);
    assert.deepEqual(await totals(), { income: '฿0.00', expense: '฿0.00', balance: '฿0.00' });
  });

  test('malformed stored data does not crash initialisation', async () => {
    await page.run((key) => localStorage.setItem(key, '[{"title": broken'), STORAGE_KEY);
    await page.reload();
    const res = await page.run(() => ({
      alert: document.getElementById('storage-alert').getClientRects().length > 0,
      rows: document.querySelectorAll('#tx-list .tx-item').length
    }));
    assert.deepEqual(res, { alert: true, rows: 0 });
    await fill({ title: 'After recovery', amount: '5', category: 'food', date: '2026-10-01' });
    assert.deepEqual(await titles(), ['After recovery']);
  });
});
