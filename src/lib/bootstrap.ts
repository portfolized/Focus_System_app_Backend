import type { User } from "@prisma/client";
import { prisma } from "./db.js";
import { reconcileFocus } from "./focus.js";
import { taskInclude, toFocusDTO, toGoalDTO, toPomoLogDTO, toTaskDTO, toUserDTO } from "./serialize.js";
import { todayInTz } from "../shared/logic.js";
import type { BootstrapDTO } from "../shared/types.js";

/** Everything a client needs to render, in one round trip. */
export async function buildBootstrap(user: User, timeZone: string): Promise<BootstrapDTO> {
  const { state: focus, events } = await reconcileFocus(user, timeZone);
  const [freshUser, goals, tasks, pomoLogs, streakDays] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
    prisma.goal.findMany({ where: { userId: user.id }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    prisma.task.findMany({
      where: { userId: user.id },
      include: taskInclude,
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
    }),
    prisma.pomoLog.findMany({ where: { userId: user.id }, orderBy: { date: "asc" } }),
    prisma.streakDay.findMany({ where: { userId: user.id }, orderBy: { date: "asc" } }),
  ]);

  return {
    user: toUserDTO(freshUser),
    goals: goals.map(toGoalDTO),
    tasks: tasks.map(toTaskDTO),
    pomoLogs: pomoLogs.map(toPomoLogDTO),
    streakDays: streakDays.map((s) => s.date),
    focus: toFocusDTO(focus),
    events,
    serverTime: Date.now(),
    today: todayInTz(timeZone),
  };
}
