import bcrypt from "bcryptjs";
import type { User } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import { prisma } from "./db.js";
import { ApiError } from "./http.js";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession, verifySession } from "./token.js";

declare module "express-serve-static-core" {
  interface Request {
    user?: User;
  }
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 11);
}

export async function checkPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

/** Token from `Authorization: Bearer` (mobile app) or the session cookie (website). */
export function extractToken(req: Request): string | null {
  const auth = req.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  return (req.cookies?.[SESSION_COOKIE] as string | undefined) ?? null;
}

export async function userFromToken(token: string): Promise<User | null> {
  const claims = await verifySession(token);
  if (!claims) return null;
  const user = await prisma.user.findUnique({ where: { id: claims.sub } });
  if (!user || user.tokenVersion !== claims.tv) return null;
  return user;
}

export async function getUser(req: Request) {
  const token = extractToken(req);
  return token ? userFromToken(token) : null;
}

/** Middleware: 401 unless signed in; sets `req.user`. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const user = await getUser(req);
  if (!user) throw new ApiError(401, "Not signed in");
  req.user = user;
  next();
}

/** For handlers behind requireAuth. */
export function currentUser(req: Request): User {
  if (!req.user) throw new ApiError(401, "Not signed in");
  return req.user;
}

export function sessionToken(user: User) {
  return signSession(user.id, user.tokenVersion);
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProd,
    path: "/",
    maxAge: SESSION_MAX_AGE * 1000,
  });
}

export function clearSession(res: Response) {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, path: "/" });
}

// ---- Simple in-memory brute-force protection for login ----
const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

export function assertNotRateLimited(key: string) {
  const entry = attempts.get(key);
  if (entry && entry.resetAt > Date.now() && entry.count >= MAX_ATTEMPTS) {
    throw new ApiError(429, "Too many attempts. Try again in a few minutes.");
  }
}

export function recordFailedAttempt(key: string) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
  else entry.count++;
}

export function clearAttempts(key: string) {
  attempts.delete(key);
}
