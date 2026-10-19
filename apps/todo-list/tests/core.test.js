'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../js/core.js');

function memoryStorage(initial) {
  const data = Object.assign({}, initial);
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
    data
  };
}

function make(title, extra) {
  const r = Core.createTask(Object.assign({ title }, extra));
  assert.equal(r.ok, true, 'expected task to be valid: ' + title);
  return r.task;
}

describe('validation', () => {
  test('rejects empty and whitespace-only titles', () => {
    for (const title of ['', '   ', '\n\t', undefined, null]) {
      const r = Core.createTask({ title });
      assert.equal(r.ok, false);
      assert.match(r.errors.title, /title/i);
    }
  });

  test('trims title and description', () => {
    const t = make('  Buy milk  ', { description: '  2 litres ' });
    assert.equal(t.title, 'Buy milk');
    assert.equal(t.description, '2 litres');
  });

  test('defaults priority to medium and rejects unknown priority', () => {
    assert.equal(make('A').priority, 'medium');
    assert.equal(Core.createTask({ title: 'A', priority: 'urgent' }).ok, false);
  });

  test('validates due date format and calendar validity', () => {
    assert.equal(make('A', { dueDate: '2026-02-28' }).dueDate, '2026-02-28');
    assert.equal(make('A', { dueDate: '' }).dueDate, null);
    assert.equal(Core.createTask({ title: 'A', dueDate: '2026-02-30' }).ok, false);
    assert.equal(Core.createTask({ title: 'A', dueDate: 'tomorrow' }).ok, false);
  });

  test('enforces maximum lengths', () => {
    assert.equal(Core.createTask({ title: 'x'.repeat(Core.TITLE_MAX + 1) }).ok, false);
    assert.equal(Core.createTask({ title: 'ok', description: 'x'.repeat(Core.DESCRIPTION_MAX + 1) }).ok, false);
  });
});

describe('task operations', () => {
  test('new tasks are pending with unique ids', () => {
    const a = make('A');
    const b = make('B');
    assert.equal(a.completed, false);
    assert.notEqual(a.id, b.id);
  });

  test('editing preserves completion status and id', () => {
    let tasks = [make('Original')];
    tasks = Core.toggleTask(tasks, tasks[0].id);
    assert.equal(tasks[0].completed, true);
    const r = Core.updateTask(tasks[0], { title: 'Renamed', priority: 'high' });
    assert.equal(r.ok, true);
    assert.equal(r.task.id, tasks[0].id);
    assert.equal(r.task.completed, true);
    assert.equal(r.task.title, 'Renamed');
    assert.equal(r.task.createdAt, tasks[0].createdAt);
  });

  test('editing validates input', () => {
    const t = make('A');
    assert.equal(Core.updateTask(t, { title: '  ' }).ok, false);
  });

  test('toggle, replace, and remove', () => {
    let tasks = [make('A'), make('B')];
    tasks = Core.toggleTask(tasks, tasks[1].id);
    assert.deepEqual(tasks.map((t) => t.completed), [false, true]);
    tasks = Core.toggleTask(tasks, tasks[1].id);
    assert.deepEqual(tasks.map((t) => t.completed), [false, false]);
    tasks = Core.removeTask(tasks, tasks[0].id);
    assert.deepEqual(tasks.map((t) => t.title), ['B']);
  });

  test('summary counts', () => {
    let tasks = [make('A'), make('B'), make('C')];
    assert.deepEqual(Core.summarize(tasks), { total: 3, completed: 0, pending: 3 });
    tasks = Core.toggleTask(tasks, tasks[0].id);
    assert.deepEqual(Core.summarize(tasks), { total: 3, completed: 1, pending: 2 });
    assert.deepEqual(Core.summarize([]), { total: 0, completed: 0, pending: 0 });
  });
});

