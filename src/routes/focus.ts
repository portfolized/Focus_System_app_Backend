import { Router } from "express";
import { prisma } from "../lib/db.js";
import { currentUser, requireAuth } from "../lib/auth.js";
import { buildBootstrap } from "../lib/bootstrap.js";
import { applyFocusAction, getFocusState, phaseSeconds, reconcileFocus } from "../lib/focus.js";
import { badRequest, requestTimeZone } from "../lib/http.js";
import { toFocusDTO, toUserDTO } from "../lib/serialize.js";
import { findOwnedTask } from "../lib/tasks.js";
import { focusActionSchema, settingsSchema } from "../lib/validation.js";
import { youtubeId } from "../shared/logic.js";

/** GET /api/bootstrap — everything a client needs to render, in one round trip. */
export const bootstrapRouter = Router();
bootstrapRouter.get("/", requireAuth, async (req, res) => {
  let user = currentUser(req);
  const tz = requestTimeZone(req, user.timezone);
  if (tz !== user.timezone) {
    user = await prisma.user.update({ where: { id: user.id }, data: { timezone: tz } });
  }
  res.json(await buildBootstrap(user, tz));
});

export const focusRouter = Router();
focusRouter.use(requireAuth);

/** GET /api/focus — current timer; also advances finished phases (logs sessions + XP). */
focusRouter.get("/", async (req, res) => {
  const user = currentUser(req);
  const { state, events } = await reconcileFocus(user, requestTimeZone(req, user.timezone));
  res.json({ focus: toFocusDTO(state), events, serverTime: Date.now() });
});

/**
 * POST /api/focus { action: start [taskId] | pause | reset | skip }, { action: attach, taskId },
 * { action: mode, mode } or { action: break, mode, activity }.
 */
focusRouter.post("/", async (req, res) => {
  const user = currentUser(req);
  const action = focusActionSchema.parse(req.body);
  if ((action.action === "attach" || action.action === "start") && action.taskId) {
    await findOwnedTask(user.id, action.taskId);
  }
  const { state, events } = await reconcileFocus(user, requestTimeZone(req, user.timezone));
  const next = await applyFocusAction(user, state, action);
  res.json({ focus: toFocusDTO(next), events, serverTime: Date.now() });
});

/** PATCH /api/settings — timer lengths, YouTube link, alarm, reminder lead time, custom breaks. */
export const settingsRouter = Router();
settingsRouter.patch("/", requireAuth, async (req, res) => {
  const user = currentUser(req);
  const body = settingsSchema.parse(req.body);
  if (body.youtubeUrl && !youtubeId(body.youtubeUrl)) throw badRequest("Paste a valid YouTube link");

  const updated = await prisma.user.update({ where: { id: user.id }, data: body });

  // Like the original: a paused timer picks up the new length for its current phase.
  let focus = await getFocusState(updated);
  const durationChanged =
    body.pomoWork !== undefined || body.pomoShortBreak !== undefined || body.pomoLongBreak !== undefined;
  if (durationChanged && !focus.running) {
    const secs = phaseSeconds(focus.mode, updated);
    if (secs !== focus.totalSeconds) {
      focus = await prisma.focusState.update({
        where: { userId: user.id },
        data: { secondsLeft: secs, totalSeconds: secs, version: { increment: 1 } },
      });
    }
  }
  res.json({ user: toUserDTO(updated), focus: toFocusDTO(focus) });
});
