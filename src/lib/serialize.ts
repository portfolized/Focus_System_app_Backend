import type { FocusState, Goal, PomoLog, Subtask, Task, User } from "@prisma/client";
import type {
  Eisenhower,
  FocusDTO,
  FocusMode,
  GoalDTO,
  PomoLogDTO,
  TaskDTO,
  UserDTO,
} from "../shared/types.js";

export const taskInclude = { subtasks: { orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }] } };

export function toTaskDTO(t: Task & { subtasks: Subtask[] }): TaskDTO {
  return {
    id: t.id,
    goalId: t.goalId,
    title: t.title,
    description: t.description,
    completed: t.completed,
    completedAt: t.completedAt?.toISOString() ?? null,
    dueDate: t.dueDate,
    startTime: t.startTime,
    endTime: t.endTime,
    eisenhower: (t.eisenhower as Eisenhower | null) ?? null,
    isPriority: t.isPriority,
    pomodoroCount: t.pomodoroCount,
    subtasks: t.subtasks.map((s) => ({
      id: s.id,
      title: s.title,
      completed: s.completed,
      sortOrder: s.sortOrder,
    })),
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

export function toGoalDTO(g: Goal): GoalDTO {
  return { id: g.id, title: g.title, color: g.color, icon: g.icon, sortOrder: g.sortOrder };
}

export function toUserDTO(u: User): UserDTO {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    xp: u.xp,
    timezone: u.timezone,
    createdAt: u.createdAt.toISOString(),
    settings: {
      pomoWork: u.pomoWork,
      pomoShortBreak: u.pomoShortBreak,
      pomoLongBreak: u.pomoLongBreak,
      pomoLongInterval: u.pomoLongInterval,
      youtubeUrl: u.youtubeUrl,
      alarmEnabled: u.alarmEnabled,
      reminderMinutes: u.reminderMinutes,
    },
  };
}

export function toPomoLogDTO(l: PomoLog): PomoLogDTO {
  return { id: l.id, date: l.date, taskId: l.taskId, sessions: l.sessions, minutes: l.minutes };
}

export function toFocusDTO(f: FocusState, now = Date.now()): FocusDTO {
  const endsAt = f.running && f.endsAt ? f.endsAt.getTime() : null;
  return {
    mode: f.mode as FocusMode,
    running: f.running,
    endsAt,
    secondsLeft: endsAt ? Math.max(0, Math.ceil((endsAt - now) / 1000)) : f.secondsLeft,
    totalSeconds: f.totalSeconds,
    sessionCount: f.sessionCount,
    attachedTaskId: f.attachedTaskId,
    version: f.version,
  };
}