describe('filter, search and sort', () => {
  const base = new Date('2026-10-01T00:00:00Z').getTime();
  const at = (min) => new Date(base + min * 60000);
  const tasks = [
    Core.createTask({ title: 'Write report', description: 'quarterly numbers', priority: 'low', dueDate: '2026-10-20' }, at(1)).task,
    Core.createTask({ title: 'Call bank', priority: 'high' }, at(2)).task,
    Core.createTask({ title: 'Plan trip', description: 'Book REPORT hotel', priority: 'medium', dueDate: '2026-10-05' }, at(3)).task
  ];
  tasks[1].completed = true;

  test('status filters', () => {
    assert.equal(Core.filterTasks(tasks, 'all', '').length, 3);
    assert.deepEqual(Core.filterTasks(tasks, 'pending', '').map((t) => t.title), ['Write report', 'Plan trip']);
    assert.deepEqual(Core.filterTasks(tasks, 'completed', '').map((t) => t.title), ['Call bank']);
  });

  test('search matches title or description, case-insensitively', () => {
    assert.deepEqual(Core.filterTasks(tasks, 'all', 'report').map((t) => t.title), ['Write report', 'Plan trip']);
    assert.deepEqual(Core.filterTasks(tasks, 'all', '  BANK ').map((t) => t.title), ['Call bank']);
  });

  test('filters and search combine', () => {
    assert.deepEqual(Core.filterTasks(tasks, 'completed', 'report'), []);
    assert.deepEqual(Core.filterTasks(tasks, 'pending', 'hotel').map((t) => t.title), ['Plan trip']);
  });

  test('sorting modes', () => {
    const titles = (mode) => Core.sortTasks(tasks, mode).map((t) => t.title);
    assert.deepEqual(titles('newest'), ['Plan trip', 'Call bank', 'Write report']);
    assert.deepEqual(titles('oldest'), ['Write report', 'Call bank', 'Plan trip']);
    assert.deepEqual(titles('priority'), ['Call bank', 'Plan trip', 'Write report']);
    // Tasks without a due date sort last.
    assert.deepEqual(titles('due'), ['Plan trip', 'Write report', 'Call bank']);
  });

  test('sorting does not mutate the input', () => {
    const before = tasks.map((t) => t.id);
    Core.sortTasks(tasks, 'oldest');
    assert.deepEqual(tasks.map((t) => t.id), before);
  });

  test('due status', () => {
    const today = new Date(2026, 9, 10);
    assert.equal(Core.dueStatus({ dueDate: '2026-10-09', completed: false }, today), 'overdue');
    assert.equal(Core.dueStatus({ dueDate: '2026-10-10', completed: false }, today), 'today');
    assert.equal(Core.dueStatus({ dueDate: '2026-10-11', completed: false }, today), 'upcoming');
    assert.equal(Core.dueStatus({ dueDate: '2026-10-09', completed: true }, today), null);
    assert.equal(Core.dueStatus({ dueDate: null, completed: false }, today), null);
  });
});

describe('persistence', () => {
  test('round-trips through storage', () => {
    const storage = memoryStorage();
    const tasks = [make('A'), make('B', { dueDate: '2026-12-01', priority: 'high' })];
    assert.equal(Core.saveTasks(storage, tasks), true);
    const loaded = Core.loadTasks(storage);
    assert.equal(loaded.recovered, false);
    assert.deepEqual(loaded.tasks, tasks);
  });

  test('missing data loads as empty without recovery flag', () => {
    assert.deepEqual(Core.loadTasks(memoryStorage()), { tasks: [], recovered: false });
  });

  test('malformed JSON and wrong shapes do not throw', () => {
    for (const raw of ['{not json', '"a string"', '{"a":1}', 'null', '42']) {
      const storage = memoryStorage({ [Core.STORAGE_KEY]: raw });
      const loaded = Core.loadTasks(storage);
      assert.deepEqual(loaded.tasks, []);
      assert.equal(loaded.recovered, true, 'raw=' + raw);
    }
  });

  test('invalid records are dropped and valid ones kept', () => {
    const good = make('Keep me');
    const raw = JSON.stringify([good, null, 5, { title: '   ' }, { title: 'x', priority: 'nope' }, good]);
    const loaded = Core.loadTasks(memoryStorage({ [Core.STORAGE_KEY]: raw }));
    assert.equal(loaded.recovered, true);
    assert.deepEqual(loaded.tasks.map((t) => t.title), ['Keep me']);
  });

  test('throwing storage is handled', () => {
    const broken = {
      getItem() { throw new Error('denied'); },
      setItem() { throw new Error('quota'); }
    };
    assert.deepEqual(Core.loadTasks(broken), { tasks: [], recovered: true });
    assert.equal(Core.saveTasks(broken, []), false);
  });
});

describe('sample data', () => {
  test('adds samples once only', () => {
    const first = Core.addSampleTasks([]);
    assert.ok(first.added > 0);
    const second = Core.addSampleTasks(first.tasks);
    assert.equal(second.added, 0);
    assert.equal(second.tasks.length, first.tasks.length);
  });

  test('samples survive a save/load cycle without duplicating', () => {
    const storage = memoryStorage();
    Core.saveTasks(storage, Core.addSampleTasks([make('Mine')]).tasks);
    const reloaded = Core.loadTasks(storage).tasks;
    assert.equal(Core.addSampleTasks(reloaded).added, 0);
  });
});
