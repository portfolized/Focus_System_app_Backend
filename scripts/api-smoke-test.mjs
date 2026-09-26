// End-to-end API check. Run against a dev server:
//   npm run test:api            (defaults to http://localhost:4000)
import { PrismaClient } from "@prisma/client";

const BASE = process.argv[2] ?? "http://localhost:4000";
const prisma = new PrismaClient();
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
let failures = 0;

function check(name, cond, extra = "") {
  console.log(`${cond ? "  ok " : "FAIL "} ${name}${!cond && extra ? " — " + extra : ""}`);
  if (!cond) failures++;
}

async function call(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Timezone": TZ,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, headers: res.headers };
}

const localDate = (offsetDays = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const email = `smoke_${Date.now()}@example.com`;
const password = "correct-horse-1";

console.log(`Testing ${BASE}`);

// ---- auth ----
check("health", (await call("GET", "/api/health")).data.app === "focus-system");
check("unauthenticated bootstrap -> 401", (await call("GET", "/api/bootstrap")).status === 401);
check("short password rejected", (await call("POST", "/api/auth/register", { name: "A", email, password: "123" })).status === 400);
const reg = await call("POST", "/api/auth/register", { name: "Smoke Tester", email, password, timezone: TZ });
check("register 201 + token + cookie", reg.status === 201 && !!reg.data.token && (reg.headers.get("set-cookie") ?? "").includes("fs_session="), JSON.stringify(reg.data));
check("duplicate email -> 409", (await call("POST", "/api/auth/register", { name: "B", email, password })).status === 409);
check("wrong password -> 401", (await call("POST", "/api/auth/login", { email, password: "nope-nope" })).status === 401);
const login = await call("POST", "/api/auth/login", { email: email.toUpperCase(), password });
check("login (case-insensitive email)", login.status === 200 && !!login.data.token);
const T = login.data.token;

const boot = await call("GET", "/api/bootstrap", undefined, T);
check("bootstrap via Bearer token", boot.status === 200 && boot.data.user.email === email);
check("default goals created", boot.data.goals?.length === 2);
check("bootstrap today matches local date", boot.data.today === localDate(), `${boot.data.today} vs ${localDate()}`);
const goalId = boot.data.goals[0].id;

// ---- tasks ----
check("past date rejected", (await call("POST", "/api/tasks", { title: "x", dueDate: localDate(-1) }, T)).status === 400);
const a = await call("POST", "/api/tasks", { title: "Task A", goalId, isPriority: true, subtasks: [{ title: "sub 1" }] }, T);
check("create task", a.status === 201 && a.data.task.isPriority && a.data.task.subtasks.length === 1, JSON.stringify(a.data));
const b = await call("POST", "/api/tasks", { title: "Task B", dueDate: localDate(1), startTime: "09:00", eisenhower: "schedule" }, T);
check("create future task", b.status === 201 && b.data.task.dueDate === localDate(1));
const c = await call("POST", "/api/tasks", { title: "Task C", isPriority: true }, T);
const afterC = await call("GET", `/api/tasks/${a.data.task.id}`, undefined, T);
check("only one priority task", c.data.task.isPriority && afterC.data.task.isPriority === false);

const done = await call("PATCH", `/api/tasks/${c.data.task.id}`, { completed: true }, T);
check("complete priority task -> +50 XP", done.data.events?.[0]?.amount === 50 && done.data.task.isPriority === false, JSON.stringify(done.data.events));
const undo = await call("PATCH", `/api/tasks/${c.data.task.id}`, { completed: false }, T);
check("un-complete refunds XP", undo.data.events?.[0]?.amount === -50 && undo.data.events[0].total === 0, JSON.stringify(undo.data.events));
const doneB = await call("PATCH", `/api/tasks/${b.data.task.id}`, { completed: true }, T);
check("complete normal task -> +20 XP", doneB.data.events?.[0]?.amount === 20);

const subId = a.data.task.subtasks[0].id;
const subDone = await call("PATCH", `/api/tasks/${a.data.task.id}/subtasks/${subId}`, { completed: true }, T);
check("subtask complete -> +5 XP", subDone.data.events?.[0]?.amount === 5 && subDone.data.task.subtasks[0].completed);
const addSub = await call("POST", `/api/tasks/${a.data.task.id}/subtasks`, { title: "sub 2" }, T);
check("add subtask", addSub.status === 201 && addSub.data.task.subtasks.length === 2);
const delSub = await call("DELETE", `/api/tasks/${a.data.task.id}/subtasks/${subId}`, undefined, T);
check("delete subtask", delSub.data.task.subtasks.length === 1);

const q = await call("POST", "/api/tasks", { title: "Queued idea", goalId, dueDate: null }, T);
check("create queued task (no date)", q.status === 201 && q.data.task.dueDate === null, JSON.stringify(q.data));
const qs = await call("PATCH", `/api/tasks/${q.data.task.id}`, { dueDate: localDate(2) }, T);
check("schedule queued task", qs.data.task.dueDate === localDate(2));
const qb = await call("PATCH", `/api/tasks/${q.data.task.id}`, { dueDate: null }, T);
check("move task back to queue", qb.status === 200 && qb.data.task.dueDate === null);
check("queued task not in date range", !(await call("GET", `/api/tasks?from=${localDate()}&to=${localDate(5)}`, undefined, T)).data.tasks.some((t) => t.id === q.data.task.id));
const qd = await call("PATCH", `/api/tasks/${q.data.task.id}`, { completed: true }, T);
check("complete queued task", qd.data.task.completed && !!qd.data.task.completedAt && qd.data.events?.[0]?.amount === 20);
await call("PATCH", `/api/tasks/${q.data.task.id}`, { completed: false }, T);

const edit = await call("PATCH", `/api/tasks/${a.data.task.id}`, { title: "Task A (edited)", description: "notes", eisenhower: "do-first" }, T);
check("edit task", edit.data.task.title === "Task A (edited)" && edit.data.task.eisenhower === "do-first");
const range = await call("GET", `/api/tasks?from=${localDate(1)}&to=${localDate(1)}`, undefined, T);
check("tasks date range filter", range.data.tasks.length === 1 && range.data.tasks[0].title === "Task B");
await call("DELETE", `/api/tasks/${q.data.task.id}`, undefined, T);

// ---- ownership isolation ----
const other = await call("POST", "/api/auth/register", { name: "Other", email: "o_" + email, password });
const steal = await call("PATCH", `/api/tasks/${a.data.task.id}`, { title: "hacked" }, other.data.token);
check("other user cannot edit my task", steal.status === 404);
check("other user cannot attach my task to timer", (await call("POST", "/api/focus", { action: "attach", taskId: a.data.task.id }, other.data.token)).status === 404);

// ---- goals ----
const g = await call("POST", "/api/goals", { title: "Health", color: "#DB2777" }, T);
check("create goal", g.status === 201 && g.data.goal.color === "#DB2777");
const g2 = await call("PATCH", `/api/goals/${g.data.goal.id}`, { title: "Fitness" }, T);
check("rename goal", g2.data.goal.title === "Fitness");
await call("PATCH", `/api/tasks/${b.data.task.id}`, { goalId: g.data.goal.id }, T);
check("delete goal", (await call("DELETE", `/api/goals/${g.data.goal.id}`, undefined, T)).status === 200);
const bAfter = await call("GET", `/api/tasks/${b.data.task.id}`, undefined, T);
check("deleting goal uncategorizes its tasks", bAfter.data.task.goalId === null);

// ---- focus timer ----
check("start without a task is refused", (await call("POST", "/api/focus", { action: "start" }, T)).status === 400);
check("break locked while focusing", (await call("POST", "/api/focus", { action: "break", mode: "shortBreak", activity: "x" }, T)).status === 400);
check("cannot jump to a break", (await call("POST", "/api/focus", { action: "mode", mode: "longBreak" }, T)).status === 400);
check("cannot skip focus", (await call("POST", "/api/focus", { action: "skip" }, T)).status === 400);
let f = await call("POST", "/api/focus", { action: "start", taskId: a.data.task.id }, T);
check("start with a task attaches it", f.data.focus.running && f.data.focus.attachedTaskId === a.data.task.id && f.data.focus.endsAt > Date.now() + 24 * 60 * 1000);
f = await call("POST", "/api/focus", { action: "pause" }, T);
check("pause timer keeps remaining", !f.data.focus.running && f.data.focus.secondsLeft > 1490);
f = await call("POST", "/api/focus", { action: "start" }, T);
check("resume uses the attached task", f.data.focus.running);
// Simulate the work phase having ended 3 seconds ago (as if the device was closed).
const userId = boot.data.user.id;
await prisma.focusState.update({ where: { userId }, data: { endsAt: new Date(Date.now() - 3000) } });
const [r1, r2] = await Promise.all([call("GET", "/api/focus", undefined, T), call("GET", "/api/focus", undefined, T)]);
const xpEvents = [...(r1.data.events ?? []), ...(r2.data.events ?? [])];
check("finished session unlocks a short break that waits", r1.data.focus.mode === "shortBreak" && !r1.data.focus.running && r1.data.focus.secondsLeft === 300 && r1.data.focus.sessionCount === 1, JSON.stringify(r1.data.focus));
check("concurrent reconcile awards XP exactly once", xpEvents.length === 1 && xpEvents[0].amount === 25, JSON.stringify(xpEvents));
const boot2 = await call("GET", "/api/bootstrap", undefined, T);
const log = boot2.data.pomoLogs.find((l) => l.taskId === a.data.task.id);
check("session logged against task", log?.sessions === 1 && log.minutes === 25);
check("task pomodoroCount incremented", boot2.data.tasks.find((t) => t.id === a.data.task.id).pomodoroCount === 1);
check("streak recorded today", boot2.data.streakDays.includes(localDate()));
f = await call("POST", "/api/focus", { action: "mode", mode: "longBreak" }, T);
check("swap to long break once unlocked", f.data.focus.mode === "longBreak" && !f.data.focus.running && f.data.focus.secondsLeft === 900);
f = await call("POST", "/api/focus", { action: "break", mode: "shortBreak", activity: "💃 One-song dance party" }, T);
check("start break with a reward", f.data.focus.mode === "shortBreak" && f.data.focus.running && f.data.focus.breakActivity === "💃 One-song dance party" && f.data.focus.totalSeconds === 300);
f = await call("POST", "/api/focus", { action: "break", mode: "shortBreak", activity: "🐶 Pet time" }, T);
check("change reward keeps the running break", f.data.focus.running && f.data.focus.breakActivity === "🐶 Pet time");
await prisma.focusState.update({ where: { userId }, data: { endsAt: new Date(Date.now() - 1000) } });
f = await call("GET", "/api/focus", undefined, T);
check("finished break waits at focus", f.data.focus.mode === "work" && !f.data.focus.running && f.data.focus.breakActivity === null && (f.data.events ?? []).length === 0);
f = await call("POST", "/api/focus", { action: "start" }, T);
f = await call("POST", "/api/focus", { action: "reset" }, T);
await prisma.focusState.update({ where: { userId }, data: { mode: "shortBreak", secondsLeft: 300, totalSeconds: 300 } });
f = await call("POST", "/api/focus", { action: "skip" }, T);
check("skip break -> paused focus", f.data.focus.mode === "work" && !f.data.focus.running);
check("invalid mode rejected", (await call("POST", "/api/focus", { action: "mode", mode: "nap" }, T)).status === 400);
f = await call("POST", "/api/focus", { action: "reset" }, T);
check("reset timer", f.data.focus.mode === "work" && !f.data.focus.running && f.data.focus.sessionCount === 0);

// ---- settings ----
const s = await call("PATCH", "/api/settings", { pomoWork: 50, alarmEnabled: false, reminderMinutes: 15 }, T);
check("update settings", s.data.user.settings.pomoWork === 50 && s.data.user.settings.alarmEnabled === false);
check("paused timer adopts new work length", s.data.focus.secondsLeft === 3000 && s.data.focus.totalSeconds === 3000);
check("new users get a 1-minute task alarm", boot.data.user.settings.reminderMinutes === 1 && Array.isArray(boot.data.user.settings.customBreaks));
const cb = await call("PATCH", "/api/settings", { customBreaks: [{ id: "a1", title: "Mango lassi", emoji: "🥭", length: "short" }] }, T);
check("save custom breaks", cb.data.user.settings.customBreaks?.[0]?.title === "Mango lassi", JSON.stringify(cb.data));
check("invalid custom break rejected", (await call("PATCH", "/api/settings", { customBreaks: [{ id: "a", title: "", length: "short" }] }, T)).status === 400);
check("invalid youtube link rejected", (await call("PATCH", "/api/settings", { youtubeUrl: "https://example.com" }, T)).status === 400);
check("valid youtube link saved", (await call("PATCH", "/api/settings", { youtubeUrl: "https://youtu.be/jfKfPfyJRdk" }, T)).status === 200);

// ---- legacy import (original localStorage format) ----
const imp = await call("POST", "/api/import", {
  tasks: [
    { id: "old1", title: "Old task", goalId: "g_1", completed: true, dueDate: "2025-01-02", eatTheFrog: false, subtasks: [{ id: "s", title: "old sub", completed: true }] },
    { id: "old2", title: "Old priority", goalId: null, completed: false, dueDate: localDate(), eatTheFrog: true, subtasks: [] },
  ],
  goals: [{ id: "g_1", title: "Personal Growth", color: "#6366F1" }, { id: "g_x", title: "Side project", color: "#D97706" }],
  xp: 340,
  pomoLog: [{ date: "2025-01-02", sessions: 3, taskId: "old1" }],
  streaks: ["2025-01-01", "2025-01-02"],
}, T);
check("import legacy data", imp.status === 200 && imp.data.imported.tasks === 2 && imp.data.imported.goals === 2, JSON.stringify(imp.data));
const boot3 = await call("GET", "/api/bootstrap", undefined, T);
check("import merged goals by name (3 total)", boot3.data.goals.length === 3, boot3.data.goals.map((x) => x.title).join());
check("import added XP", boot3.data.user.xp >= 340);
check("import kept single priority", boot3.data.tasks.filter((t) => t.isPriority).length === 1);

// ---- account ----
const pw = await call("PATCH", "/api/auth/me", { currentPassword: password, newPassword: "new-password-2" }, T);
check("change password returns new token", pw.status === 200 && !!pw.data.token);
check("old token revoked after password change", (await call("GET", "/api/auth/me", undefined, T)).status === 401);
const T2 = pw.data.token;
check("new token works", (await call("GET", "/api/auth/me", undefined, T2)).status === 200);
check("delete account needs right password", (await call("DELETE", "/api/auth/me", { password: "wrong" }, T2)).status === 403);
check("delete account", (await call("DELETE", "/api/auth/me", { password: "new-password-2" }, T2)).status === 200);
check("data removed with account", (await prisma.task.count({ where: { userId } })) === 0);
await call("DELETE", "/api/auth/me", { password }, other.data.token);

await prisma.$disconnect();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
