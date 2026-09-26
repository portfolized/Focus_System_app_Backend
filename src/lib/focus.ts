// Server-authoritative focus (pomodoro) timer.
//
// The timer is stored as "mode + absolute end time", so every device (web tab,
// phone, widget) shows the same countdown. When a phase ends, whichever request
// arrives first advances it; the `version` column makes that exactly-once.
//
// Phases do not run into each other: a finished focus session unlocks a break
// that waits (paused) until the user picks a reward, and a finished break waits
// at the next focus session. Focus only starts with a task attached.

import type { FocusState, Prisma, User } from "@prisma/client";
import { todayInTz, XP_REWARDS } from "../shared/logic.js";
import type { FocusMode, XpEvent } from "../shared/types.js";
import { prisma } from "./db.js";
import { awardXp, markStreak } from "./gamify.js";
import { badRequest } from "./http.js";

type Settings = Pick<User, "pomoWork" | "pomoShortBreak" | "pomoLongBreak" | "pomoLongInterval">;

export function phaseSeconds(mode: FocusMode | string, s: Settings) {
  if (mode === "shortBreak") return s.pomoShortBreak * 60;
  if (mode === "longBreak") return s.pomoLongBreak * 60;
  return s.pomoWork * 60;
}

export async function getFocusState(user: User) {
  return prisma.focusState.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      secondsLeft: user.pomoWork * 60,
      totalSeconds: user.pomoWork * 60,
    },
    update: {},
  });
}

/** Ends a phase whose time is up. Returns the current state and XP events it produced. */
export async function reconcileFocus(
  user: User,
  timeZone: string,
  now = Date.now(),
): Promise<{ state: FocusState; events: XpEvent[] }> {
  const f = await getFocusState(user);
  if (!f.running || !f.endsAt || f.endsAt.getTime() > now) return { state: f, events: [] };

  const finishedWork = f.mode === "work";
  const sessionCount = finishedWork ? f.sessionCount + 1 : f.sessionCount;
  const mode: FocusMode = !finishedWork
    ? "work"
    : sessionCount % user.pomoLongInterval === 0
      ? "longBreak"
      : "shortBreak";
  const total = phaseSeconds(mode, user);
  const completedDate = todayInTz(timeZone, f.endsAt);

  return prisma.$transaction(async (tx) => {
    const claimed = await tx.focusState.updateMany({
      where: { userId: user.id, version: f.version },
      data: {
        mode,
        sessionCount,
        running: false,
        endsAt: null,
        secondsLeft: total,
        totalSeconds: total,
        breakActivity: null,
        version: { increment: 1 },
      },
    });
    const events: XpEvent[] = [];
    if (claimed.count === 1 && finishedWork) {
      const task = f.attachedTaskId
        ? await tx.task.findFirst({ where: { id: f.attachedTaskId, userId: user.id } })
        : null;
      await logSession(tx, user.id, completedDate, task?.id ?? null, Math.round(f.totalSeconds / 60));
      if (task) await tx.task.update({ where: { id: task.id }, data: { pomodoroCount: { increment: 1 } } });
      events.push(await awardXp(tx, user.id, XP_REWARDS.focusSession, "Focus Session Complete"));
      await markStreak(tx, user.id, completedDate);
    }
    // If another request won the race, its result is what we return.
    const state = await tx.focusState.findUniqueOrThrow({ where: { userId: user.id } });
    return { state, events };
  });
}

async function logSession(
  tx: Prisma.TransactionClient,
  userId: string,
  date: string,
  taskId: string | null,
  minutes: number,
) {
  const existing = await tx.pomoLog.findFirst({ where: { userId, date, taskId } });
  if (existing) {
    await tx.pomoLog.update({
      where: { id: existing.id },
      data: { sessions: { increment: 1 }, minutes: { increment: minutes } },
    });
  } else {
    await tx.pomoLog.create({ data: { userId, date, taskId, sessions: 1, minutes } });
  }
}

export type FocusAction =
  | { action: "start"; taskId?: string }
  | { action: "pause" }
  | { action: "reset" }
  | { action: "skip" }
  | { action: "mode"; mode: FocusMode }
  | { action: "attach"; taskId: string | null }
  | { action: "break"; mode: "shortBreak" | "longBreak"; activity?: string | null };

const BREAK_LOCKED = "Finish your focus session first — breaks unlock when it ends";

/** Applies a user action to the (already reconciled) timer. */
export async function applyFocusAction(user: User, f: FocusState, a: FocusAction, now = Date.now()) {
  const data: Partial<FocusState> = {};
  const toWork = () => {
    data.mode = "work";
    data.running = false;
    data.endsAt = null;
    data.breakActivity = null;
    data.secondsLeft = data.totalSeconds = user.pomoWork * 60;
  };
  switch (a.action) {
    case "start": {
      if (f.running) return f;
      const taskId = a.taskId ?? f.attachedTaskId;
      if (f.mode === "work" && !taskId) throw badRequest("Choose a task to focus on first");
      if (a.taskId) data.attachedTaskId = a.taskId;
      data.running = true;
      data.endsAt = new Date(now + Math.max(1, f.secondsLeft) * 1000);
      break;
    }
    case "pause":
      if (!f.running || !f.endsAt) return f;
      data.running = false;
      data.secondsLeft = Math.max(1, Math.ceil((f.endsAt.getTime() - now) / 1000));
      data.endsAt = null;
      break;
    case "reset":
      toWork();
      data.sessionCount = 0;
      break;
    case "skip":
      // Only a break can be skipped; it goes back to a paused focus session.
      if (f.mode === "work") throw badRequest(BREAK_LOCKED);
      toWork();
      break;
    case "mode": {
      if (a.mode === "work") {
        toWork();
        break;
      }
      // Switching between short and long break is fine once a break is unlocked.
      if (f.mode === "work") throw badRequest(BREAK_LOCKED);
      if (f.running) return f;
      data.mode = a.mode;
      data.secondsLeft = data.totalSeconds = phaseSeconds(a.mode, user);
      break;
    }
    case "break": {
      if (f.mode === "work") throw badRequest(BREAK_LOCKED);
      data.breakActivity = a.activity?.trim() || null;
      if (f.running) break; // already on the break: just change the reward
      const secs = f.mode === a.mode ? Math.max(1, f.secondsLeft) : phaseSeconds(a.mode, user);
      data.mode = a.mode;
      data.running = true;
      data.totalSeconds = f.mode === a.mode ? f.totalSeconds : secs;
      data.secondsLeft = secs;
      data.endsAt = new Date(now + secs * 1000);
      break;
    }
    case "attach":
      data.attachedTaskId = a.taskId;
      break;
  }
  return prisma.focusState.update({
    where: { userId: user.id },
    data: { ...data, version: { increment: 1 } },
  });
}
