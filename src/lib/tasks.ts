import { minutesNowInTz, timeToMinutes, todayInTz } from "../shared/logic.js";
import { badRequest, notFound } from "./http.js";
import { prisma } from "./db.js";

/** Same rules as the original app: no past dates, no past start time today. */
export function assertSchedulable(timeZone: string, dueDate: string, startTime: string | null | undefined) {
  const today = todayInTz(timeZone);
  if (dueDate < today) throw badRequest("Cannot schedule tasks in the past");
  if (startTime && dueDate === today) {
    const mins = timeToMinutes(startTime);
    if (mins !== null && mins <= minutesNowInTz(timeZone)) {
      throw badRequest("Cannot schedule a past time for today");
    }
  }
}

export async function assertGoalOwned(userId: string, goalId: string | null | undefined) {
  if (!goalId) return;
  const goal = await prisma.goal.findFirst({ where: { id: goalId, userId }, select: { id: true } });
  if (!goal) throw badRequest("Goal not found");
}

export async function findOwnedTask(userId: string, id: string) {
  const task = await prisma.task.findFirst({ where: { id, userId } });
  if (!task) throw notFound("Task not found");
  return task;
}
