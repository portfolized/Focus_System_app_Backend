import type { ErrorRequestHandler, Request } from "express";
import { ZodError } from "zod";
import { isValidTimeZone, todayInTz } from "../shared/logic.js";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string) => new ApiError(400, msg);
export const notFound = (msg = "Not found") => new ApiError(404, msg);

/** Uniform JSON errors: { error: "message" }. Express 5 forwards async throws here. */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof ZodError) {
    const first = err.issues[0];
    const field = first?.path.join(".");
    res.status(400).json({ error: field ? `${field}: ${first.message}` : "Invalid request" });
    return;
  }
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: "Invalid JSON body" });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Something went wrong" });
};

/**
 * The client's time zone. Both clients send `X-Timezone`; falls back to the
 * zone stored on the user. "Today" is always the user's local calendar day.
 */
export function requestTimeZone(req: Request, fallback = "UTC") {
  const tz = req.get("x-timezone");
  return tz && isValidTimeZone(tz) ? tz : fallback;
}

export function requestToday(req: Request, fallbackTz = "UTC") {
  return todayInTz(requestTimeZone(req, fallbackTz));
}
