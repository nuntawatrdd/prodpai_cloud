'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../js/core.js');

function memoryStorage(initial) {
  const data = Object.assign({}, initial);
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; }
  };
}

const base = { title: 'Lunch', type: 'expense', amount: '120', category: 'food', date: '2026-10-05', notes: '' };
function tx(over, now) {
  const r = Core.createTransaction(Object.assign({}, base, over), now);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  return r.transaction;
}

describe('amount parsing (integer satang)', () => {
  test('accepts valid positive amounts', () => {
    assert.deepEqual(Core.parseAmount('120'), { ok: true, satang: 12000 });
    assert.deepEqual(Core.parseAmount('0.1'), { ok: true, satang: 10 });
    assert.deepEqual(Core.parseAmount('19.99'), { ok: true, satang: 1999 });
    assert.deepEqual(Core.parseAmount(' 1,250.50 '), { ok: true, satang: 125050 });
    assert.deepEqual(Core.parseAmount('฿45000'), { ok: true, satang: 4500000 });
    assert.deepEqual(Core.parseAmount('99999999.99'), { ok: true, satang: 9999999999 });
  });

  test('rejects invalid, zero, negative, and over-precise amounts', () => {
    for (const bad of ['', '   ', 'abc', '-5', '0', '0.00', '1.234', '1e5', 'NaN', 'Infinity', '12..5', '100000000', '.5', null, undefined]) {
      const r = Core.parseAmount(bad);
      assert.equal(r.ok, false, 'should reject ' + JSON.stringify(bad));
      assert.ok(r.error);
    }
  });

  test('satang round-trips to input text', () => {
    assert.equal(Core.satangToInput(125050), '1250.50');
    assert.equal(Core.satangToInput(5), '0.05');
  });

  test('THB formatting', () => {
    assert.match(Core.formatTHB(125050), /^฿1,250\.50$/);
    assert.match(Core.formatTHB(-500), /^−฿5\.00$/);
    assert.match(Core.formatTHB(500, { sign: true }), /^\+฿5\.00$/);
    assert.match(Core.formatTHB(0, { sign: true }), /^฿0\.00$/);
  });
});

describe('validation', () => {
  test('rejects empty title and invalid amount with field errors', () => {
    const r = Core.createTransaction(Object.assign({}, base, { title: '  ', amount: '-3' }));
    assert.equal(r.ok, false);
    assert.ok(r.errors.title);
    assert.ok(r.errors.amount);
  });

  test('requires type, category, and a real date', () => {
    assert.ok(Core.createTransaction(Object.assign({}, base, { type: 'gift' })).errors.type);
    assert.ok(Core.createTransaction(Object.assign({}, base, { category: '' })).errors.category);
    assert.ok(Core.createTransaction(Object.assign({}, base, { date: '' })).errors.date);
    assert.ok(Core.createTransaction(Object.assign({}, base, { date: '2026-02-30' })).errors.date);
  });

  test('category must match the transaction type', () => {
    const r = Core.createTransaction(Object.assign({}, base, { type: 'income', category: 'food' }));
    assert.equal(r.ok, false);
    assert.match(r.errors.category, /match/);
    assert.equal(Core.createTransaction(Object.assign({}, base, { type: 'income', category: 'salary' })).ok, true);
  });

  test('trims fields and stores integer satang', () => {
    const t = tx({ title: '  Coffee ', amount: '65.5', notes: ' oat milk ' });
    assert.equal(t.title, 'Coffee');
    assert.equal(t.notes, 'oat milk');
    assert.equal(t.amountSatang, 6550);
    assert.ok(Number.isInteger(t.amountSatang));
  });
});

