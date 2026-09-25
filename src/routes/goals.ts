import { Router } from "express";
import { prisma } from "../lib/db.js";
import { currentUser, requireAuth } from "../lib/auth.js";
import { notFound } from "../lib/http.js";
import { toGoalDTO } from "../lib/serialize.js";
import { goalCreateSchema, goalUpdateSchema } from "../lib/validation.js";
import { GOAL_COLORS } from "../shared/logic.js";

export const goalsRouter = Router();
goalsRouter.use(requireAuth);

goalsRouter.get("/", async (req, res) => {
  const user = currentUser(req);
  const goals = await prisma.goal.findMany({
    where: { userId: user.id },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  res.json({ goals: goals.map(toGoalDTO) });
});

goalsRouter.post("/", async (req, res) => {
  const user = currentUser(req);
  const body = goalCreateSchema.parse(req.body);
  const count = await prisma.goal.count({ where: { userId: user.id } });
  const goal = await prisma.goal.create({
    data: {
      userId: user.id,
      title: body.title,
      color: body.color ?? GOAL_COLORS[Math.floor(Math.random() * GOAL_COLORS.length)],
      icon: body.icon ?? "target",
      sortOrder: count,
    },
  });
  res.status(201).json({ goal: toGoalDTO(goal) });
});

async function findGoal(userId: string, id: string) {
  const goal = await prisma.goal.findFirst({ where: { id, userId } });
  if (!goal) throw notFound("Goal not found");
  return goal;
}

goalsRouter.patch("/:id", async (req, res) => {
  const user = currentUser(req);
  await findGoal(user.id, req.params.id);
  const body = goalUpdateSchema.parse(req.body);
  const goal = await prisma.goal.update({ where: { id: req.params.id }, data: body });
  res.json({ goal: toGoalDTO(goal) });
});

/** Tasks in the goal become uncategorized (onDelete: SetNull). */
goalsRouter.delete("/:id", async (req, res) => {
  const user = currentUser(req);
  await findGoal(user.id, req.params.id);
  await prisma.goal.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});
