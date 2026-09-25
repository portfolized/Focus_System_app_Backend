import { Router } from "express";
import { prisma } from "../lib/db.js";
import { currentUser, requireAuth } from "../lib/auth.js";
import { importSchema } from "../lib/validation.js";
import { youtubeId } from "../shared/logic.js";

export const importRouter = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const EISENHOWER = new Set(["do-first", "schedule", "delegate", "eliminate"]);
const clampInt = (v: number | undefined, min: number, max: number) =>
  v === undefined || !Number.isFinite(v) ? undefined : Math.min(max, Math.max(min, Math.round(v)));

/**
 * Imports data exported from the original localStorage version of Focus System
 * (keys fs_tasks, fs_goals, fs_xp, fs_pomo_log, fs_streaks, fs_pomo_settings, fs_focus_audio).
 */
importRouter.post("/", requireAuth, async (req, res) => {
  const user = currentUser(req);
  const data = importSchema.parse(req.body);

  const summary = await prisma.$transaction(
    async (tx) => {
      // Goals: reuse an existing goal with the same title, otherwise create it.
      const existingGoals = await tx.goal.findMany({ where: { userId: user.id } });
      const goalIdMap = new Map<string, string>();
      let goalCount = existingGoals.length;
      for (const g of data.goals) {
        const match = existingGoals.find((e) => e.title.trim().toLowerCase() === g.title.trim().toLowerCase());
        if (match) {
          goalIdMap.set(g.id, match.id);
          continue;
        }
        const created = await tx.goal.create({
          data: {
            userId: user.id,
            title: g.title.trim().slice(0, 80) || "Goal",
            color: g.color && /^#[0-9a-fA-F]{6}$/.test(g.color) ? g.color : "#6366F1",
            icon: g.icon ?? "target",
            sortOrder: goalCount++,
          },
        });
        goalIdMap.set(g.id, created.id);
      }

      const taskIdMap = new Map<string, string>();
      let hasPriority = false;
      for (const t of data.tasks) {
        const dueDate = t.dueDate && DATE_RE.test(t.dueDate) ? t.dueDate : (t.createdAt ?? "").slice(0, 10);
        if (!DATE_RE.test(dueDate) || !t.title.trim()) continue;
        const isPriority = !!t.eatTheFrog && !t.completed && !hasPriority;
        if (isPriority) hasPriority = true;
        const created = await tx.task.create({
          data: {
            userId: user.id,
            title: t.title.trim().slice(0, 300),
            description: (t.description ?? "").slice(0, 5000),
            goalId: t.goalId ? (goalIdMap.get(t.goalId) ?? null) : null,
            completed: !!t.completed,
            completedAt: t.completed ? new Date(dueDate + "T12:00:00Z") : null,
            dueDate,
            startTime: t.startTime && TIME_RE.test(t.startTime) ? t.startTime : null,
            endTime: t.endTime && TIME_RE.test(t.endTime) ? t.endTime : null,
            eisenhower: t.eisenhower && EISENHOWER.has(t.eisenhower) ? t.eisenhower : null,
            isPriority,
            pomodoroCount: clampInt(t.pomodoroCount, 0, 100000) ?? 0,
            createdAt: t.createdAt && !isNaN(Date.parse(t.createdAt)) ? new Date(t.createdAt) : undefined,
            subtasks: {
              create: (t.subtasks ?? [])
                .filter((s) => s.title.trim())
                .map((s, i) => ({ title: s.title.trim().slice(0, 300), completed: !!s.completed, sortOrder: i })),
            },
          },
        });
        taskIdMap.set(t.id, created.id);
      }
      if (hasPriority) {
        // Keep the "single priority task" invariant against pre-existing tasks.
        await tx.task.updateMany({
          where: { userId: user.id, isPriority: true, id: { notIn: [...taskIdMap.values()] } },
          data: { isPriority: false },
        });
      }

      const pomoLogs = data.pomoLog
        .filter((l) => DATE_RE.test(l.date))
        .map((l) => {
          const sessions = clampInt(l.sessions, 1, 1000) ?? 1;
          return {
            userId: user.id,
            date: l.date,
            taskId: l.taskId ? (taskIdMap.get(l.taskId) ?? null) : null,
            sessions,
            minutes: sessions * (clampInt(data.pomoSettings?.work, 1, 120) ?? user.pomoWork),
          };
        });
      if (pomoLogs.length) await tx.pomoLog.createMany({ data: pomoLogs });

      const streakDates = [...new Set(data.streaks.filter((d) => DATE_RE.test(d)))];
      const existingStreaks = new Set(
        (await tx.streakDay.findMany({ where: { userId: user.id }, select: { date: true } })).map((s) => s.date),
      );
      const newStreaks = streakDates.filter((d) => !existingStreaks.has(d));
      if (newStreaks.length) {
        await tx.streakDay.createMany({ data: newStreaks.map((date) => ({ userId: user.id, date })) });
      }

      const ps = data.pomoSettings;
      const url = data.focusAudio?.youtubeUrl ?? "";
      await tx.user.update({
        where: { id: user.id },
        data: {
          xp: { increment: clampInt(data.xp, 0, 10_000_000) ?? 0 },
          pomoWork: clampInt(ps?.work, 1, 120),
          pomoShortBreak: clampInt(ps?.shortBreak, 1, 60),
          pomoLongBreak: clampInt(ps?.longBreak, 1, 60),
          pomoLongInterval: clampInt(ps?.longBreakInterval, 1, 10),
          youtubeUrl: url && youtubeId(url) ? url : undefined,
          alarmEnabled: data.focusAudio?.alarmEnabled,
        },
      });

      return {
        goals: goalIdMap.size,
        tasks: taskIdMap.size,
        focusLogs: pomoLogs.length,
        streakDays: newStreaks.length,
      };
    },
    { timeout: 60_000 },
  );

  res.json({ ok: true, imported: summary });
});