describe('summaries', () => {
  test('income, expenses, and balance are exact', () => {
    // 0.1 + 0.2 style values would drift with floats; satang sums are exact.
    const list = [
      tx({ type: 'income', category: 'salary', amount: '0.10' }),
      tx({ type: 'income', category: 'freelance', amount: '0.20' }),
      tx({ amount: '0.30' }),
      tx({ amount: '1000.05' })
    ];
    assert.deepEqual(Core.summarize(list), { income: 30, expense: 100035, balance: -100005, count: 4 });
    assert.deepEqual(Core.summarize([]), { income: 0, expense: 0, balance: 0, count: 0 });
  });

  test('many small amounts sum without floating-point error', () => {
    const list = Array.from({ length: 1000 }, () => tx({ type: 'income', category: 'other-income', amount: '0.01' }));
    assert.equal(Core.summarize(list).income, 1000);
  });

  test('category breakdown ranks expenses with percentages', () => {
    const list = [
      tx({ category: 'food', amount: '300' }),
      tx({ category: 'food', amount: '100' }),
      tx({ category: 'bills', amount: '600' }),
      tx({ type: 'income', category: 'salary', amount: '5000' })
    ];
    const rows = Core.categoryBreakdown(list, 'expense');
    assert.deepEqual(rows.map((r) => [r.category, r.satang, r.percent]), [['bills', 60000, 60], ['food', 40000, 40]]);
    assert.equal(rows[0].label, 'Bills');
    assert.deepEqual(Core.categoryBreakdown([], 'expense'), []);
  });

  test('monthly totals bucket by calendar month', () => {
    const list = [
      tx({ date: '2026-10-01', amount: '100' }),
      tx({ date: '2026-10-31', type: 'income', category: 'salary', amount: '500' }),
      tx({ date: '2026-08-15', amount: '50' }),
      tx({ date: '2026-01-01', amount: '999' }) // outside 6-month window
    ];
    const months = Core.monthlyTotals(list, new Date(2026, 9, 19), 6);
    assert.deepEqual(months.map((m) => m.key), ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    assert.deepEqual(months[5], { key: '2026-10', year: 2026, month: 9, income: 50000, expense: 10000 });
    assert.equal(months[3].expense, 5000);
    assert.equal(months.reduce((s, m) => s + m.expense, 0), 15000);
  });
});

describe('edit and delete', () => {
  test('update keeps id and createdAt, validates input', () => {
    const t = tx();
    const r = Core.updateTransaction(t, Object.assign({}, base, { amount: '250', title: 'Dinner' }));
    assert.equal(r.ok, true);
    assert.equal(r.transaction.id, t.id);
    assert.equal(r.transaction.createdAt, t.createdAt);
    assert.equal(r.transaction.amountSatang, 25000);
    assert.equal(Core.updateTransaction(t, Object.assign({}, base, { amount: 'oops' })).ok, false);
  });

  test('replace and remove', () => {
    const a = tx({ title: 'A' });
    const b = tx({ title: 'B' });
    const edited = Object.assign({}, a, { title: 'A2' });
    assert.deepEqual(Core.replaceTransaction([a, b], edited).map((t) => t.title), ['A2', 'B']);
    assert.deepEqual(Core.removeTransaction([a, b], a.id).map((t) => t.title), ['B']);
  });
});

describe('filters and sorting', () => {
  const t0 = new Date('2026-10-01T00:00:00Z').getTime();
  const list = [
    tx({ title: 'Salary', type: 'income', category: 'salary', amount: '45000', date: '2026-10-01', notes: 'payroll' }, new Date(t0)),
    tx({ title: 'Rent', category: 'bills', amount: '12000', date: '2026-10-03' }, new Date(t0 + 1000)),
    tx({ title: 'Noodles', category: 'food', amount: '60', date: '2026-09-20', notes: 'late night PAYROLL celebration' }, new Date(t0 + 2000)),
    tx({ title: 'Bus', category: 'transportation', amount: '15', date: '2026-10-03' }, new Date(t0 + 3000))
  ];
  const titles = (arr) => arr.map((t) => t.title);

  test('type, category, date range, and search filters', () => {
    assert.deepEqual(titles(Core.filterTransactions(list, { type: 'income' })), ['Salary']);
    assert.equal(Core.filterTransactions(list, { type: 'expense' }).length, 3);
    assert.deepEqual(titles(Core.filterTransactions(list, { category: 'food' })), ['Noodles']);
    assert.deepEqual(titles(Core.filterTransactions(list, { from: '2026-10-02', to: '2026-10-03' })), ['Rent', 'Bus']);
    assert.deepEqual(titles(Core.filterTransactions(list, { query: 'payroll' })), ['Salary', 'Noodles']);
  });

  test('filters combine', () => {
    assert.deepEqual(titles(Core.filterTransactions(list, { type: 'expense', query: 'payroll' })), ['Noodles']);
    assert.deepEqual(Core.filterTransactions(list, { type: 'income', category: 'food' }), []);
    assert.deepEqual(titles(Core.filterTransactions(list, { type: 'expense', from: '2026-10-01', query: 'b' })), ['Bus']);
  });

  test('invalid date filter values are ignored', () => {
    assert.equal(Core.filterTransactions(list, { from: 'garbage' }).length, 4);
  });

  test('sort modes', () => {
    assert.deepEqual(titles(Core.sortTransactions(list, 'newest')), ['Bus', 'Rent', 'Salary', 'Noodles']);
    assert.deepEqual(titles(Core.sortTransactions(list, 'oldest')), ['Noodles', 'Salary', 'Rent', 'Bus']);
    assert.deepEqual(titles(Core.sortTransactions(list, 'highest')), ['Salary', 'Rent', 'Noodles', 'Bus']);
    assert.deepEqual(titles(Core.sortTransactions(list, 'lowest')), ['Bus', 'Noodles', 'Rent', 'Salary']);
  });
});

describe('persistence', () => {
  test('round-trip', () => {
    const storage = memoryStorage();
    const list = [tx(), tx({ type: 'income', category: 'salary', amount: '1.01' })];
    assert.equal(Core.saveTransactions(storage, list), true);
    assert.deepEqual(Core.loadTransactions(storage), { transactions: list, recovered: false });
  });

  test('malformed data never throws', () => {
    for (const raw of ['{bad', '{}', '"x"', '7', 'null']) {
      const r = Core.loadTransactions(memoryStorage({ [Core.STORAGE_KEY]: raw }));
      assert.deepEqual(r.transactions, []);
      assert.equal(r.recovered, true, raw);
    }
    assert.deepEqual(Core.loadTransactions(memoryStorage()), { transactions: [], recovered: false });
  });

  test('invalid records are dropped (negative, float, wrong category)', () => {
    const good = tx();
    const raw = JSON.stringify([
      good,
      Object.assign({}, good, { id: 'neg', amountSatang: -100 }),
      Object.assign({}, good, { id: 'float', amountSatang: 10.5 }),
      Object.assign({}, good, { id: 'cat', type: 'income' }),
      Object.assign({}, good, { id: 'str', amountSatang: '100' }),
      'nope'
    ]);
    const r = Core.loadTransactions(memoryStorage({ [Core.STORAGE_KEY]: raw }));
    assert.equal(r.recovered, true);
    assert.deepEqual(r.transactions.map((t) => t.id), [good.id]);
  });

  test('throwing storage handled', () => {
    const broken = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
    assert.deepEqual(Core.loadTransactions(broken), { transactions: [], recovered: true });
    assert.equal(Core.saveTransactions(broken, []), false);
  });
});

describe('sample data', () => {
  test('is valid, never in the future, and not duplicated', () => {
    const now = new Date(2026, 9, 3); // early in the month: days must be clamped
    const first = Core.addSampleTransactions([], now);
    assert.ok(first.added >= 10);
    const today = Core.toISODate(now);
    for (const t of first.transactions) {
      assert.ok(t.date <= today, 'sample in future: ' + t.date);
      assert.equal(Core.categoryType(t.category), t.type);
    }
    assert.equal(Core.addSampleTransactions(first.transactions, now).added, 0);
    const storage = memoryStorage();
    Core.saveTransactions(storage, first.transactions);
    assert.equal(Core.addSampleTransactions(Core.loadTransactions(storage).transactions, now).added, 0);
  });
});
