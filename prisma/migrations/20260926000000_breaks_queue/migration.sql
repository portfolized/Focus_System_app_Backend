-- Break rewards, goal task queue and 1-minute task alarms.

-- Custom break ideas made in Settings.
ALTER TABLE "User" ADD COLUMN "customBreaks" JSONB NOT NULL DEFAULT '[]';

-- Task alarms now ring 1 minute before the start by default (10 was the old default).
ALTER TABLE "User" ALTER COLUMN "reminderMinutes" SET DEFAULT 1;
UPDATE "User" SET "reminderMinutes" = 1 WHERE "reminderMinutes" = 10;

-- A task without a date sits in its goal's queue until it is scheduled.
ALTER TABLE "Task" ALTER COLUMN "dueDate" DROP NOT NULL;

-- The reward chosen for the current break.
ALTER TABLE "FocusState" ADD COLUMN "breakActivity" TEXT;
