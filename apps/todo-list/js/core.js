/*
 * Todo List — pure logic (no DOM access).
 * Loaded as a classic script in the browser (exposes window.TodoCore)
 * and as a CommonJS module by the Node test runner.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TodoCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STORAGE_KEY = 'plodphai.todo.tasks.v1';
  var PRIORITIES = ['low', 'medium', 'high'];
  var PRIORITY_RANK = { high: 3, medium: 2, low: 1 };
  var TITLE_MAX = 120;
  var DESCRIPTION_MAX = 500;
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  function isValidDateString(value) {
    if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
    var parts = value.split('-').map(Number);
    var d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    return d.getUTCFullYear() === parts[0] &&
      d.getUTCMonth() === parts[1] - 1 &&
      d.getUTCDate() === parts[2];
  }

  function generateId() {
    var c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    return 't-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function cleanText(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  /**
   * Validate raw form input. Returns { valid, errors, value } where value
   * holds the cleaned fields (title, description, priority, dueDate).
   */
  function validateTaskInput(input) {
    input = input || {};
    var errors = {};
    var title = cleanText(input.title);
    var description = cleanText(input.description);
    var priority = cleanText(input.priority).toLowerCase() || 'medium';
    var dueDate = cleanText(input.dueDate);

    if (!title) {
      errors.title = 'Please enter a task title.';
    } else if (title.length > TITLE_MAX) {
      errors.title = 'Title must be ' + TITLE_MAX + ' characters or fewer.';
    }
    if (description.length > DESCRIPTION_MAX) {
      errors.description = 'Description must be ' + DESCRIPTION_MAX + ' characters or fewer.';
    }
    if (PRIORITIES.indexOf(priority) === -1) {
      errors.priority = 'Choose Low, Medium, or High.';
    }
    if (dueDate && !isValidDateString(dueDate)) {
      errors.dueDate = 'Enter a valid date (YYYY-MM-DD).';
    }

    return {
      valid: Object.keys(errors).length === 0,
      errors: errors,
      value: { title: title, description: description, priority: priority, dueDate: dueDate || null }
    };
  }

  function createTask(input, now) {
    var result = validateTaskInput(input);
    if (!result.valid) return { ok: false, errors: result.errors };
    var stamp = (now || new Date()).toISOString();
    var v = result.value;
    return {
      ok: true,
      task: {
        id: generateId(),
        title: v.title,
        description: v.description,
        priority: v.priority,
        dueDate: v.dueDate,
        completed: false,
        createdAt: stamp,
        updatedAt: stamp
      }
    };
  }

  /** Apply edited fields; completion status and identity are preserved. */
  function updateTask(task, input, now) {
    var result = validateTaskInput(input);
    if (!result.valid) return { ok: false, errors: result.errors };
    var v = result.value;
    return {
      ok: true,
      task: Object.assign({}, task, {
        title: v.title,
        description: v.description,
        priority: v.priority,
        dueDate: v.dueDate,
        updatedAt: (now || new Date()).toISOString()
      })
    };
  }

  function toggleTask(tasks, id) {
    return tasks.map(function (t) {
      return t.id === id ? Object.assign({}, t, { completed: !t.completed }) : t;
    });
  }

  function replaceTask(tasks, updated) {
    return tasks.map(function (t) { return t.id === updated.id ? updated : t; });
  }

  function removeTask(tasks, id) {
    return tasks.filter(function (t) { return t.id !== id; });
  }

  function summarize(tasks) {
    var completed = tasks.filter(function (t) { return t.completed; }).length;
    return { total: tasks.length, completed: completed, pending: tasks.length - completed };
  }

  /** status: 'all' | 'pending' | 'completed'; query matches title or description. */
  function filterTasks(tasks, status, query) {
    var q = cleanText(query).toLowerCase();
    return tasks.filter(function (t) {
      if (status === 'pending' && t.completed) return false;
      if (status === 'completed' && !t.completed) return false;
      if (!q) return true;
      return t.title.toLowerCase().indexOf(q) !== -1 ||
        (t.description || '').toLowerCase().indexOf(q) !== -1;
    });
  }

  function byNewest(a, b) {
    return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
  }

  /** mode: 'newest' | 'oldest' | 'priority' | 'due'. Returns a new array. */
  function sortTasks(tasks, mode) {
    var list = tasks.slice();
    switch (mode) {
      case 'oldest':
        return list.sort(function (a, b) { return -byNewest(a, b); });
      case 'priority':
        return list.sort(function (a, b) {
          return (PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]) || byNewest(a, b);
        });
      case 'due':
        // Earliest due date first; tasks without a due date go last.
        return list.sort(function (a, b) {
          if (a.dueDate && b.dueDate) {
            return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : byNewest(a, b);
          }
          if (a.dueDate) return -1;
          if (b.dueDate) return 1;
          return byNewest(a, b);
        });
      default:
        return list.sort(byNewest);
    }
  }

  /** Coerce one stored record into a valid task, or null if unusable. */
  function sanitizeStoredTask(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var check = validateTaskInput(raw);
    if (!check.valid) return null;
    var id = typeof raw.id === 'string' && raw.id ? raw.id : generateId();
    var createdAt = typeof raw.createdAt === 'string' && !isNaN(Date.parse(raw.createdAt))
      ? raw.createdAt : new Date(0).toISOString();
    var updatedAt = typeof raw.updatedAt === 'string' && !isNaN(Date.parse(raw.updatedAt))
      ? raw.updatedAt : createdAt;
    var task = Object.assign({}, check.value, {
      id: id,
      completed: raw.completed === true,
      createdAt: createdAt,
      updatedAt: updatedAt
    });
    if (typeof raw.sampleKey === 'string') task.sampleKey = raw.sampleKey;
    return task;
  }

  /**
   * Read tasks from a Storage-like object. Never throws.
   * Returns { tasks, recovered } — recovered is true when stored data was
   * malformed or partially invalid and had to be discarded.
   */
  function loadTasks(storage) {
    var raw;
    try {
      raw = storage.getItem(STORAGE_KEY);
    } catch (e) {
      return { tasks: [], recovered: true };
    }
    if (raw === null || raw === undefined) return { tasks: [], recovered: false };
    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return { tasks: [], recovered: true };
    }
    if (!Array.isArray(parsed)) return { tasks: [], recovered: true };
    var seen = {};
    var tasks = [];
    parsed.forEach(function (item) {
      var t = sanitizeStoredTask(item);
      if (t && !seen[t.id]) {
        seen[t.id] = true;
        tasks.push(t);
      }
    });
    return { tasks: tasks, recovered: tasks.length !== parsed.length };
  }

  /** Persist tasks. Returns true on success, false if storage is unavailable/full. */
  function saveTasks(storage, tasks) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(tasks));
      return true;
    } catch (e) {
      return false;
    }
  }

  function isoDateOffset(base, days) {
    var d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function sampleTasks(now) {
    now = now || new Date();
    var defs = [
      { key: 'sample-1', title: 'Review Trivy scan report', description: 'Check HIGH and CRITICAL findings for the latest image build.', priority: 'high', due: 1, done: false },
      { key: 'sample-2', title: 'Update SBOM documentation', description: 'Describe where the generated SBOM artifacts are stored.', priority: 'medium', due: 3, done: false },
      { key: 'sample-3', title: 'Rotate demo environment', description: 'Tear down and recreate the Learner Lab test stack.', priority: 'low', due: null, done: false },
      { key: 'sample-4', title: 'Write pipeline retrospective', description: 'Summarise what went well in the last CI run.', priority: 'medium', due: -1, done: true }
    ];
    return defs.map(function (d, i) {
      var created = new Date(now.getTime() - (defs.length - i) * 60000).toISOString();
      return {
        id: generateId(),
        sampleKey: d.key,
        title: d.title,
        description: d.description,
        priority: d.priority,
        dueDate: d.due === null ? null : isoDateOffset(now, d.due),
        completed: d.done,
        createdAt: created,
        updatedAt: created
      };
    });
  }

  /** Add sample tasks that are not already present. Returns { tasks, added }. */
  function addSampleTasks(tasks, now) {
    var existing = {};
    tasks.forEach(function (t) { if (t.sampleKey) existing[t.sampleKey] = true; });
    var fresh = sampleTasks(now).filter(function (s) { return !existing[s.sampleKey]; });
    return { tasks: tasks.concat(fresh), added: fresh.length };
  }

  /** Classify a due date relative to today: 'overdue' | 'today' | 'upcoming' | null. */
  function dueStatus(task, today) {
    if (!task.dueDate || task.completed) return null;
    var t = isoDateOffset(today || new Date(), 0);
    if (task.dueDate < t) return 'overdue';
    if (task.dueDate === t) return 'today';
    return 'upcoming';
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    PRIORITIES: PRIORITIES,
    TITLE_MAX: TITLE_MAX,
    DESCRIPTION_MAX: DESCRIPTION_MAX,
    isValidDateString: isValidDateString,
    validateTaskInput: validateTaskInput,
    createTask: createTask,
    updateTask: updateTask,
    toggleTask: toggleTask,
    replaceTask: replaceTask,
    removeTask: removeTask,
    summarize: summarize,
    filterTasks: filterTasks,
    sortTasks: sortTasks,
    loadTasks: loadTasks,
    saveTasks: saveTasks,
    sampleTasks: sampleTasks,
    addSampleTasks: addSampleTasks,
    dueStatus: dueStatus
  };
});
