import { Router } from "express";
import { prisma } from "../lib/db.js";
import { currentUser, requireAuth } from "../lib/auth.js";
import { awardXp, markStreak } from "../lib/gamify.js";
import { notFound, requestTimeZone } from "../lib/http.js";
import { taskInclude, toTaskDTO } from "../lib/serialize.js";
import { assertGoalOwned, assertSchedulable, findOwnedTask } from "../lib/tasks.js";
import {
  subtaskCreateSchema,
  subtaskUpdateSchema,
  taskCreateSchema,
  taskUpdateSchema,
} from "../lib/validation.js";
import { todayInTz, XP_REWARDS } from "../shared/logic.js";
import type { XpEvent } from "../shared/types.js";

export const tasksRouter = Router();
tasksRouter.use(requireAuth);

/** GET /api/tasks?from=YYYY-MM-DD&to=YYYY-MM-DD (both optional, inclusive) */
tasksRouter.get("/", async (req, res) => {
  const user = currentUser(req);
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;
  const tasks = await prisma.task.findMany({
    where: { userId: user.id, dueDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } },
    include: taskInclude,
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
  });
  res.json({ tasks: tasks.map(toTaskDTO) });
});

tasksRouter.post("/", async (req, res) => {
  const user = currentUser(req);
  const tz = requestTimeZone(req, user.timezone);
  const body = taskCreateSchema.parse(req.body);
  const today = todayInTz(tz);
  const dueDate = body.dueDate ?? today;

  assertSchedulable(tz, dueDate, body.startTime);
  await assertGoalOwned(user.id, body.goalId);

  const task = await prisma.$transaction(async (tx) => {
    // Only one priority ("eat the frog") task at a time.
    if (body.isPriority) {
      await tx.task.updateMany({ where: { userId: user.id, isPriority: true }, data: { isPriority: false } });
    }
    const created = await tx.task.create({
      data: {
        userId: user.id,
        title: body.title,
        description: body.description,
        goalId: body.goalId,
        dueDate,
        startTime: body.startTime,
        endTime: body.endTime,
        eisenhower: body.eisenhower,
        isPriority: body.isPriority,
        subtasks: {
          create: body.subtasks.map((s, i) => ({ title: s.title, completed: !!s.completed, sortOrder: i })),
        },
      },
      include: taskInclude,
    });
    await markStreak(tx, user.id, today);
    return created;
  });
  res.status(201).json({ task: toTaskDTO(task) });
});

tasksRouter.get("/:id", async (req, res) => {
  const user = currentUser(req);
  await findOwnedTask(user.id, req.params.id);
  const task = await prisma.task.findUniqueOrThrow({ where: { id: req.params.id }, include: taskInclude });
  res.json({ task: toTaskDTO(task) });
});

/** PATCH /api/tasks/:id — edit fields, complete/reopen (XP), make priority. */
tasksRouter.patch("/:id", async (req, res) => {
  const user = currentUser(req);
  const tz = requestTimeZone(req, user.timezone);
  const id = req.params.id;
  const existing = await findOwnedTask(user.id, id);
  const body = taskUpdateSchema.parse(req.body);

  const dueDate = body.dueDate ?? existing.dueDate;
  const startTime = body.startTime !== undefined ? body.startTime : existing.startTime;
  const scheduleChanged =
    (body.dueDate !== undefined && body.dueDate !== existing.dueDate) ||
    (body.startTime !== undefined && body.startTime !== existing.startTime);
  if (scheduleChanged) assertSchedulable(tz, dueDate, startTime);
  if (body.goalId !== undefined) await assertGoalOwned(user.id, body.goalId);

  const result = await prisma.$transaction(async (tx) => {
    const events: XpEvent[] = [];
    const data: Record<string, unknown> = {};
    for (const key of ["title", "description", "goalId", "dueDate", "startTime", "endTime", "eisenhower"] as const) {
      if (body[key] !== undefined) data[key] = body[key];
    }

    if (body.isPriority !== undefined) {
      if (body.isPriority && !existing.isPriority) {
        await tx.task.updateMany({
          where: { userId: user.id, isPriority: true, id: { not: id } },
          data: { isPriority: false },
        });
      }
      data.isPriority = body.isPriority;
    }

    if (body.completed !== undefined && body.completed !== existing.completed) {
      data.completed = body.completed;
      if (body.completed) {
        const wasPriority = body.isPriority ?? existing.isPriority;
        const amount = wasPriority ? XP_REWARDS.priorityTask : XP_REWARDS.task;
        data.completedAt = new Date();
        data.isPriority = false;
        data.xpAwarded = amount;
        events.push(await awardXp(tx, user.id, amount, "Task Completed"));
      } else {
        data.completedAt = null;
        data.xpAwarded = 0;
        if (existing.xpAwarded) events.push(await awardXp(tx, user.id, -existing.xpAwarded, "Task reopened"));
      }
      await markStreak(tx, user.id, todayInTz(tz));
    }

    const task = await tx.task.update({ where: { id }, data, include: taskInclude });
    return { task, events };
  });
  res.json({ task: toTaskDTO(result.task), events: result.events });
});

