// JWT helpers. Kept free of Node-only imports so proxy.ts can use them too.
import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE = "fs_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function secretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET must be set to a random string of at least 32 characters");
  }
  return new TextEncoder().encode(secret);
}

export interface SessionClaims {
  sub: string;
  tv: number;
}

export async function signSession(userId: string, tokenVersion: number) {
  return new SignJWT({ tv: tokenVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(secretKey());
}

export async function verifySession(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string") return null;
    return { sub: payload.sub, tv: typeof payload.tv === "number" ? payload.tv : 0 };
  } catch {
    return null;
  }
}
