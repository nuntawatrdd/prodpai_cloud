/*
 * Expense Tracker — pure logic (no DOM access).
 * Money is stored as integer satang (1 THB = 100 satang) so that sums are
 * exact; values are only converted to baht for display.
 * Loaded as a classic script in the browser (exposes window.ExpenseCore)
 * and as a CommonJS module by the Node test runner.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ExpenseCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STORAGE_KEY = 'plodphai.expense.transactions.v1';
  var TITLE_MAX = 80;
  var NOTES_MAX = 300;
  var MAX_SATANG = 9999999999; // ฿99,999,999.99
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  var AMOUNT_RE = /^\d+(?:\.\d{1,2})?$/;
  var TYPES = ['income', 'expense'];

  var CATEGORIES = {
    income: [
      { id: 'salary', label: 'Salary' },
      { id: 'freelance', label: 'Freelance' },
      { id: 'investment', label: 'Investment' },
      { id: 'other-income', label: 'Other income' }
    ],
    expense: [
      { id: 'food', label: 'Food' },
      { id: 'transportation', label: 'Transportation' },
      { id: 'shopping', label: 'Shopping' },
      { id: 'bills', label: 'Bills' },
      { id: 'entertainment', label: 'Entertainment' },
      { id: 'healthcare', label: 'Healthcare' },
      { id: 'education', label: 'Education' },
      { id: 'other-expense', label: 'Other expense' }
    ]
  };

  var CATEGORY_INDEX = {};
  TYPES.forEach(function (type) {
    CATEGORIES[type].forEach(function (c) {
      CATEGORY_INDEX[c.id] = { id: c.id, label: c.label, type: type };
    });
  });

  function categoryLabel(id) {
    return CATEGORY_INDEX[id] ? CATEGORY_INDEX[id].label : id;
  }

  function categoryType(id) {
    return CATEGORY_INDEX[id] ? CATEGORY_INDEX[id].type : null;
  }

  function isValidDateString(value) {
    if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
    var parts = value.split('-').map(Number);
    var d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    return d.getUTCFullYear() === parts[0] &&
      d.getUTCMonth() === parts[1] - 1 &&
      d.getUTCDate() === parts[2];
  }

  function toISODate(date) {
    var m = String(date.getMonth() + 1).padStart(2, '0');
    var d = String(date.getDate()).padStart(2, '0');
    return date.getFullYear() + '-' + m + '-' + d;
  }

  function generateId() {
    var c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    return 'x-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function cleanText(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  /**
   * Parse a user-entered baht amount ("1,250.5", "฿99", "100.25") into
   * integer satang using string arithmetic (no floating point).
   */
  function parseAmount(value) {
    if (typeof value === 'number') {
      value = Number.isFinite(value) ? String(value) : '';
    }
    var text = cleanText(value).replace(/[฿,\s]/g, '');
    if (!text) return { ok: false, error: 'Please enter an amount.' };
    if (!AMOUNT_RE.test(text)) {
      return { ok: false, error: 'Enter a positive number with up to 2 decimal places.' };
    }
    var parts = text.split('.');
    var whole = parts[0].replace(/^0+(?=\d)/, '');
    if (whole.length > 8) return { ok: false, error: 'Amount must be ฿99,999,999.99 or less.' };
    var fraction = ((parts[1] || '') + '00').slice(0, 2);
    var satang = Number(whole) * 100 + Number(fraction);
    if (satang <= 0) return { ok: false, error: 'Amount must be greater than zero.' };
    if (satang > MAX_SATANG) return { ok: false, error: 'Amount must be ฿99,999,999.99 or less.' };
    return { ok: true, satang: satang };
  }

  /** Satang -> plain decimal string for form inputs, e.g. 125050 -> "1250.50". */
  function satangToInput(satang) {
    var whole = Math.floor(satang / 100);
    var frac = String(satang % 100).padStart(2, '0');
    return whole + '.' + frac;
  }

  var formatter = null;
  function formatTHB(satang, opts) {
    if (!formatter) {
      try {
        formatter = new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', minimumFractionDigits: 2, maximumFractionDigits: 2 });
      } catch (e) {
        formatter = { format: function (n) { return '฿' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); } };
      }
    }
    var abs = Math.abs(satang);
    var text = formatter.format(abs / 100);
    var sign = '';
    if (opts && opts.sign && satang !== 0) sign = satang > 0 ? '+' : '−';
    else if (satang < 0) sign = '−';
    return sign + text;
  }

  /** Validate raw form input. Returns { valid, errors, value }. */
  function validateTransactionInput(input) {
    input = input || {};
    var errors = {};
    var title = cleanText(input.title);
    var type = cleanText(input.type).toLowerCase();
    var category = cleanText(input.category);
    var date = cleanText(input.date);
    var notes = cleanText(input.notes);
    var amountSatang = null;

    if (!title) errors.title = 'Please enter a title.';
    else if (title.length > TITLE_MAX) errors.title = 'Title must be ' + TITLE_MAX + ' characters or fewer.';

    if (TYPES.indexOf(type) === -1) errors.type = 'Choose Income or Expense.';

    var amount = input.amountSatang !== undefined && input.amount === undefined
      ? (Number.isInteger(input.amountSatang) && input.amountSatang > 0 && input.amountSatang <= MAX_SATANG
        ? { ok: true, satang: input.amountSatang }
        : { ok: false, error: 'Amount must be greater than zero.' })
      : parseAmount(input.amount);
    if (amount.ok) amountSatang = amount.satang;
    else errors.amount = amount.error;

    if (!category) errors.category = 'Choose a category.';
    else if (!errors.type && categoryType(category) !== type) errors.category = 'Choose a category that matches the transaction type.';

    if (!date) errors.date = 'Choose a date.';
    else if (!isValidDateString(date)) errors.date = 'Enter a valid date (YYYY-MM-DD).';

    if (notes.length > NOTES_MAX) errors.notes = 'Notes must be ' + NOTES_MAX + ' characters or fewer.';

    return {
      valid: Object.keys(errors).length === 0,
      errors: errors,
      value: { title: title, type: type, amountSatang: amountSatang, category: category, date: date, notes: notes }
    };
  }

  function createTransaction(input, now) {
    var result = validateTransactionInput(input);
    if (!result.valid) return { ok: false, errors: result.errors };
    var stamp = (now || new Date()).toISOString();
    return {
      ok: true,
      transaction: Object.assign({ id: generateId() }, result.value, { createdAt: stamp, updatedAt: stamp })
    };
  }

  function updateTransaction(tx, input, now) {
    var result = validateTransactionInput(input);
    if (!result.valid) return { ok: false, errors: result.errors };
    return {
      ok: true,
      transaction: Object.assign({}, tx, result.value, { updatedAt: (now || new Date()).toISOString() })
    };
  }

  function replaceTransaction(list, updated) {
    return list.map(function (t) { return t.id === updated.id ? updated : t; });
  }

  function removeTransaction(list, id) {
    return list.filter(function (t) { return t.id !== id; });
  }

  /** Totals in satang: { income, expense, balance, count }. */
  function summarize(list) {
    var income = 0;
    var expense = 0;
    list.forEach(function (t) {
      if (t.type === 'income') income += t.amountSatang;
      else if (t.type === 'expense') expense += t.amountSatang;
    });
    return { income: income, expense: expense, balance: income - expense, count: list.length };
  }

  /**
   * filters: { type: 'all'|'income'|'expense', category: 'all'|id,
   *            from: 'YYYY-MM-DD'|'', to: 'YYYY-MM-DD'|'', query: string }
   */
  function filterTransactions(list, filters) {
    filters = filters || {};
    var type = filters.type || 'all';
    var category = filters.category || 'all';
    var from = isValidDateString(filters.from) ? filters.from : '';
    var to = isValidDateString(filters.to) ? filters.to : '';
    var q = cleanText(filters.query).toLowerCase();
    return list.filter(function (t) {
      if (type !== 'all' && t.type !== type) return false;
      if (category !== 'all' && t.category !== category) return false;
      if (from && t.date < from) return false;
      if (to && t.date > to) return false;
      if (q && t.title.toLowerCase().indexOf(q) === -1 && (t.notes || '').toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }

  function newestFirst(a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
  }

  /** mode: 'newest' | 'oldest' | 'highest' | 'lowest'. Returns a new array. */
  function sortTransactions(list, mode) {
    var copy = list.slice();
    switch (mode) {
      case 'oldest':
        return copy.sort(function (a, b) { return -newestFirst(a, b); });
      case 'highest':
        return copy.sort(function (a, b) { return (b.amountSatang - a.amountSatang) || newestFirst(a, b); });
      case 'lowest':
        return copy.sort(function (a, b) { return (a.amountSatang - b.amountSatang) || newestFirst(a, b); });
      default:
        return copy.sort(newestFirst);
    }
  }

  /** Per-category totals for one type, largest first, with share in percent (1 dp). */
  function categoryBreakdown(list, type) {
    type = type || 'expense';
    var totals = {};
    var grand = 0;
    list.forEach(function (t) {
      if (t.type !== type) return;
      totals[t.category] = (totals[t.category] || 0) + t.amountSatang;
      grand += t.amountSatang;
    });
    return Object.keys(totals).map(function (id) {
      return {
        category: id,
        label: categoryLabel(id),
        satang: totals[id],
        percent: grand ? Math.round((totals[id] * 1000) / grand) / 10 : 0
      };
    }).sort(function (a, b) { return b.satang - a.satang || (a.label < b.label ? -1 : 1); });
  }

  /** Income/expense totals for the `months` calendar months ending at endDate. */
  function monthlyTotals(list, endDate, months) {
    months = months || 6;
    var end = endDate || new Date();
    var buckets = [];
    var index = {};
    for (var i = months - 1; i >= 0; i--) {
      var d = new Date(end.getFullYear(), end.getMonth() - i, 1);
      var key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      var bucket = { key: key, year: d.getFullYear(), month: d.getMonth(), income: 0, expense: 0 };
      index[key] = bucket;
      buckets.push(bucket);
    }
    list.forEach(function (t) {
      var b = index[t.date.slice(0, 7)];
      if (!b) return;
      if (t.type === 'income') b.income += t.amountSatang;
      else if (t.type === 'expense') b.expense += t.amountSatang;
    });
    return buckets;
  }

  function sanitizeStoredTransaction(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var check = validateTransactionInput({
      title: raw.title,
      type: raw.type,
      amountSatang: raw.amountSatang,
      category: raw.category,
      date: raw.date,
      notes: typeof raw.notes === 'string' ? raw.notes : ''
    });
    if (!check.valid) return null;
    var createdAt = typeof raw.createdAt === 'string' && !isNaN(Date.parse(raw.createdAt))
      ? raw.createdAt : new Date(0).toISOString();
    var tx = Object.assign({ id: typeof raw.id === 'string' && raw.id ? raw.id : generateId() }, check.value, {
      createdAt: createdAt,
      updatedAt: typeof raw.updatedAt === 'string' && !isNaN(Date.parse(raw.updatedAt)) ? raw.updatedAt : createdAt
    });
    if (typeof raw.sampleKey === 'string') tx.sampleKey = raw.sampleKey;
    return tx;
  }

  /** Read transactions from a Storage-like object. Never throws. */
  function loadTransactions(storage) {
    var raw;
    try {
      raw = storage.getItem(STORAGE_KEY);
    } catch (e) {
      return { transactions: [], recovered: true };
    }
    if (raw === null || raw === undefined) return { transactions: [], recovered: false };
    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return { transactions: [], recovered: true };
    }
    if (!Array.isArray(parsed)) return { transactions: [], recovered: true };
    var seen = {};
    var out = [];
    parsed.forEach(function (item) {
      var tx = sanitizeStoredTransaction(item);
      if (tx && !seen[tx.id]) {
        seen[tx.id] = true;
        out.push(tx);
      }
    });
    return { transactions: out, recovered: out.length !== parsed.length };
  }

  function saveTransactions(storage, list) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(list));
      return true;
    } catch (e) {
      return false;
    }
  }

  function sampleTransactions(now) {
    now = now || new Date();
    var y = now.getFullYear();
    var m = now.getMonth();
    // Clamp day so samples never land in the future or on invalid dates.
    function day(monthsAgo, d) {
      var date = new Date(y, m - monthsAgo, 1);
      var last = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
      var limit = monthsAgo === 0 ? now.getDate() : last;
      date.setDate(Math.min(d, limit));
      return toISODate(date);
    }
    var defs = [
      ['s1', 'Monthly salary', 'income', '45000', 'salary', day(2, 1), 'Company payroll'],
      ['s2', 'Condo rent', 'expense', '12000', 'bills', day(2, 3), ''],
      ['s3', 'Groceries at Tops', 'expense', '1850.75', 'food', day(2, 9), 'Weekly shopping'],
      ['s4', 'BTS Rabbit card top-up', 'expense', '600', 'transportation', day(2, 12), ''],
      ['s5', 'Monthly salary', 'income', '45000', 'salary', day(1, 1), 'Company payroll'],
      ['s6', 'Logo design project', 'income', '8500', 'freelance', day(1, 14), 'Client: local café'],
      ['s7', 'Condo rent', 'expense', '12000', 'bills', day(1, 3), ''],
      ['s8', 'Movie night', 'expense', '420', 'entertainment', day(1, 18), 'Two tickets + popcorn'],
      ['s9', 'Cloud certification course', 'expense', '3200', 'education', day(1, 22), 'AWS study materials'],
      ['s10', 'Monthly salary', 'income', '45000', 'salary', day(0, 1), 'Company payroll'],
      ['s11', 'Electricity bill', 'expense', '1340.50', 'bills', day(0, 5), 'MEA'],
      ['s12', 'Pad thai and coffee', 'expense', '185', 'food', day(0, 6), ''],
      ['s13', 'Running shoes', 'expense', '2990', 'shopping', day(0, 8), 'Sale price'],
      ['s14', 'Dental check-up', 'expense', '900', 'healthcare', day(0, 10), ''],
      ['s15', 'Fund dividend', 'income', '1250.25', 'investment', day(0, 12), 'Quarterly payout']
    ];
    return defs.map(function (d, i) {
      var created = new Date(now.getTime() - (defs.length - i) * 60000);
      var r = createTransaction({ title: d[1], type: d[2], amount: d[3], category: d[4], date: d[5], notes: d[6] }, created);
      r.transaction.sampleKey = d[0];
      return r.transaction;
    });
  }

  /** Add sample transactions that are not already present. */
  function addSampleTransactions(list, now) {
    var existing = {};
    list.forEach(function (t) { if (t.sampleKey) existing[t.sampleKey] = true; });
    var fresh = sampleTransactions(now).filter(function (s) { return !existing[s.sampleKey]; });
    return { transactions: list.concat(fresh), added: fresh.length };
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    TITLE_MAX: TITLE_MAX,
    NOTES_MAX: NOTES_MAX,
    CATEGORIES: CATEGORIES,
    categoryLabel: categoryLabel,
    categoryType: categoryType,
    isValidDateString: isValidDateString,
    toISODate: toISODate,
    parseAmount: parseAmount,
    satangToInput: satangToInput,
    formatTHB: formatTHB,
    validateTransactionInput: validateTransactionInput,
    createTransaction: createTransaction,
    updateTransaction: updateTransaction,
    replaceTransaction: replaceTransaction,
    removeTransaction: removeTransaction,
    summarize: summarize,
    filterTransactions: filterTransactions,
    sortTransactions: sortTransactions,
    categoryBreakdown: categoryBreakdown,
    monthlyTotals: monthlyTotals,
    loadTransactions: loadTransactions,
    saveTransactions: saveTransactions,
    sampleTransactions: sampleTransactions,
    addSampleTransactions: addSampleTransactions
  };
});