tasksRouter.delete("/:id", async (req, res) => {
  const user = currentUser(req);
  const id = req.params.id;
  await findOwnedTask(user.id, id);
  await prisma.$transaction([
    prisma.task.delete({ where: { id } }),
    prisma.focusState.updateMany({
      where: { userId: user.id, attachedTaskId: id },
      data: { attachedTaskId: null, version: { increment: 1 } },
    }),
  ]);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- subtasks

tasksRouter.post("/:id/subtasks", async (req, res) => {
  const user = currentUser(req);
  const id = req.params.id;
  await findOwnedTask(user.id, id);
  const { title } = subtaskCreateSchema.parse(req.body);
  const count = await prisma.subtask.count({ where: { taskId: id } });
  await prisma.subtask.create({ data: { taskId: id, title, sortOrder: count } });
  const task = await prisma.task.findUniqueOrThrow({ where: { id }, include: taskInclude });
  res.status(201).json({ task: toTaskDTO(task) });
});

async function findSubtask(userId: string, taskId: string, subId: string) {
  await findOwnedTask(userId, taskId);
  const sub = await prisma.subtask.findFirst({ where: { id: subId, taskId } });
  if (!sub) throw notFound("Subtask not found");
  return sub;
}

tasksRouter.patch("/:id/subtasks/:subId", async (req, res) => {
  const user = currentUser(req);
  const { id, subId } = req.params;
  const sub = await findSubtask(user.id, id, subId);
  const body = subtaskUpdateSchema.parse(req.body);

  const result = await prisma.$transaction(async (tx) => {
    const events: XpEvent[] = [];
    const data: { title?: string; completed?: boolean; xpAwarded?: number } = {};
    if (body.title !== undefined) data.title = body.title;
    if (body.completed !== undefined && body.completed !== sub.completed) {
      data.completed = body.completed;
      if (body.completed) {
        data.xpAwarded = XP_REWARDS.subtask;
        events.push(await awardXp(tx, user.id, XP_REWARDS.subtask, "Subtask Completed"));
      } else {
        data.xpAwarded = 0;
        if (sub.xpAwarded) events.push(await awardXp(tx, user.id, -sub.xpAwarded, "Subtask reopened"));
      }
    }
    await tx.subtask.update({ where: { id: subId }, data });
    const task = await tx.task.findUniqueOrThrow({ where: { id }, include: taskInclude });
    return { task, events };
  });
  res.json({ task: toTaskDTO(result.task), events: result.events });
});

tasksRouter.delete("/:id/subtasks/:subId", async (req, res) => {
  const user = currentUser(req);
  const { id, subId } = req.params;
  await findSubtask(user.id, id, subId);
  await prisma.subtask.delete({ where: { id: subId } });
  const task = await prisma.task.findUniqueOrThrow({ where: { id }, include: taskInclude });
  res.json({ task: toTaskDTO(task) });
});
