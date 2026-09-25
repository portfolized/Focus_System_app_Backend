import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Generous transaction limits: the database (Neon) may be far away when developing
// locally, and interactive transactions do several round trips.
export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ transactionOptions: { maxWait: 10_000, timeout: 20_000 } });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
