import type { Prisma } from "@prisma/client";
import { getLevelInfo } from "../shared/logic.js";
import type { XpEvent } from "../shared/types.js";

type Tx = Prisma.TransactionClient;

/** Adds (or with a negative amount, removes) XP. Never drops below 0. */
export async function awardXp(tx: Tx, userId: string, amount: number, reason: string): Promise<XpEvent> {
  const before = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { xp: true } });
  const total = Math.max(0, before.xp + amount);
  await tx.user.update({ where: { id: userId }, data: { xp: total } });
  const prevLevel = getLevelInfo(before.xp).level;
  const level = getLevelInfo(total).level;
  return { amount: total - before.xp, reason, total, level, leveledUp: level > prevLevel };
}

export async function markStreak(tx: Tx, userId: string, date: string) {
  await tx.streakDay.upsert({
    where: { userId_date: { userId, date } },
    create: { userId, date },
    update: {},
  });
}
