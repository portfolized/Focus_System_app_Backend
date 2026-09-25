import cookieParser from "cookie-parser";
import cors, { type CorsOptions } from "cors";
import express, { type Express } from "express";
import helmetImport, { type HelmetOptions } from "helmet";
import morgan from "morgan";
import { config, configProblems } from "./config.js";
import { errorHandler, notFound } from "./lib/http.js";
import { authRouter } from "./routes/auth.js";
import { bootstrapRouter, focusRouter, settingsRouter } from "./routes/focus.js";
import { goalsRouter } from "./routes/goals.js";
import { importRouter } from "./routes/import.js";
import { tasksRouter } from "./routes/tasks.js";

// helmet ships CommonJS types. Depending on how the compiler resolves them (Vercel's build differs from
// our tsconfig), the default import is typed as either the function or the module object, so unwrap it.
// At runtime both shapes expose the function as `.default`.
type HelmetFn = (options?: Readonly<HelmetOptions>) => express.RequestHandler;
const helmet = ((helmetImport as unknown as { default?: HelmetFn }).default ??
  (helmetImport as unknown as HelmetFn)) as HelmetFn;

/** Registers middleware, routes and the error handler on an Express app. */
export function configureApp(app: Express) {

  // Behind the website's /api rewrite (or a reverse proxy): trust X-Forwarded-For for req.ip.
  app.set("trust proxy", "loopback");
  app.disable("x-powered-by");

  app.use(helmet({ crossOriginResourcePolicy: false }));
  // The website's origins may send the session cookie. Anyone else (the Flutter app, incl. when it
  // runs in a browser) authenticates with a Bearer token, so no credentials are allowed for them.
  app.use(
    cors((req, cb) => {
      const origin = req.header("Origin");
      const trusted = !!origin && config.corsOrigins.includes(origin);
      const options: CorsOptions = {
        origin: trusted ? origin : "*",
        credentials: trusted,
        methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization", "X-Timezone"],
        maxAge: 86400,
      };
      cb(null, options);
    }),
  );
  app.use(express.json({ limit: "5mb" }));
  app.use(cookieParser());
  if (!config.isProd) app.use(morgan("dev"));

  // Misconfigured deployment: say what is wrong instead of failing every request opaquely.
  if (configProblems.length) {
    app.use((_req, res) => {
      res.status(500).json({ error: "Server is misconfigured", problems: configProblems });
    });
    return app;
  }

  app.get("/", (_req, res) => {
    res.json({ name: "Focus System API", docs: "See README.md", health: "/api/health" });
  });
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, app: "focus-system", time: Date.now() });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/bootstrap", bootstrapRouter);
  app.use("/api/tasks", tasksRouter);
  app.use("/api/goals", goalsRouter);
  app.use("/api/focus", focusRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/import", importRouter);

  app.use((_req, _res, next) => next(notFound("No such endpoint")));
  app.use(errorHandler);
  return app;
}
