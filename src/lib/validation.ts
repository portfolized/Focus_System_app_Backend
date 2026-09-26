import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");
const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must be HH:mm")
  .nullable();
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "must be a hex color");

export const eisenhowerSchema = z.enum(["do-first", "schedule", "delegate", "eliminate"]).nullable();

export const registerSchema = z.object({
  name: z.string().trim().min(1, "is required").max(80),
  email: z.string().trim().toLowerCase().pipe(z.email("is not a valid email")),
  password: z.string().min(8, "must be at least 8 characters").max(200),
  timezone: z.string().optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(1, "is required"),
  password: z.string().min(1, "is required"),
  timezone: z.string().optional(),
});

export const updateMeSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  timezone: z.string().optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8, "must be at least 8 characters").max(200).optional(),
});

export const taskCreateSchema = z.object({
  title: z.string().trim().min(1, "is required").max(300),
  description: z.string().max(5000).optional().default(""),
  goalId: z.string().nullable().optional().default(null),
  // Omitted = today; null = the goal's queue (no date yet).
  dueDate: date.nullable().optional(),
  startTime: time.optional().default(null),
  endTime: time.optional().default(null),
  eisenhower: eisenhowerSchema.optional().default(null),
  isPriority: z.boolean().optional().default(false),
  subtasks: z
    .array(z.object({ title: z.string().trim().min(1).max(300), completed: z.boolean().optional() }))
    .max(100)
    .optional()
    .default([]),
});

export const taskUpdateSchema = z.object({
  title: z.string().trim().min(1, "is required").max(300).optional(),
  description: z.string().max(5000).optional(),
  goalId: z.string().nullable().optional(),
  dueDate: date.nullable().optional(),
  startTime: time.optional(),
  endTime: time.optional(),
  eisenhower: eisenhowerSchema.optional(),
  isPriority: z.boolean().optional(),
  completed: z.boolean().optional(),
});

export const subtaskCreateSchema = z.object({ title: z.string().trim().min(1).max(300) });
export const subtaskUpdateSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  completed: z.boolean().optional(),
});

export const goalCreateSchema = z.object({
  title: z.string().trim().min(1, "is required").max(80),
  color: color.optional(),
  icon: z.string().max(40).optional(),
});
export const goalUpdateSchema = goalCreateSchema.partial();

export const settingsSchema = z.object({
  pomoWork: z.number().int().min(1).max(120).optional(),
  pomoShortBreak: z.number().int().min(1).max(60).optional(),
  pomoLongBreak: z.number().int().min(1).max(60).optional(),
  pomoLongInterval: z.number().int().min(1).max(10).optional(),
  youtubeUrl: z.string().max(500).optional(),
  alarmEnabled: z.boolean().optional(),
  reminderMinutes: z.number().int().min(-1).max(240).optional(),
  customBreaks: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        title: z.string().trim().min(1, "is required").max(120),
        emoji: z.string().max(16).optional().default(""),
        length: z.enum(["short", "long"]),
      }),
    )
    .max(60)
    .optional(),
});

export const focusActionSchema = z.discriminatedUnion("action", [
  // taskId attaches that task first. A focus session can only start with a task attached.
  z.object({ action: z.literal("start"), taskId: z.string().optional() }),
  z.object({ action: z.literal("pause") }),
  z.object({ action: z.literal("reset") }),
  z.object({ action: z.literal("skip") }),
  z.object({ action: z.literal("mode"), mode: z.enum(["work", "shortBreak", "longBreak"]) }),
  z.object({ action: z.literal("attach"), taskId: z.string().nullable() }),
  // After a finished focus session: start the chosen break with a reward.
  z.object({
    action: z.literal("break"),
    mode: z.enum(["shortBreak", "longBreak"]),
    activity: z.string().trim().max(160).nullable().optional(),
  }),
]);

// Legacy localStorage export from the original HTML version.
const legacyTask = z.object({
  id: z.string(),
  title: z.string(),
  goalId: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  completed: z.boolean().optional(),
  createdAt: z.string().optional(),
  dueDate: z.string().nullable().optional(),
  startTime: z.string().nullable().optional(),
  endTime: z.string().nullable().optional(),
  eisenhower: z.string().nullable().optional(),
  eatTheFrog: z.boolean().optional(),
  pomodoroCount: z.number().optional(),
  subtasks: z
    .array(z.object({ id: z.string().optional(), title: z.string(), completed: z.boolean().optional() }))
    .nullable()
    .optional(),
});

export const importSchema = z.object({
  tasks: z.array(legacyTask).max(20000).optional().default([]),
  goals: z
    .array(z.object({ id: z.string(), title: z.string(), color: z.string().optional(), icon: z.string().optional() }))
    .max(500)
    .optional()
    .default([]),
  xp: z.number().min(0).optional(),
  pomoLog: z
    .array(z.object({ date: z.string(), sessions: z.number().optional(), taskId: z.string().nullable().optional() }))
    .max(50000)
    .optional()
    .default([]),
  streaks: z.array(z.string()).max(20000).optional().default([]),
  pomoSettings: z
    .object({
      work: z.number().optional(),
      shortBreak: z.number().optional(),
      longBreak: z.number().optional(),
      longBreakInterval: z.number().optional(),
    })
    .optional(),
  focusAudio: z.object({ youtubeUrl: z.string().optional(), alarmEnabled: z.boolean().optional() }).optional(),
});
