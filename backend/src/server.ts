import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { apiRouter } from "./api";
import { getHttpErrorStatus } from "./httpError";

dotenv.config();

const app = express();
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS ?? "https://orbi-two-xi.vercel.app")
  .split(",").map(s => s.trim());

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || /^http:\/\/localhost(:\d+)?$/.test(origin)) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error("Not allowed by CORS"));
  },
}));
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
  const httpStatus = getHttpErrorStatus(err);
  if (httpStatus != null) {
    const msg = err instanceof Error ? err.message : "ERROR";
    const allowed = new Set([
      "FORBIDDEN",
      "UNAUTHORIZED",
      "NOT_CONNECTED",
      "NO_REFRESH_TOKEN",
      "GOOGLE_REFRESH_ERROR",
      "STRAVA_REFRESH_ERROR",
    ]);
    const error = allowed.has(msg) ? msg : httpStatus === 401 ? "UNAUTHORIZED" : httpStatus === 403 ? "FORBIDDEN" : "BAD_REQUEST";
    return res.status(httpStatus).json({ error });
  }
  console.error(err);
  return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
});

const port = Number(process.env.PORT ?? 3333);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`API on http://localhost:${port}`);
});
