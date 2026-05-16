const { Notification } = require("electron");

const CHECK_INTERVAL_MS = 30 * 1000;

let timer = null;
let taskProvider = null;
let settingsProvider = null;
let notifiedKeys = new Set();

function parseDueDateTime(raw) {
  if (!raw) return null;
  const value = String(raw).trim();
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;

  const [, y, m, d, hh, mm, ss] = match;
  const date = new Date(
    Number(y),
    Number(m) - 1,
    Number(d),
    Number(hh),
    Number(mm),
    Number(ss || 0),
    0,
  );

  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDueTime(date) {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function getReminderMinutesBefore() {
  const settings = settingsProvider?.();
  const value = Number(settings?.notification?.minutesBefore);
  if (!Number.isFinite(value)) return 5;
  return Math.max(0, Math.min(1440, Math.round(value)));
}

function shouldNotifyTask(task, now) {
  if (!task || task.status === "done") return { notify: false };

  const dueAt = parseDueDateTime(task.due_date);
  if (!dueAt) return { notify: false };

  const remindAt = new Date(dueAt.getTime() - getReminderMinutesBefore() * 60 * 1000);
  const notify = now >= remindAt && now < dueAt;

  return { notify, dueAt };
}

function createNotifyKey(task, dueAt) {
  return `${task.id}::${dueAt.toISOString()}`;
}

function runCheck() {
  if (!taskProvider) return;
  if (!Notification.isSupported()) return;

  const now = new Date();
  const tasks = Array.isArray(taskProvider()) ? taskProvider() : [];

  tasks.forEach((task) => {
    const { notify, dueAt } = shouldNotifyTask(task, now);
    if (!notify || !dueAt) return;

    const key = createNotifyKey(task, dueAt);
    if (notifiedKeys.has(key)) return;

    notifiedKeys.add(key);

    const notification = new Notification({
      title: `まもなく日付: ${task.title || "(無題タスク)"}`,
      body: `${formatDueTime(dueAt)} の${getReminderMinutesBefore()}分前です。`,
      silent: false,
    });
    notification.show();
  });

  if (notifiedKeys.size > 10000) {
    const activeKeys = new Set(
      tasks
        .map((task) => {
          const dueAt = parseDueDateTime(task.due_date);
          return dueAt ? createNotifyKey(task, dueAt) : null;
        })
        .filter(Boolean),
    );
    notifiedKeys = new Set([...notifiedKeys].filter((key) => activeKeys.has(key)));
  }
}

function start(provider, settingsProviderFn = null) {
  taskProvider = provider;
  settingsProvider = settingsProviderFn;
  runCheck();
  if (timer) clearInterval(timer);
  timer = setInterval(runCheck, CHECK_INTERVAL_MS);
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  taskProvider = null;
  settingsProvider = null;
  notifiedKeys.clear();
}

module.exports = {
  start,
  stop,
};
