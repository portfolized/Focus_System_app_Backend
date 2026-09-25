// Local development: load .env if present. On Vercel, env vars come from the project settings.
try {
  process.loadEnvFile();
} catch {
  // no .env file — fine in production
}

/**
 * Missing / invalid settings. We don't throw at import time: on Vercel that kills every request with an
 * opaque FUNCTION_INVOCATION_FAILED. Instead the app answers 500 with this list (see create-app.ts).
 */
export const configProblems: string[] = [];

for (const name of ["DATABASE_URL", "DIRECT_URL", "AUTH_SECRET"]) {
  if (!process.env[name]) configProblems.push(`Missing environment variable ${name} (see .env.example)`);
}
if (process.env.AUTH_SECRET && process.env.AUTH_SECRET.length < 32) {
  configProblems.push("AUTH_SECRET must be at least 32 characters");
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? "0.0.0.0",
  isProd: process.env.NODE_ENV === "production",
  /** Browser origins allowed to call the API with cookies (the website). Comma separated. */
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:3000")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean),
};

if (configProblems.length) console.error(`[config] ${configProblems.join("; ")}`);
