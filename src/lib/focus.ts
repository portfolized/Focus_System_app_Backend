// Server-authoritative focus (pomodoro) timer.
//
// The timer is stored as "mode + absolute end time", so every device (web tab,
// phone, widget) shows the same countdown. When a phase ends, whichever request
// arrives first advances it; the `version` column makes that exactly-once.

import type { FocusState, Prisma, User } from "@prisma/client";
import { todayInTz, XP_REWARDS } from "../shared/logic.js";
import type { FocusMode, XpEvent } from "../shared/types.js";
import { prisma } from "./db.js";
import { awardXp, markStreak } from "./gamify.js";

type Settings = Pick<User, "pomoWork" | "pomoShortBreak" | "pomoLongBreak" | "pomoLongInterval">;

/** If a device was away this long, stop replaying phases and park the timer. */
const MAX_REPLAYED_PHASES = 12;

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

/** Advances any phases that have ended. Returns the current state and XP events it produced. */
export async function reconcileFocus(
  user: User,
  timeZone: string,
  now = Date.now(),
): Promise<{ state: FocusState; events: XpEvent[] }> {
  const f = await getFocusState(user);
  if (!f.running || !f.endsAt || f.endsAt.getTime() > now) return { state: f, events: [] };

  let mode = f.mode as FocusMode;
  let endsAt = f.endsAt.getTime();
  let sessionCount = f.sessionCount;
  const completedWorkDates: string[] = [];
  let replayed = 0;

  while (endsAt <= now && replayed < MAX_REPLAYED_PHASES) {
    if (mode === "work") {
      sessionCount++;
      completedWorkDates.push(todayInTz(timeZone, new Date(endsAt)));
      mode = sessionCount % user.pomoLongInterval === 0 ? "longBreak" : "shortBreak";
    } else {
      mode = "work";
    }
    endsAt += phaseSeconds(mode, user) * 1000;
    replayed++;
  }

  const parked = endsAt <= now; // away for too long: stop at the start of the next phase
  const total = phaseSeconds(mode, user);

  return prisma.$transaction(async (tx) => {
    const claimed = await tx.focusState.updateMany({
      where: { userId: user.id, version: f.version },
      data: {
        mode,
        sessionCount,
        running: !parked,
        endsAt: parked ? null : new Date(endsAt),
        secondsLeft: parked ? total : Math.ceil((endsAt - now) / 1000),
        totalSeconds: total,
        version: { increment: 1 },
      },
    });
    const events: XpEvent[] = [];
    if (claimed.count === 1) {
      const task = f.attachedTaskId
        ? await tx.task.findFirst({ where: { id: f.attachedTaskId, userId: user.id } })
        : null;
      for (const date of completedWorkDates) {
        await logSession(tx, user.id, date, task?.id ?? null, user.pomoWork);
        if (task) await tx.task.update({ where: { id: task.id }, data: { pomodoroCount: { increment: 1 } } });
        events.push(await awardXp(tx, user.id, XP_REWARDS.focusSession, "Focus Session Complete"));
        await markStreak(tx, user.id, date);
      }
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
  | { action: "start" }
  | { action: "pause" }
  | { action: "reset" }
  | { action: "skip" }
  | { action: "mode"; mode: FocusMode }
  | { action: "attach"; taskId: string | null };

/** Applies a user action to the (already reconciled) timer. */
export async function applyFocusAction(user: User, f: FocusState, a: FocusAction, now = Date.now()) {
  const data: Partial<FocusState> = {};
  switch (a.action) {
    case "start":
      if (f.running) return f;
      data.running = true;
      data.endsAt = new Date(now + Math.max(1, f.secondsLeft) * 1000);
      break;
    case "pause":
      if (!f.running || !f.endsAt) return f;
      data.running = false;
      data.secondsLeft = Math.max(1, Math.ceil((f.endsAt.getTime() - now) / 1000));
      data.endsAt = null;
      break;
    case "reset":
      data.running = false;
      data.endsAt = null;
      data.mode = "work";
      data.sessionCount = 0;
      data.secondsLeft = data.totalSeconds = user.pomoWork * 60;
      break;
    case "skip": {
      // Jump to the next phase without logging a session.
      const next: FocusMode =
        f.mode !== "work" ? "work" : (f.sessionCount + 1) % user.pomoLongInterval === 0 ? "longBreak" : "shortBreak";
      const secs = phaseSeconds(next, user);
      data.mode = next;
      data.secondsLeft = data.totalSeconds = secs;
      data.endsAt = f.running ? new Date(now + secs * 1000) : null;
      break;
    }
    case "mode": {
      // Jump straight to a phase (e.g. take a break now). Paused, full length, like a fresh timer.
      const secs = phaseSeconds(a.mode, user);
      data.mode = a.mode;
      data.running = false;
      data.endsAt = null;
      data.secondsLeft = data.totalSeconds = secs;
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
