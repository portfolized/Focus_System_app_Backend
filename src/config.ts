// Local development: load .env if present. On Vercel, env vars come from the project settings.
try {
  process.loadEnvFile();
} catch {
  // no .env file — fine in production
}

function required(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name} (see .env.example)`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? "0.0.0.0",
  isProd: process.env.NODE_ENV === "production",
  authSecret: required("AUTH_SECRET"),
  /** Browser origins allowed to call the API with cookies (the website). Comma separated. */
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:3000")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};

if (config.authSecret.length < 32) {
  throw new Error("AUTH_SECRET must be at least 32 characters");
}
