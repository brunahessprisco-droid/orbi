import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { apiRouter } from "./api";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api", apiRouter);

app.get("/health", async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ ok: true });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof z.ZodError) {
    return res.status(400).json({ error: "VALIDATION_ERROR", details: err.flatten() });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2025") return res.status(404).json({ error: "NOT_FOUND" });
    if (err.code === "P2002") return res.status(409).json({ error: "CONFLICT" });
  }
  console.error(err);
  return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
});

const port = Number(process.env.PORT ?? 3333);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`API on http://localhost:${port}`);
});
