// Pure helpers shared by the API and the web client (ported from shared.js).

export const XP_REWARDS = {
  task: 20,
  priorityTask: 50,
  subtask: 5,
  focusSession: 25,
} as const;

export const GOAL_COLORS = ["#4F46E5", "#059669", "#D97706", "#DC2626", "#DB2777", "#7C3AED"];

export function getLevelInfo(xp: number) {
  const level = Math.floor(xp / 100) + 1;
  const xpInLevel = xp % 100;
  return { level, xpInLevel, nextLevelXp: 100 };
}

export function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function toDateStr(d: Date = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Local calendar date (YYYY-MM-DD) in an IANA time zone. */
export function todayInTz(timeZone: string, at: Date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(at);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/** Minutes since midnight in an IANA time zone. */
export function minutesNowInTz(timeZone: string, at: Date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(at);
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
    const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    return h * 60 + m;
  } catch {
    return at.getUTCHours() * 60 + at.getUTCMinutes();
  }
}

export function timeToMinutes(t: string | null | undefined) {
  if (!t) return null;
  const [h, m] = t.split(":");
  return parseInt(h, 10) * 60 + parseInt(m, 10);
}

export function isValidTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function shiftDate(dateStr: string, days: number) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

export function fmtDate(iso: string) {
  if (!iso) return "";
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function fmtDateShort(iso: string) {
  if (!iso) return "";
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function fmtClock(totalSeconds: number) {
  const s = Math.max(0, totalSeconds);
  return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
}

export function focusModeLabel(mode: string) {
  return mode === "work" ? "FOCUS" : mode === "shortBreak" ? "SHORT BREAK" : "LONG BREAK";
}

export const EISENHOWER_LABELS: Record<string, string> = {
  "do-first": "Do First",
  schedule: "Schedule",
  delegate: "Delegate",
  eliminate: "Eliminate",
};

export function youtubeId(url: string | null | undefined) {
  if (!url) return "";
  const match = String(url).match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|live\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/,
  );
  return match ? match[1] : "";
}

export function streakCount(days: string[], today: string) {
  if (!days.length) return 0;
  const sorted = [...days].sort().reverse();
  const end = new Date(today + "T00:00:00").getTime();
  let count = 0;
  for (const s of sorted) {
    const diff = Math.round((end - new Date(s + "T00:00:00").getTime()) / 86400000);
    if (diff === count) count++;
    else if (diff > count) break;
  }
  return count;
}
