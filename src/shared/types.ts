// Data shapes exchanged by the API. The Flutter app mirrors these in lib/models.

export type Eisenhower = "do-first" | "schedule" | "delegate" | "eliminate";
export type FocusMode = "work" | "shortBreak" | "longBreak";

export interface SubtaskDTO {
  id: string;
  title: string;
  completed: boolean;
  sortOrder: number;
}

export interface TaskDTO {
  id: string;
  goalId: string | null;
  title: string;
  description: string;
  completed: boolean;
  completedAt: string | null;
  /** YYYY-MM-DD, or null while the task waits in its goal's queue. */
  dueDate: string | null;
  startTime: string | null;
  endTime: string | null;
  eisenhower: Eisenhower | null;
  isPriority: boolean;
  pomodoroCount: number;
  subtasks: SubtaskDTO[];
  createdAt: string;
  updatedAt: string;
}

export interface GoalDTO {
  id: string;
  title: string;
  color: string;
  icon: string;
  sortOrder: number;
}

/** A break reward the user added in Settings. "short" = quick treat, "long" = bigger treat. */
export interface BreakIdea {
  id: string;
  title: string;
  emoji: string;
  length: "short" | "long";
}

export interface UserSettings {
  pomoWork: number;
  pomoShortBreak: number;
  pomoLongBreak: number;
  pomoLongInterval: number;
  youtubeUrl: string;
  alarmEnabled: boolean;
  reminderMinutes: number;
  customBreaks: BreakIdea[];
}

export interface UserDTO {
  id: string;
  email: string;
  name: string;
  xp: number;
  timezone: string;
  settings: UserSettings;
  createdAt: string;
}

export interface PomoLogDTO {
  id: string;
  date: string;
  taskId: string | null;
  sessions: number;
  minutes: number;
}

export interface FocusDTO {
  mode: FocusMode;
  running: boolean;
  /** Epoch ms when the current phase ends (only when running). */
  endsAt: number | null;
  /** Remaining seconds (authoritative when paused, informational when running). */
  secondsLeft: number;
  totalSeconds: number;
  sessionCount: number;
  attachedTaskId: string | null;
  /** The reward picked for the current break. */
  breakActivity: string | null;
  version: number;
}

export interface XpEvent {
  amount: number;
  reason: string;
  total: number;
  level: number;
  leveledUp: boolean;
}

export interface BootstrapDTO {
  user: UserDTO;
  goals: GoalDTO[];
  tasks: TaskDTO[];
  pomoLogs: PomoLogDTO[];
  streakDays: string[];
  focus: FocusDTO;
  events: XpEvent[];
  serverTime: number;
  today: string;
}
