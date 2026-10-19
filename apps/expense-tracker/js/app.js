/*
 * Expense Tracker — DOM wiring. All user content is rendered with
 * textContent / createElement; no innerHTML, eval, or inline handlers.
 */
(function () {
  'use strict';

  var Core = window.ExpenseCore;
  var SVG_NS = 'http://www.w3.org/2000/svg';

  var storage = getStorage();
  var state = {
    transactions: [],
    editingId: null,
    lastChangedId: null,
    filters: { type: 'all', category: 'all', from: '', to: '', query: '' },
    sort: 'newest'
  };

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    form: $('tx-form'),
    formCard: $('form-card'),
    formTitle: $('form-title-text'),
    typeFieldset: $('tx-type'),
    title: $('tx-title'),
    amount: $('tx-amount'),
    date: $('tx-date'),
    category: $('tx-category'),
    notes: $('tx-notes'),
    submitLabel: $('submit-label'),
    cancelEdit: $('cancel-edit'),
    sumBalance: $('sum-balance'),
    sumIncome: $('sum-income'),
    sumExpense: $('sum-expense'),
    sumCount: $('sum-count'),
    sumIncomeCount: $('sum-income-count'),
    sumExpenseCount: $('sum-expense-count'),
    balanceCard: document.querySelector('.summary-balance'),
    breakdownList: $('breakdown-list'),
    breakdownEmpty: $('breakdown-empty'),
    breakdownSub: $('breakdown-sub'),
    monthlyChart: $('monthly-chart'),
    monthlyTable: $('monthly-table'),
    list: $('tx-list'),
    empty: $('empty-state'),
    emptyTitle: $('empty-title'),
    emptyText: $('empty-text'),
    emptyAction: $('empty-action'),
    resultCount: $('result-count'),
    viewTotals: $('view-totals'),
    search: $('f-search'),
    fCategory: $('f-category'),
    fFrom: $('f-from'),
    fTo: $('f-to'),
    fSort: $('f-sort'),
    rangeError: $('f-range-error'),
    resetFilters: $('reset-filters'),
    sampleBtn: $('sample-btn'),
    clearBtn: $('clear-btn'),
    alert: $('storage-alert'),
    alertText: $('storage-alert-text'),
    toastRegion: $('toast-region'),
    confirmDialog: $('confirm-dialog'),
    confirmTitle: $('confirm-title'),
    confirmText: $('confirm-text'),
    confirmOk: $('confirm-ok')
  };

  // ---------- storage ----------
  function getStorage() {
    try {
      var s = window.localStorage;
      var probe = '__plodphai_probe__';
      s.setItem(probe, '1');
      s.removeItem(probe);
      return s;
    } catch (e) {
      var mem = {};
      return {
        unavailable: true,
        getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
        setItem: function (k, v) { mem[k] = String(v); },
        removeItem: function (k) { delete mem[k]; }
      };
    }
  }

  function persist() {
    if (!Core.saveTransactions(storage, state.transactions)) {
      showAlert('Your changes could not be saved. Browser storage may be full or disabled.');
      toast('Could not save changes to browser storage.', 'error');
    }
  }

  function showAlert(message) {
    els.alertText.textContent = message;
    els.alert.hidden = false;
  }

  // ---------- DOM helpers ----------
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function svgEl(tag, attrs) {
    var node = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, String(attrs[k])); });
    return node;
  }

  function icon(name) {
    var svg = svgEl('svg', { 'class': 'icon', 'aria-hidden': 'true', focusable: 'false' });
    svg.appendChild(svgEl('use', { href: '#i-' + name }));
    return svg;
  }

  function formatDate(iso, opts) {
    var p = iso.split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString('en-GB', opts || { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function monthLabel(bucket, long) {
    return new Date(bucket.year, bucket.month, 1).toLocaleDateString('en-GB', long ? { month: 'long', year: 'numeric' } : { month: 'short' });
  }

  function compactTHB(satang) {
    var baht = satang / 100;
    if (baht >= 1e6) return '฿' + (Math.round(baht / 1e5) / 10) + 'M';
    if (baht >= 1e3) return '฿' + (Math.round(baht / 100) / 10) + 'k';
    return '฿' + Math.round(baht);
  }

  function plural(n, word, many) {
    return n + ' ' + (n === 1 ? word : (many || word + 's'));
  }

  // ---------- toasts & confirmation ----------
  function toast(message, kind) {
    var item = el('div', 'toast toast-' + (kind || 'success'));
    item.appendChild(icon(kind === 'error' ? 'alert' : kind === 'info' ? 'trash' : 'check'));
    item.appendChild(el('span', null, message));
    els.toastRegion.appendChild(item);
    window.setTimeout(function () {
      item.classList.add('is-leaving');
      window.setTimeout(function () { item.remove(); }, 200);
    }, 3200);
  }

  function confirmAction(opts) {
    var dialog = els.confirmDialog;
    if (typeof dialog.showModal !== 'function') {
      return Promise.resolve(window.confirm(opts.title + '\n\n' + opts.text));
    }
    els.confirmTitle.textContent = opts.title;
    els.confirmText.textContent = opts.text;
    els.confirmOk.textContent = opts.confirmLabel || 'Delete';
    dialog.returnValue = '';
    return new Promise(function (resolve) {
      dialog.addEventListener('close', function onClose() {
        dialog.removeEventListener('close', onClose);
        resolve(dialog.returnValue === 'confirm');
      });
      dialog.showModal();
    });
  }

  // ---------- form ----------
  var fieldMap = function () {
    return {
      type: els.typeFieldset,
      title: els.title,
      amount: els.amount,
      date: els.date,
      category: els.category,
      notes: els.notes
    };
  };

  function selectedType() {
    var checked = els.form.querySelector('input[name="type"]:checked');
    return checked ? checked.value : '';
  }

  function setType(type) {
    els.form.querySelectorAll('input[name="type"]').forEach(function (r) { r.checked = r.value === type; });
    populateFormCategories(type);
  }

  function fillSelect(select, options, selected) {
    var fragment = document.createDocumentFragment();
    options.forEach(function (o) {
      var opt = el('option', null, o.label);
      opt.value = o.value;
      if (o.group) opt.setAttribute('data-group', o.group);
      fragment.appendChild(opt);
    });
    select.replaceChildren(fragment);
    if (selected !== undefined && options.some(function (o) { return o.value === selected; })) {
      select.value = selected;
    }
  }

  function populateFormCategories(type, selected) {
    var list = Core.CATEGORIES[type] || [];
    var current = selected !== undefined ? selected : els.category.value;
    fillSelect(els.category, list.map(function (c) { return { value: c.id, label: c.label }; }), current);
  }

  function populateFilterCategories() {
    var type = state.filters.type;
    var options = [{ value: 'all', label: 'All categories' }];
    ['income', 'expense'].forEach(function (t) {
      if (type !== 'all' && type !== t) return;
      Core.CATEGORIES[t].forEach(function (c) { options.push({ value: c.id, label: c.label }); });
    });
    var keep = options.some(function (o) { return o.value === state.filters.category; });
    if (!keep) state.filters.category = 'all';
    fillSelect(els.fCategory, options, state.filters.category);
  }

  function setFieldError(node, message) {
    var err = document.getElementById(node.id + '-error');
    if (err) err.textContent = message || '';
    if (message) node.setAttribute('aria-invalid', 'true');
    else node.removeAttribute('aria-invalid');
  }

  function showErrors(errors) {
    var fields = fieldMap();
    var first = null;
    Object.keys(fields).forEach(function (key) {
      setFieldError(fields[key], errors[key]);
      if (errors[key] && !first) first = fields[key];
    });
    if (first) {
      var target = first.tagName === 'FIELDSET' ? first.querySelector('input:checked') || first.querySelector('input') : first;
      target.focus();
    }
  }

  function readForm() {
    return {
      title: els.title.value,
      type: selectedType(),
      amount: els.amount.value,
      category: els.category.value,
      date: els.date.value,
      notes: els.notes.value
    };
  }

  function resetForm() {
    state.editingId = null;
    els.form.reset();
    setType('expense');
    els.date.value = Core.toISODate(new Date());
    showErrors({});
    els.formTitle.textContent = 'Add transaction';
    els.submitLabel.textContent = 'Add transaction';
    els.cancelEdit.hidden = true;
    els.formCard.classList.remove('is-editing');
  }

  function startEdit(id) {
    var tx = findTx(id);
    if (!tx) return;
    state.editingId = id;
    setType(tx.type);
    populateFormCategories(tx.type, tx.category);
    els.title.value = tx.title;
    els.amount.value = Core.satangToInput(tx.amountSatang);
    els.date.value = tx.date;
    els.notes.value = tx.notes || '';
    showErrors({});
    els.formTitle.textContent = 'Edit transaction';
    els.submitLabel.textContent = 'Save changes';
    els.cancelEdit.hidden = false;
    els.formCard.classList.add('is-editing');
    els.formCard.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    els.title.focus({ preventScroll: true });
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function submitForm(evt) {
    evt.preventDefault();
    var input = readForm();
    var editing = state.editingId ? findTx(state.editingId) : null;
    var result = editing ? Core.updateTransaction(editing, input) : Core.createTransaction(input);
    if (!result.ok) {
      showErrors(result.errors);
      toast('Please fix the highlighted fields.', 'error');
      return;
    }
    var tx = result.transaction;
    if (editing) {
      state.transactions = Core.replaceTransaction(state.transactions, tx);
    } else {
      state.transactions = state.transactions.concat(tx);
    }
    state.lastChangedId = tx.id;
    persist();
    resetForm();
    render();
    els.title.focus();
    toast((editing ? 'Updated: ' : 'Added ' + tx.type + ': ') + tx.title + ' (' + Core.formatTHB(tx.amountSatang) + ')');
  }

  // ---------- rendering ----------
  function findTx(id) {
    for (var i = 0; i < state.transactions.length; i++) {
      if (state.transactions[i].id === id) return state.transactions[i];
    }
    return null;
  }

  function renderSummary() {
    var s = Core.summarize(state.transactions);
    var incomeCount = state.transactions.filter(function (t) { return t.type === 'income'; }).length;
    els.sumBalance.textContent = Core.formatTHB(s.balance);
    els.sumIncome.textContent = Core.formatTHB(s.income);
    els.sumExpense.textContent = Core.formatTHB(s.expense);
    els.sumCount.textContent = s.count ? plural(s.count, 'transaction') + ' recorded' : 'No transactions yet';
    els.sumIncomeCount.textContent = plural(incomeCount, 'income entry', 'income entries');
    els.sumExpenseCount.textContent = plural(s.count - incomeCount, 'expense entry', 'expense entries');
    els.balanceCard.classList.toggle('is-negative', s.balance < 0);
  }

  function visibleTransactions() {
    var f = state.filters;
    var rangeInvalid = f.from && f.to && f.from > f.to;
    els.rangeError.textContent = rangeInvalid ? '“From” date must be on or before the “To” date. The date filter is ignored until this is fixed.' : '';
    var effective = rangeInvalid ? Object.assign({}, f, { from: '', to: '' }) : f;
    return Core.filterTransactions(state.transactions, effective);
  }

  function renderBreakdown(list) {
    var rows = Core.categoryBreakdown(list, 'expense');
    var total = rows.reduce(function (sum, r) { return sum + r.satang; }, 0);
    els.breakdownEmpty.hidden = rows.length > 0;
    els.breakdownList.hidden = rows.length === 0;
    els.breakdownSub.textContent = rows.length ? Core.formatTHB(total) + ' across ' + plural(rows.length, 'category', 'categories') : '';
    var max = rows.length ? rows[0].satang : 0;
    var fragment = document.createDocumentFragment();
    rows.forEach(function (r) {
      var li = el('li', 'bd-row');
      li.setAttribute('data-category', r.category);
      var head = el('div', 'bd-head');
      var name = el('span', 'bd-name');
      name.appendChild(el('span', 'cat-dot cat-' + r.category));
      name.appendChild(document.createTextNode(r.label));
      head.appendChild(name);
      var val = el('span', 'bd-value');
      val.appendChild(el('strong', null, Core.formatTHB(r.satang)));
      val.appendChild(el('span', 'bd-pct', r.percent.toFixed(1) + '%'));
      head.appendChild(val);
      li.appendChild(head);
      var track = el('div', 'bd-track');
      var fill = el('span', 'bd-fill cat-' + r.category);
      fill.style.width = (max ? Math.max(2, (r.satang / max) * 100) : 0) + '%';
      track.appendChild(fill);
      li.appendChild(track);
      fragment.appendChild(li);
    });
    els.breakdownList.replaceChildren(fragment);
  }

  function renderMonthly(list) {
    var months = Core.monthlyTotals(list, new Date(), 6);
    var max = months.reduce(function (m, b) { return Math.max(m, b.income, b.expense); }, 0);
    // Draw at the container's real width so labels stay a readable pixel size.
    var W = Math.max(300, Math.round(els.monthlyChart.clientWidth || 640));
    var H = 240, top = 28, bottom = 34, left = 8, right = 8;
    var plotH = H - top - bottom;
    var groupW = (W - left - right) / months.length;
    var barW = Math.min(32, groupW / 3.2);

    var svg = svgEl('svg', {
      viewBox: '0 0 ' + W + ' ' + H,
      'class': 'monthly-svg',
      role: 'img',
      'aria-label': 'Bar chart of income and expenses for the last 6 months. ' +
        months.map(function (b) {
          return monthLabel(b, true) + ': income ' + Core.formatTHB(b.income) + ', expenses ' + Core.formatTHB(b.expense);
        }).join('; ') + '.'
    });
    var defs = svgEl('defs');
    var pattern = svgEl('pattern', { id: 'expense-stripes', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
    pattern.appendChild(svgEl('rect', { width: 6, height: 6, 'class': 'stripe-bg' }));
    pattern.appendChild(svgEl('rect', { width: 2.5, height: 6, 'class': 'stripe-fg' }));
    defs.appendChild(pattern);
    svg.appendChild(defs);

    [0.25, 0.5, 0.75, 1].forEach(function (f) {
      var y = top + plotH - plotH * f;
      svg.appendChild(svgEl('line', { x1: left, x2: W - right, y1: y, y2: y, 'class': 'grid-line' }));
    });
    svg.appendChild(svgEl('line', { x1: left, x2: W - right, y1: top + plotH, y2: top + plotH, 'class': 'axis-line' }));

    months.forEach(function (b, i) {
      var cx = left + groupW * i + groupW / 2;
      [['income', b.income, cx - barW - 2], ['expense', b.expense, cx + 2]].forEach(function (spec) {
        var value = spec[1];
        var h = max ? (value / max) * plotH : 0;
        if (value > 0) h = Math.max(h, 2);
        var y = top + plotH - h;
        var rect = svgEl('rect', { x: spec[2], y: y, width: barW, height: h, rx: 3, 'class': 'bar bar-' + spec[0] });
        var title = svgEl('title');
        title.textContent = monthLabel(b, true) + ' ' + spec[0] + ': ' + Core.formatTHB(value);
        rect.appendChild(title);
        svg.appendChild(rect);
        if (value > 0) {
          var label = svgEl('text', { x: spec[2] + barW / 2, y: y - 6, 'class': 'bar-label', 'text-anchor': 'middle' });
          label.textContent = compactTHB(value);
          svg.appendChild(label);
        }
      });
      var mLabel = svgEl('text', { x: cx, y: H - 12, 'class': 'month-label', 'text-anchor': 'middle' });
      mLabel.textContent = monthLabel(b);
      svg.appendChild(mLabel);
    });

    els.monthlyChart.replaceChildren(svg);

    var fragment = document.createDocumentFragment();
    months.forEach(function (b) {
      var tr = el('tr');
      var th = el('th', null, monthLabel(b, true));
      th.scope = 'row';
      tr.appendChild(th);
      tr.appendChild(el('td', null, Core.formatTHB(b.income)));
      tr.appendChild(el('td', null, Core.formatTHB(b.expense)));
      tr.appendChild(el('td', null, Core.formatTHB(b.income - b.expense, { sign: true })));
      fragment.appendChild(tr);
    });
    els.monthlyTable.replaceChildren(fragment);
  }

  function buildRow(tx) {
    var li = el('li', 'tx-item tx-' + tx.type);
    li.setAttribute('data-id', tx.id);
    if (tx.id === state.lastChangedId) li.classList.add('is-new');

    var badge = el('span', 'tx-icon');
    badge.appendChild(icon(tx.type === 'income' ? 'up' : 'down'));
    li.appendChild(badge);

    var body = el('div', 'tx-body');
    body.appendChild(el('h3', 'tx-title', tx.title));
    var meta = el('div', 'tx-meta');
    var cat = el('span', 'cat-chip');
    cat.appendChild(el('span', 'cat-dot cat-' + tx.category));
    cat.appendChild(document.createTextNode(Core.categoryLabel(tx.category)));
    meta.appendChild(cat);
    var date = el('span', 'tx-date');
    date.appendChild(icon('calendar'));
    date.appendChild(document.createTextNode(formatDate(tx.date)));
    meta.appendChild(date);
    meta.appendChild(el('span', 'type-label type-' + tx.type, tx.type === 'income' ? 'Income' : 'Expense'));
    body.appendChild(meta);
    if (tx.notes) {
      var notes = el('p', 'tx-notes');
      notes.appendChild(icon('note'));
      notes.appendChild(document.createTextNode(tx.notes));
      body.appendChild(notes);
    }
    li.appendChild(body);

    var side = el('div', 'tx-side');
    var amount = el('span', 'tx-amount', Core.formatTHB(tx.type === 'income' ? tx.amountSatang : -tx.amountSatang, { sign: true }));
    amount.setAttribute('data-satang', String(tx.amountSatang));
    side.appendChild(amount);
    var actions = el('div', 'tx-actions');
    var edit = el('button', 'icon-btn');
    edit.type = 'button';
    edit.setAttribute('data-action', 'edit');
    edit.setAttribute('aria-label', 'Edit transaction: ' + tx.title);
    edit.title = 'Edit';
    edit.appendChild(icon('edit'));
    var del = el('button', 'icon-btn icon-btn-danger');
    del.type = 'button';
    del.setAttribute('data-action', 'delete');
    del.setAttribute('aria-label', 'Delete transaction: ' + tx.title);
    del.title = 'Delete';
    del.appendChild(icon('trash'));
    actions.appendChild(edit);
    actions.appendChild(del);
    side.appendChild(actions);
    li.appendChild(side);
    return li;
  }

  function renderHistory(list) {
    var sorted = Core.sortTransactions(list, state.sort);
    var fragment = document.createDocumentFragment();
    sorted.forEach(function (t) { fragment.appendChild(buildRow(t)); });
    els.list.replaceChildren(fragment);
    state.lastChangedId = null;

    var total = state.transactions.length;
    els.resultCount.textContent = total ? '(' + sorted.length + ' of ' + total + ')' : '';

    var s = Core.summarize(list);
    els.viewTotals.replaceChildren();
    if (sorted.length) {
      [['In view', null], ['Income', s.income], ['Expenses', s.expense], ['Net', s.balance]].forEach(function (p, i) {
        var span = el('span', 'vt-item' + (i === 0 ? ' vt-label' : ''));
        if (i === 0) {
          span.textContent = plural(sorted.length, 'transaction') + ' in view';
        } else {
          span.appendChild(el('span', 'vt-key', p[0]));
          span.appendChild(el('strong', i === 3 ? (p[1] < 0 ? 'neg' : 'pos') : null,
            i === 3 ? Core.formatTHB(p[1], { sign: true }) : Core.formatTHB(p[1])));
        }
        els.viewTotals.appendChild(span);
      });
    }
    els.viewTotals.hidden = sorted.length === 0;

    var isEmpty = sorted.length === 0;
    els.empty.hidden = !isEmpty;
    els.list.hidden = isEmpty;
    if (!isEmpty) return;
    if (total === 0) {
      els.emptyTitle.textContent = 'No transactions yet';
      els.emptyText.textContent = 'Add your first income or expense, or load sample data to explore the dashboard.';
      els.emptyAction.textContent = 'Load sample data';
      els.emptyAction.setAttribute('data-empty', 'sample');
    } else {
      els.emptyTitle.textContent = 'No matching transactions';
      els.emptyText.textContent = 'No transactions match the current filters. Try widening the date range or clearing the search.';
      els.emptyAction.textContent = 'Reset filters';
      els.emptyAction.setAttribute('data-empty', 'reset');
    }
  }

  function renderFilterControls() {
    document.querySelectorAll('[data-type]').forEach(function (btn) {
      var active = btn.getAttribute('data-type') === state.filters.type;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function render() {
    renderSummary();
    renderFilterControls();
    var visible = visibleTransactions();
    renderBreakdown(visible);
    renderMonthly(visible);
    renderHistory(visible);
  }

  // ---------- actions ----------
  function remove(id) {
    var tx = findTx(id);
    if (!tx) return;
    confirmAction({
      title: 'Delete transaction?',
      text: '“' + tx.title + '” (' + Core.formatTHB(tx.amountSatang) + ', ' + formatDate(tx.date) + ') will be permanently removed.',
      confirmLabel: 'Delete'
    }).then(function (ok) {
      if (!ok) return;
      state.transactions = Core.removeTransaction(state.transactions, id);
      if (state.editingId === id) resetForm();
      persist();
      render();
      els.list.focus();
      toast('Transaction deleted.', 'info');
    });
  }

  function loadSamples() {
    var result = Core.addSampleTransactions(state.transactions);
    if (result.added === 0) {
      toast('Sample data is already loaded.', 'info');
      return;
    }
    state.transactions = result.transactions;
    persist();
    render();
    toast('Added ' + plural(result.added, 'sample transaction') + '.');
  }

  function clearAll() {
    if (!state.transactions.length) {
      toast('There are no transactions to clear.', 'info');
      return;
    }
    confirmAction({
      title: 'Clear all transactions?',
      text: 'All ' + plural(state.transactions.length, 'transaction') + ' will be removed from this browser. This cannot be undone.',
      confirmLabel: 'Clear all'
    }).then(function (ok) {
      if (!ok) return;
      state.transactions = [];
      resetForm();
      persist();
      render();
      toast('All transactions cleared.', 'info');
    });
  }

  function resetFilters() {
    state.filters = { type: 'all', category: 'all', from: '', to: '', query: '' };
    state.sort = 'newest';
    els.search.value = '';
    els.fFrom.value = '';
    els.fTo.value = '';
    els.fSort.value = 'newest';
    populateFilterCategories();
    render();
  }

  // ---------- events ----------
  function bind() {
    els.form.addEventListener('submit', submitForm);
    els.form.querySelectorAll('input[name="type"]').forEach(function (radio) {
      radio.addEventListener('change', function () {
        populateFormCategories(selectedType());
        setFieldError(els.typeFieldset, '');
        setFieldError(els.category, '');
      });
    });
    els.cancelEdit.addEventListener('click', function () {
      resetForm();
      toast('Edit cancelled.', 'info');
    });

    els.list.setAttribute('tabindex', '-1');
    els.list.addEventListener('click', function (evt) {
      var btn = evt.target.closest('button[data-action]');
      if (!btn) return;
      var item = btn.closest('[data-id]');
      if (!item) return;
      var id = item.getAttribute('data-id');
      if (btn.getAttribute('data-action') === 'edit') startEdit(id);
      else if (btn.getAttribute('data-action') === 'delete') remove(id);
    });

    var timer = null;
    els.search.addEventListener('input', function () {
      window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        state.filters.query = els.search.value;
        render();
      }, 120);
    });
    document.querySelectorAll('[data-type]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.filters.type = btn.getAttribute('data-type');
        populateFilterCategories();
        render();
      });
    });
    els.fCategory.addEventListener('change', function () {
      state.filters.category = els.fCategory.value;
      render();
    });
    els.fFrom.addEventListener('change', function () {
      state.filters.from = els.fFrom.value;
      render();
    });
    els.fTo.addEventListener('change', function () {
      state.filters.to = els.fTo.value;
      render();
    });
    els.fSort.addEventListener('change', function () {
      state.sort = els.fSort.value;
      render();
    });
    els.resetFilters.addEventListener('click', resetFilters);

    var resizeTimer = null;
    var lastWidth = els.monthlyChart.clientWidth;
    window.addEventListener('resize', function () {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(function () {
        if (els.monthlyChart.clientWidth === lastWidth) return;
        lastWidth = els.monthlyChart.clientWidth;
        renderMonthly(visibleTransactions());
      }, 150);
    });
    els.sampleBtn.addEventListener('click', loadSamples);
    els.clearBtn.addEventListener('click', clearAll);
    els.emptyAction.addEventListener('click', function () {
      if (els.emptyAction.getAttribute('data-empty') === 'reset') resetFilters();
      else loadSamples();
    });
  }

  // ---------- init ----------
  function init() {
    var loaded = Core.loadTransactions(storage);
    state.transactions = loaded.transactions;
    if (storage.unavailable) {
      showAlert('Browser storage is unavailable, so transactions will be lost when you close this page.');
    } else if (loaded.recovered) {
      showAlert('Some saved transaction data was unreadable and has been skipped.');
      persist();
    }
    populateFilterCategories();
    resetForm();
    bind();
    render();
    document.documentElement.setAttribute('data-ready', 'true');
  }

  init();
})();
