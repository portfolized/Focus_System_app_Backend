import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import {
  assertNotRateLimited,
  checkPassword,
  clearAttempts,
  clearSession,
  currentUser,
  getUser,
  hashPassword,
  recordFailedAttempt,
  requireAuth,
  sessionToken,
  setSessionCookie,
} from "../lib/auth.js";
import { ApiError, badRequest } from "../lib/http.js";
import { toUserDTO } from "../lib/serialize.js";
import { loginSchema, registerSchema, updateMeSchema } from "../lib/validation.js";
import { isValidTimeZone } from "../shared/logic.js";

export const authRouter = Router();

const DEFAULT_GOALS = [
  { title: "Personal Growth", color: "#6366F1", icon: "target", sortOrder: 0 },
  { title: "Work & Projects", color: "#10B981", icon: "briefcase", sortOrder: 1 },
];

/** POST /api/auth/register { name, email, password, timezone? } → { user, token } */
authRouter.post("/register", async (req, res) => {
  const body = registerSchema.parse(req.body);
  const exists = await prisma.user.findUnique({ where: { email: body.email } });
  if (exists) throw new ApiError(409, "An account with this email already exists");

  const user = await prisma.user.create({
    data: {
      email: body.email,
      name: body.name,
      passwordHash: await hashPassword(body.password),
      timezone: body.timezone && isValidTimeZone(body.timezone) ? body.timezone : "UTC",
      goals: { create: DEFAULT_GOALS },
    },
  });
  // Mobile clients read the token from the body; browsers use the httpOnly cookie.
  const token = await sessionToken(user);
  setSessionCookie(res, token);
  res.status(201).json({ user: toUserDTO(user), token });
});

/** POST /api/auth/login { email, password, timezone? } → { user, token } */
authRouter.post("/login", async (req, res) => {
  const body = loginSchema.parse(req.body);
  const key = `${req.ip}:${body.email}`;
  assertNotRateLimited(key);

  let user = await prisma.user.findUnique({ where: { email: body.email } });
  if (!user || !(await checkPassword(body.password, user.passwordHash))) {
    recordFailedAttempt(key);
    throw new ApiError(401, "Incorrect email or password");
  }
  clearAttempts(key);
  if (body.timezone && isValidTimeZone(body.timezone) && body.timezone !== user.timezone) {
    user = await prisma.user.update({ where: { id: user.id }, data: { timezone: body.timezone } });
  }
  const token = await sessionToken(user);
  setSessionCookie(res, token);
  res.json({ user: toUserDTO(user), token });
});

/** POST /api/auth/logout { everywhere?: true } — with everywhere, every device is signed out. */
authRouter.post("/logout", async (req, res) => {
  if (req.body?.everywhere) {
    const user = await getUser(req);
    if (user) await prisma.user.update({ where: { id: user.id }, data: { tokenVersion: { increment: 1 } } });
  }
  clearSession(res);
  res.json({ ok: true });
});

/** GET /api/auth/logout — clears a stale cookie and goes to the website's login page. */
authRouter.get("/logout", (_req, res) => {
  clearSession(res);
  res.redirect("/login");
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: toUserDTO(currentUser(req)) });
});

/** PATCH /api/auth/me { name?, timezone?, currentPassword?, newPassword? } */
authRouter.patch("/me", requireAuth, async (req, res) => {
  const user = currentUser(req);
  const body = updateMeSchema.parse(req.body);
  const data: { name?: string; timezone?: string; passwordHash?: string; tokenVersion?: { increment: number } } = {};

  if (body.name) data.name = body.name;
  if (body.timezone) {
    if (!isValidTimeZone(body.timezone)) throw badRequest("Unknown time zone");
    data.timezone = body.timezone;
  }
  if (body.newPassword) {
    if (!body.currentPassword || !(await checkPassword(body.currentPassword, user.passwordHash))) {
      throw new ApiError(403, "Current password is incorrect");
    }
    data.passwordHash = await hashPassword(body.newPassword);
    data.tokenVersion = { increment: 1 }; // sign out other devices
  }

  const updated = await prisma.user.update({ where: { id: user.id }, data });
  if (!body.newPassword) {
    res.json({ user: toUserDTO(updated) });
    return;
  }
  // Password changed: old tokens are now invalid, so hand this device a fresh one.
  const token = await sessionToken(updated);
  setSessionCookie(res, token);
  res.json({ user: toUserDTO(updated), token });
});

/** DELETE /api/auth/me { password } — permanently deletes the account and all data. */
authRouter.delete("/me", requireAuth, async (req, res) => {
  const user = currentUser(req);
  const { password } = z.object({ password: z.string() }).parse(req.body);
  if (!(await checkPassword(password, user.passwordHash))) throw new ApiError(403, "Password is incorrect");
  await prisma.user.delete({ where: { id: user.id } });
  clearSession(res);
  res.json({ ok: true });
});
