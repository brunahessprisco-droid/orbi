import crypto from "crypto";
import express from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import NodeCache from "node-cache";

type AuthedRequest = express.Request & { userId?: string; sessionToken?: string };

function readBearerToken(req: express.Request): string | null {
  const header = req.header("authorization") || req.header("Authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function readQueryParam(req: express.Request, name: string): string | null {
  const raw = (req.query as Record<string, unknown>)[name];
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw.length ? String(raw[0]) : null;
  return typeof raw === "string" ? raw : String(raw);
}

function readRouteParam(req: express.Request, name: string): string | null {
  const raw = (req.params as Record<string, unknown>)[name];
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw.length ? String(raw[0]) : null;
  return typeof raw === "string" ? raw : String(raw);
}

function assertUserMatchesQuery(req: AuthedRequest) {
  const q = readQueryParam(req, "usuario_id");
  if (!q) return;
  if (!req.userId) throw Object.assign(new Error("UNAUTHORIZED"), { status: 401 });
  if (String(q) !== String(req.userId)) throw Object.assign(new Error("FORBIDDEN"), { status: 403 });
}

// In-memory session cache with 5-minute TTL
const sessionCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

async function requireAuth(req: AuthedRequest, res: express.Response, next: express.NextFunction) {
  const token = readBearerToken(req);
  if (!token) return res.status(401).json({ error: "UNAUTHORIZED" });

  // Check cache first
  const cached = sessionCache.get<string>(token);
  if (cached) {
    req.userId = cached;
    req.sessionToken = token;
    return next();
  }

  // Cache miss — query DB
  const session = await prisma.session.findUnique({ where: { token } });
  if (!session) return res.status(401).json({ error: "UNAUTHORIZED" });

  // Store in cache
  sessionCache.set(token, session.userId);

  req.userId = session.userId;
  req.sessionToken = token;
  return next();
}

function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, senhaHash: string) {
  const [salt, expectedHash] = senhaHash.split(":");
  if (!salt || !expectedHash) return false;
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(expectedHash, "hex"));
}

function toDecimal(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return new Prisma.Decimal(0);
  return new Prisma.Decimal(n);
}

export const apiRouter = express.Router();

apiRouter.get("/admin/users", async (req, res) => {
  const secret = (req.header("x-admin-secret") as string) || (req.query.secret as string);
  if (!secret || !process.env.ADMIN_SECRET || secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: "FORBIDDEN" });
  }
  const users = await prisma.user.findMany({
    select: { id: true, nome: true, email: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  return res.json({ total: users.length, users });
});

apiRouter.post("/admin/create-invite", async (req, res) => {
  const body = req.body as Record<string, string>;
  const secret = (req.header("x-admin-secret") as string) || body.adminSecret;
  if (!secret || !process.env.ADMIN_SECRET || secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: "FORBIDDEN" });
  }
  const inviteCode = body.code || ("ORBI-" + Math.random().toString(36).slice(2, 8).toUpperCase());
  await prisma.inviteCode.create({
    data: { id: crypto.randomUUID(), code: inviteCode, intendedEmail: body.intendedEmail || null, intendedName: body.intendedName || null, isActive: true },
  });
  return res.json({ ok: true, code: inviteCode });
});

apiRouter.get("/health", async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ ok: true });
});

apiRouter.post("/auth/register", async (req, res) => {
  try {
    const schema = z.object({
      nome: z.string().min(1),
      email: z.string().email(),
      senha: z.string().min(4),
      inviteCode: z.string().min(1),
    });

    const input = schema.parse(req.body);

    const invite = await prisma.inviteCode.findUnique({
      where: { code: input.inviteCode },
    });

    if (!invite) {
      return res.status(400).json({ error: "INVITE_CODE_NOT_FOUND" });
    }

    if (!invite.isActive) {
      return res.status(400).json({ error: "INVITE_CODE_INACTIVE" });
    }

    if (invite.usedAt) {
      return res.status(400).json({ error: "INVITE_CODE_ALREADY_USED" });
    }

    if (
      invite.intendedEmail &&
      invite.intendedEmail.toLowerCase() !== input.email.toLowerCase()
    ) {
      return res.status(400).json({ error: "INVITE_CODE_EMAIL_MISMATCH" });
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: input.email.toLowerCase() },
    });

    if (existingUser) {
      return res.status(400).json({ error: "EMAIL_ALREADY_EXISTS" });
    }

    const user = await prisma.user.create({
      data: {
        nome: input.nome,
        email: input.email.toLowerCase(),
        senhaHash: hashPassword(input.senha),
      },
    });

    await prisma.inviteCode.update({
      where: { id: invite.id },
      data: {
        usedAt: new Date(),
        usedByUserId: user.id,
      },
    });

    const token = crypto.randomBytes(32).toString("hex");
    await prisma.session.create({ data: { userId: user.id, token } });

    res.status(201).json({
      token,
      user: { id: user.id, nome: user.nome, email: user.email },
    });
  } catch (error) {
    console.error("REGISTER ERROR:", (error as Error).message);
    return res.status(500).json({
      error: "INTERNAL_SERVER_ERROR",
      detail: String(error),
    });
  }
});

apiRouter.get("/health/weights", requireAuth, async (req: AuthedRequest, res) => {
  const items = await prisma.healthWeight.findMany({
    where: { userId: req.userId },
    orderBy: { date: "desc" },
  });
  // Expose client_id (snake_case) so frontend r.client_id resolves correctly.
  // Prisma field is clientId (camelCase) due to @map, so res.json() would emit clientId.
  return res.json({ data: items.map(i => ({ ...i, client_id: i.clientId })) });
});

apiRouter.post("/health/weights", requireAuth, async (req: AuthedRequest, res) => {
  const schema = z.object({
    client_id: z.string().min(1),
    date: z.string().min(1),
    weight: z.number().nullable().optional(),
    height: z.number().nullable().optional(),
    fat: z.number().nullable().optional(),
    note: z.string().nullable().optional(),
    extraJson: z.any().optional(),
  });

  const input = schema.parse(req.body);
  const data = {
    date: new Date(input.date),
    weight: input.weight ?? null,
    height: input.height ?? null,
    fat: input.fat ?? null,
    note: input.note ?? null,
    extraJson: input.extraJson ?? null,
  };

  const item = await prisma.healthWeight.upsert({
    where: { userId_clientId: { userId: req.userId!, clientId: input.client_id } },
    update: data,
    create: { userId: req.userId!, clientId: input.client_id, ...data },
  });

  return res.status(201).json({ data: item });
});

apiRouter.delete("/health/weights/:id", requireAuth, async (req: AuthedRequest, res) => {
  const id = readRouteParam(req, "id");
  if (!id) return res.status(400).json({ error: "BAD_REQUEST" });
  await prisma.healthWeight.deleteMany({ where: { id, userId: req.userId! } });
  return res.status(204).send();
});

apiRouter.post("/auth/login", async (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    senha: z.string().min(1),
  });
  const input = schema.parse(req.body);

  const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
  if (!user || !verifyPassword(input.senha, user.senhaHash)) {
    return res.status(401).json({ error: "INVALID_CREDENTIALS" });
  }

  const token = crypto.randomBytes(32).toString("hex");
  await prisma.session.create({ data: { userId: user.id, token } });
  return res.json({ token, user: { id: user.id, nome: user.nome, email: user.email } });
});

apiRouter.get("/auth/me", requireAuth, async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) return res.status(401).json({ error: "UNAUTHORIZED" });
  return res.json({ user: { id: user.id, nome: user.nome, email: user.email } });
});

apiRouter.post("/auth/logout", requireAuth, async (req: AuthedRequest, res) => {
  await prisma.session.delete({ where: { token: req.sessionToken! } });
  sessionCache.del(req.sessionToken!);
  res.json({ ok: true });
});

apiRouter.put("/auth/profile", requireAuth, async (req: AuthedRequest, res) => {
  const schema = z.object({
    nome: z.string().min(1).optional(),
    email: z.string().email().optional(),
  });
  let input: z.infer<typeof schema>;
  try { input = schema.parse(req.body); } catch (e) { return res.status(400).json({ error: "INVALID_INPUT" }); }
  if (input.email) {
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing && existing.id !== req.userId) return res.status(400).json({ error: "EMAIL_ALREADY_EXISTS" });
  }
  const updated = await prisma.user.update({ where: { id: req.userId! }, data: { ...(input.nome ? { nome: input.nome } : {}), ...(input.email ? { email: input.email } : {}) } });
  return res.json({ user: { id: updated.id, nome: updated.nome, email: updated.email } });
});

apiRouter.post("/auth/change-password", requireAuth, async (req: AuthedRequest, res) => {
  const schema = z.object({
    senhaAtual: z.string().min(1),
    novaSenha: z.string().min(4),
  });
  let input: z.infer<typeof schema>;
  try { input = schema.parse(req.body); } catch (e) { return res.status(400).json({ error: "INVALID_INPUT" }); }
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user || !verifyPassword(input.senhaAtual, user.senhaHash)) return res.status(400).json({ error: "WRONG_PASSWORD" });
  await prisma.user.update({ where: { id: req.userId! }, data: { senhaHash: hashPassword(input.novaSenha) } });
  return res.json({ ok: true });
});

apiRouter.get("/categorias", requireAuth, async (req: AuthedRequest, res) => {
  assertUserMatchesQuery(req);
  const rows = await prisma.apiCategoria.findMany({ where: { userId: req.userId! }, orderBy: { nome: "asc" } });
  res.json(rows);
});

apiRouter.post("/categorias", requireAuth, async (req: AuthedRequest, res) => {
  const schema = z.object({
    usuario_id: z.string().min(1),
    client_id: z.string().min(1),
    nome: z.string().min(1),
    cor: z.string().optional(),
  });
  const input = schema.parse(req.body);
  if (input.usuario_id !== req.userId) return res.status(403).json({ error: "FORBIDDEN" });

  const row = await prisma.apiCategoria.upsert({
    where: { userId_client_id: { userId: req.userId!, client_id: input.client_id } },
    update: { nome: input.nome, cor: input.cor },
    create: { userId: req.userId!, client_id: input.client_id, nome: input.nome, cor: input.cor },
  });
  res.status(201).json(row);
});

apiRouter.delete("/categorias/:id", requireAuth, async (req: AuthedRequest, res) => {
  const id = readRouteParam(req, "id");
  if (!id) return res.status(400).json({ error: "BAD_REQUEST" });
  await prisma.apiCategoria.deleteMany({ where: { id, userId: req.userId! } });
  res.status(204).send();
});

apiRouter.get("/contas", requireAuth, async (req: AuthedRequest, res) => {
  assertUserMatchesQuery(req);
  const rows = await prisma.apiConta.findMany({ where: { userId: req.userId! }, orderBy: { createdAt: "desc" } });
  res.json(rows);
});

apiRouter.post("/contas", requireAuth, async (req: AuthedRequest, res) => {
  const schema = z.object({
    usuario_id: z.string().min(1),
    client_id: z.string().min(1),
    nome: z.string().min(1),
    banco: z.string().optional(),
    tipo: z.string().optional(),
    vencimento: z.coerce.number().optional(),
    limite_total: z.coerce.number().optional(),
    cor: z.string().optional(),
    ativo: z.boolean().optional(),
  });
  const input = schema.parse(req.body);
  if (input.usuario_id !== req.userId) return res.status(403).json({ error: "FORBIDDEN" });

  const row = await prisma.apiConta.upsert({
    where: { userId_client_id: { userId: req.userId!, client_id: input.client_id } },
    update: {
      nome: input.nome,
      banco: input.banco,
      tipo: input.tipo,
      vencimento: input.vencimento ?? null,
      limite_total: input.limite_total != null ? toDecimal(input.limite_total) : null,
      cor: input.cor,
      ativo: input.ativo ?? true,
    },
    create: {
      userId: req.userId!,
      client_id: input.client_id,
      nome: input.nome,
      banco: input.banco,
      tipo: input.tipo,
      vencimento: input.vencimento ?? null,
      limite_total: input.limite_total != null ? toDecimal(input.limite_total) : null,
      cor: input.cor,
      ativo: input.ativo ?? true,
    },
  });
  res.status(201).json(row);
});

apiRouter.delete("/contas/:id", requireAuth, async (req: AuthedRequest, res) => {
  const id = readRouteParam(req, "id");
  if (!id) return res.status(400).json({ error: "BAD_REQUEST" });
  await prisma.apiConta.deleteMany({ where: { id, userId: req.userId! } });
  res.status(204).send();
});

apiRouter.get("/transacoes", requireAuth, async (req: AuthedRequest, res) => {
  assertUserMatchesQuery(req);
  const rows = await prisma.apiTransacao.findMany({
    where: { userId: req.userId! },
    orderBy: { data_lancamento: "desc" },
  });
  res.json(rows);
});

apiRouter.post("/transacoes", requireAuth, async (req: AuthedRequest, res) => {
  const schema = z.object({
    usuario_id: z.string().min(1),
    client_id: z.string().min(1),
    tipo: z.string().min(1),
    descricao: z.string().min(1),
    valor: z.coerce.number(),
    data_lancamento: z.string().min(10),
    fatura: z.string().min(7),
    categoria_nome: z.string().min(1),
    conta_nome: z.string().min(1),
    observacao: z.string().nullable().optional(),
    grupo_parcela_id: z.string().nullable().optional(),
    n_parcelas: z.coerce.number().int().nullable().optional(),
    parcela_atual: z.coerce.number().int().nullable().optional(),
    valor_parcela: z.coerce.number().nullable().optional(),
    conta_fixa_id: z.string().nullable().optional(),
  });
  const input = schema.parse(req.body);
  if (input.usuario_id !== req.userId) return res.status(403).json({ error: "FORBIDDEN" });

  const row = await prisma.apiTransacao.upsert({
    where: { userId_client_id: { userId: req.userId!, client_id: input.client_id } },
    update: {
      tipo: input.tipo,
      descricao: input.descricao,
      valor: toDecimal(input.valor),
      data_lancamento: new Date(input.data_lancamento),
      fatura: input.fatura,
      categoria_nome: input.categoria_nome,
      conta_nome: input.conta_nome,
      observacao: input.observacao ?? null,
      grupo_parcela_id: input.grupo_parcela_id ?? null,
      n_parcelas: input.n_parcelas ?? null,
      parcela_atual: input.parcela_atual ?? null,
      valor_parcela: input.valor_parcela != null ? toDecimal(input.valor_parcela) : null,
      conta_fixa_id: input.conta_fixa_id ?? null,
    },
    create: {
      userId: req.userId!,
      client_id: input.client_id,
      tipo: input.tipo,
      descricao: input.descricao,
      valor: toDecimal(input.valor),
      data_lancamento: new Date(input.data_lancamento),
      fatura: input.fatura,
      categoria_nome: input.categoria_nome,
      conta_nome: input.conta_nome,
      observacao: input.observacao ?? null,
      grupo_parcela_id: input.grupo_parcela_id ?? null,
      n_parcelas: input.n_parcelas ?? null,
      parcela_atual: input.parcela_atual ?? null,
      valor_parcela: input.valor_parcela != null ? toDecimal(input.valor_parcela) : null,
      conta_fixa_id: input.conta_fixa_id ?? null,
    },
  });
  res.status(201).json(row);
});

apiRouter.delete("/transacoes/:id", requireAuth, async (req: AuthedRequest, res) => {
  const id = readRouteParam(req, "id");
  if (!id) return res.status(400).json({ error: "BAD_REQUEST" });
  await prisma.apiTransacao.deleteMany({ where: { id, userId: req.userId! } });
  res.status(204).send();
});

apiRouter.get("/contas-fixas", requireAuth, async (req: AuthedRequest, res) => {
  assertUserMatchesQuery(req);
  const rows = await prisma.apiContaFixa.findMany({ where: { userId: req.userId! }, orderBy: { createdAt: "desc" } });
  res.json(rows);
});

apiRouter.post("/contas-fixas", requireAuth, async (req: AuthedRequest, res) => {
  const schema = z.object({
    usuario_id: z.string().min(1),
    client_id: z.string().min(1),
    nome: z.string().min(1),
    valor_padrao: z.coerce.number(),
    dia_venc: z.coerce.number().int().nullable().optional(),
    categoria_nome: z.string().min(1),
    conta_nome: z.string().min(1),
    cor: z.string().optional(),
    encerrado_apos: z.string().nullable().optional(),
  });
  const input = schema.parse(req.body);
  if (input.usuario_id !== req.userId) return res.status(403).json({ error: "FORBIDDEN" });

  const row = await prisma.apiContaFixa.upsert({
    where: { userId_client_id: { userId: req.userId!, client_id: input.client_id } },
    update: {
      nome: input.nome,
      valor_padrao: toDecimal(input.valor_padrao),
      dia_venc: input.dia_venc ?? null,
      categoria_nome: input.categoria_nome,
      conta_nome: input.conta_nome,
      cor: input.cor,
      encerrado_apos: input.encerrado_apos ?? null,
    },
    create: {
      userId: req.userId!,
      client_id: input.client_id,
      nome: input.nome,
      valor_padrao: toDecimal(input.valor_padrao),
      dia_venc: input.dia_venc ?? null,
      categoria_nome: input.categoria_nome,
      conta_nome: input.conta_nome,
      cor: input.cor,
      encerrado_apos: input.encerrado_apos ?? null,
    },
  });
  res.status(201).json(row);
});

apiRouter.delete("/contas-fixas/:id", requireAuth, async (req: AuthedRequest, res) => {
  const id = readRouteParam(req, "id");
  if (!id) return res.status(400).json({ error: "BAD_REQUEST" });
  await prisma.apiContaFixa.deleteMany({ where: { id, userId: req.userId! } });
  res.status(204).send();
});

apiRouter.get("/contas-fixas-valores", requireAuth, async (req: AuthedRequest, res) => {
  assertUserMatchesQuery(req);
  const rows = await prisma.apiContaFixaValor.findMany({
    where: { userId: req.userId! },
    orderBy: [{ fatura: "desc" }],
  });
  res.json(rows);
});

apiRouter.post("/contas-fixas-valores", requireAuth, async (req: AuthedRequest, res) => {
  const schema = z.object({
    usuario_id: z.string().min(1),
    fixa_client_id: z.string().min(1),
    fatura: z.string().min(7),
    valor_fatura: z.coerce.number(),
  });
  const input = schema.parse(req.body);
  if (input.usuario_id !== req.userId) return res.status(403).json({ error: "FORBIDDEN" });

  const row = await prisma.apiContaFixaValor.upsert({
    where: {
      userId_fixa_client_id_fatura: { userId: req.userId!, fixa_client_id: input.fixa_client_id, fatura: input.fatura },
    },
    update: { valor_fatura: toDecimal(input.valor_fatura) },
    create: { userId: req.userId!, fixa_client_id: input.fixa_client_id, fatura: input.fatura, valor_fatura: toDecimal(input.valor_fatura) },
  });
  res.status(201).json(row);
});

apiRouter.delete("/contas-fixas-valores/:id", requireAuth, async (req: AuthedRequest, res) => {
  const id = readRouteParam(req, "id");
  if (!id) return res.status(400).json({ error: "BAD_REQUEST" });
  await prisma.apiContaFixaValor.deleteMany({ where: { id, userId: req.userId! } });
  res.status(204).send();
});

apiRouter.get("/orcamentos-config", requireAuth, async (req: AuthedRequest, res) => {
  assertUserMatchesQuery(req);
  const rows = await prisma.apiOrcamentoConfig.findMany({ where: { userId: req.userId! } });
  res.json(rows);
});

apiRouter.post("/orcamentos-config", requireAuth, async (req: AuthedRequest, res) => {
  const schema = z.object({
    usuario_id: z.string().min(1),
    categoria_nome: z.string().min(1),
    limite_valor: z.coerce.number(),
  });
  const input = schema.parse(req.body);
  if (input.usuario_id !== req.userId) return res.status(403).json({ error: "FORBIDDEN" });

  const row = await prisma.apiOrcamentoConfig.upsert({
    where: { userId_categoria_nome: { userId: req.userId!, categoria_nome: input.categoria_nome } },
    update: { limite_valor: toDecimal(input.limite_valor) },
    create: { userId: req.userId!, categoria_nome: input.categoria_nome, limite_valor: toDecimal(input.limite_valor) },
  });
  res.status(201).json(row);
});

apiRouter.delete("/orcamentos-config", requireAuth, async (req: AuthedRequest, res) => {
  assertUserMatchesQuery(req);
  const categoriaNome = readQueryParam(req, "categoria_nome") || "";
  if (!categoriaNome) return res.status(400).json({ error: "BAD_REQUEST" });
  await prisma.apiOrcamentoConfig.delete({
    where: { userId_categoria_nome: { userId: req.userId!, categoria_nome: categoriaNome } },
  });
  res.status(204).send();
});

apiRouter.get("/settings/saving-goal", requireAuth, async (req: AuthedRequest, res) => {
  assertUserMatchesQuery(req);
  const row = await prisma.apiSavingGoal.findUnique({ where: { userId: req.userId! } });
  res.json(row || { saving_goal: 0 });
});

apiRouter.post("/settings/saving-goal", requireAuth, async (req: AuthedRequest, res) => {
  const schema = z.object({
    usuario_id: z.string().min(1),
    saving_goal: z.coerce.number(),
  });
  const input = schema.parse(req.body);
  if (input.usuario_id !== req.userId) return res.status(403).json({ error: "FORBIDDEN" });

  const row = await prisma.apiSavingGoal.upsert({
    where: { userId: req.userId! },
    update: { saving_goal: toDecimal(input.saving_goal) },
    create: { userId: req.userId!, saving_goal: toDecimal(input.saving_goal) },
  });
  res.status(201).json(row);
});

apiRouter.get("/poupanca", requireAuth, async (req: AuthedRequest, res) => {
  assertUserMatchesQuery(req);
  const row = await prisma.apiPoupanca.findUnique({ where: { userId: req.userId! } });
  res.json(row || { meta: 0, previsto: {}, realizado: {} });
});

apiRouter.post("/poupanca", requireAuth, async (req: AuthedRequest, res) => {
  type MonthMap = Record<string, number>;
  const schema = z.object({
    usuario_id: z.string().min(1),
    meta: z.coerce.number(),
    previsto: z.record(z.string(), z.coerce.number()).optional().default({} as MonthMap),
    realizado: z.record(z.string(), z.coerce.number()).optional().default({} as MonthMap),
  });
  const input = schema.parse(req.body);
  if (input.usuario_id !== req.userId) return res.status(403).json({ error: "FORBIDDEN" });

  const row = await prisma.apiPoupanca.upsert({
    where: { userId: req.userId! },
    update: {
      meta: toDecimal(input.meta),
      previsto: input.previsto as Prisma.InputJsonObject,
      realizado: input.realizado as Prisma.InputJsonObject,
    },
    create: {
      userId: req.userId!,
      meta: toDecimal(input.meta),
      previsto: input.previsto as Prisma.InputJsonObject,
      realizado: input.realizado as Prisma.InputJsonObject,
    },
  });
  res.status(201).json(row);
});

apiRouter.get("/projecao-extras", requireAuth, async (req: AuthedRequest, res) => {
  assertUserMatchesQuery(req);
  const rows = await prisma.apiProjecaoExtra.findMany({ where: { userId: req.userId! }, orderBy: { nome: "asc" } });
  res.json(rows);
});

apiRouter.post("/projecao-extras", requireAuth, async (req: AuthedRequest, res) => {
  const schema = z.object({
    usuario_id: z.string().min(1),
    client_id: z.string().min(1),
    nome: z.string().min(1),
    valor: z.coerce.number(),
    ativo: z.boolean().optional(),
  });
  const input = schema.parse(req.body);
  if (input.usuario_id !== req.userId) return res.status(403).json({ error: "FORBIDDEN" });

  const row = await prisma.apiProjecaoExtra.upsert({
    where: { userId_client_id: { userId: req.userId!, client_id: input.client_id } },
    update: { nome: input.nome, valor: toDecimal(input.valor), ativo: input.ativo ?? true },
    create: { userId: req.userId!, client_id: input.client_id, nome: input.nome, valor: toDecimal(input.valor), ativo: input.ativo ?? true },
  });
  res.status(201).json(row);
});

apiRouter.delete("/projecao-extras/:id", requireAuth, async (req: AuthedRequest, res) => {
  const id = readRouteParam(req, "id");
  if (!id) return res.status(400).json({ error: "BAD_REQUEST" });
  await prisma.apiProjecaoExtra.deleteMany({ where: { id, userId: req.userId! } });
  res.status(204).send();
});

// ── SAÚDE: TREINOS ──────────────────────────────────────────────────────────

apiRouter.get("/treinos", requireAuth, async (req: AuthedRequest, res) => {
  assertUserMatchesQuery(req);
  const rows = await prisma.apiTreino.findMany({
    where: { userId: req.userId! },
    orderBy: [{ data: "desc" }, { hora_inicio: "desc" }],
  });
  res.json(rows);
});

apiRouter.post("/treinos", requireAuth, async (req: AuthedRequest, res) => {
  const schema = z.object({
    usuario_id: z.string().min(1),
    client_id:  z.string().min(1),
    titulo:     z.string().min(1),
    data:       z.string().min(10),
    hora_inicio: z.string().optional(),
    hora_fim:    z.string().optional(),
    duracao:     z.coerce.number().int().nullable().optional(),
    tipo_cat:    z.string().min(1),
    tipo_ex:     z.string().nullable().optional(),
    calorias:    z.coerce.number().int().nullable().optional(),
    km:          z.coerce.number().nullable().optional(),
    local_nome:  z.string().nullable().optional(),
    descricao:   z.string().nullable().optional(),
    obs:         z.string().nullable().optional(),
  });
  const input = schema.parse(req.body);
  if (input.usuario_id !== req.userId) return res.status(403).json({ error: "FORBIDDEN" });

  const row = await prisma.apiTreino.upsert({
    where: { userId_client_id: { userId: req.userId!, client_id: input.client_id } },
    update: {
      titulo: input.titulo, data: input.data, hora_inicio: input.hora_inicio ?? null,
      hora_fim: input.hora_fim ?? null, duracao: input.duracao ?? null,
      tipo_cat: input.tipo_cat, tipo_ex: input.tipo_ex ?? null,
      calorias: input.calorias ?? null,
      km: input.km != null ? toDecimal(input.km) : null,
      local_nome: input.local_nome ?? null, descricao: input.descricao ?? null, obs: input.obs ?? null,
    },
    create: {
      userId: req.userId!, client_id: input.client_id,
      titulo: input.titulo, data: input.data, hora_inicio: input.hora_inicio ?? null,
      hora_fim: input.hora_fim ?? null, duracao: input.duracao ?? null,
      tipo_cat: input.tipo_cat, tipo_ex: input.tipo_ex ?? null,
      calorias: input.calorias ?? null,
      km: input.km != null ? toDecimal(input.km) : null,
      local_nome: input.local_nome ?? null, descricao: input.descricao ?? null, obs: input.obs ?? null,
    },
  });
  res.status(201).json(row);
});

apiRouter.delete("/treinos/:id", requireAuth, async (req: AuthedRequest, res) => {
  const id = readRouteParam(req, "id");
  if (!id) return res.status(400).json({ error: "BAD_REQUEST" });
  // If it's a Strava-imported activity, record exclusion so re-sync won't bring it back
  const treino = await prisma.apiTreino.findFirst({ where: { id, userId: req.userId! } });
  if (treino?.client_id?.startsWith("strava_")) {
    await prisma.stravaExcluded.upsert({
      where: { userId_clientId: { userId: req.userId!, clientId: treino.client_id } },
      update: {},
      create: { userId: req.userId!, clientId: treino.client_id },
    });
  }
  await prisma.apiTreino.deleteMany({ where: { id, userId: req.userId! } });
  res.status(204).send();
});

// ── SAÚDE: LOCAIS ───────────────────────────────────────────────────────────

apiRouter.get("/locais-treino", requireAuth, async (req: AuthedRequest, res) => {
  assertUserMatchesQuery(req);
  const rows = await prisma.apiLocalTreino.findMany({ where: { userId: req.userId! }, orderBy: { nome: "asc" } });
  res.json(rows);
});

apiRouter.post("/locais-treino", requireAuth, async (req: AuthedRequest, res) => {
  const schema = z.object({ usuario_id: z.string().min(1), client_id: z.string().min(1), nome: z.string().min(1) });
  const input = schema.parse(req.body);
  if (input.usuario_id !== req.userId) return res.status(403).json({ error: "FORBIDDEN" });
  const row = await prisma.apiLocalTreino.upsert({
    where: { userId_client_id: { userId: req.userId!, client_id: input.client_id } },
    update: { nome: input.nome },
    create: { userId: req.userId!, client_id: input.client_id, nome: input.nome },
  });
  res.status(201).json(row);
});

apiRouter.delete("/locais-treino/:id", requireAuth, async (req: AuthedRequest, res) => {
  const id = readRouteParam(req, "id");
  if (!id) return res.status(400).json({ error: "BAD_REQUEST" });
  await prisma.apiLocalTreino.deleteMany({ where: { id, userId: req.userId! } });
  res.status(204).send();
});

// ── SAÚDE: TIPOS DE EXERCÍCIO ────────────────────────────────────────────────

apiRouter.get("/tipos-exercicio", requireAuth, async (req: AuthedRequest, res) => {
  assertUserMatchesQuery(req);
  const rows = await prisma.apiTipoExercicio.findMany({ where: { userId: req.userId! }, orderBy: { nome: "asc" } });
  res.json(rows);
});

apiRouter.post("/tipos-exercicio", requireAuth, async (req: AuthedRequest, res) => {
  const schema = z.object({
    usuario_id: z.string().min(1), client_id: z.string().min(1),
    nome: z.string().min(1), cat: z.string().min(1),
  });
  const input = schema.parse(req.body);
  if (input.usuario_id !== req.userId) return res.status(403).json({ error: "FORBIDDEN" });
  const row = await prisma.apiTipoExercicio.upsert({
    where: { userId_client_id: { userId: req.userId!, client_id: input.client_id } },
    update: { nome: input.nome, cat: input.cat },
    create: { userId: req.userId!, client_id: input.client_id, nome: input.nome, cat: input.cat },
  });
  res.status(201).json(row);
});

apiRouter.delete("/tipos-exercicio/:id", requireAuth, async (req: AuthedRequest, res) => {
  const id = readRouteParam(req, "id");
  if (!id) return res.status(400).json({ error: "BAD_REQUEST" });
  await prisma.apiTipoExercicio.deleteMany({ where: { id, userId: req.userId! } });
  res.status(204).send();
});

// ── CASINHA: AMBIENTES ───────────────────────────────────────────────────────
apiRouter.get("/casinha/ambientes", requireAuth, async (req: AuthedRequest, res) => {
  assertUserMatchesQuery(req);
  const rows = await prisma.casinhaAmbiente.findMany({
    where: { userId: req.userId! },
    orderBy: { nome: "asc" },
  });
  res.json(rows);
});

apiRouter.post("/casinha/ambientes", requireAuth, async (req: AuthedRequest, res) => {
  const schema = z.object({
    usuario_id: z.string().min(1),
    client_id:  z.string().min(1),
    nome:       z.string().min(1),
    cor:        z.string().optional().default("#7b9cff"),
    icone:      z.string().optional().default("🏠"),
  });
  const input = schema.parse(req.body);
  if (input.usuario_id !== req.userId) return res.status(403).json({ error: "FORBIDDEN" });
  const row = await prisma.casinhaAmbiente.upsert({
    where: { userId_client_id: { userId: req.userId!, client_id: input.client_id } },
    update: { nome: input.nome, cor: input.cor, icone: input.icone },
    create: { userId: req.userId!, client_id: input.client_id, nome: input.nome, cor: input.cor, icone: input.icone },
  });
  res.status(201).json(row);
});

apiRouter.delete("/casinha/ambientes/:id", requireAuth, async (req: AuthedRequest, res) => {
  const id = readRouteParam(req, "id");
  if (!id) return res.status(400).json({ error: "BAD_REQUEST" });
  await prisma.casinhaAmbiente.deleteMany({ where: { id, userId: req.userId! } });
  res.status(204).send();
});

// ── CASINHA: PESSOAS ─────────────────────────────────────────────────────────
apiRouter.get("/casinha/pessoas", requireAuth, async (req: AuthedRequest, res) => {
  assertUserMatchesQuery(req);
  const rows = await prisma.casinhaPessoa.findMany({
    where: { userId: req.userId! },
    orderBy: { nome: "asc" },
  });
  res.json(rows);
});

apiRouter.post("/casinha/pessoas", requireAuth, async (req: AuthedRequest, res) => {
  const schema = z.object({
    usuario_id: z.string().min(1),
    client_id:  z.string().min(1),
    nome:       z.string().min(1),
    cor:        z.string().optional().default("#7b9cff"),
  });
  const input = schema.parse(req.body);
  if (input.usuario_id !== req.userId) return res.status(403).json({ error: "FORBIDDEN" });
  const row = await prisma.casinhaPessoa.upsert({
    where: { userId_client_id: { userId: req.userId!, client_id: input.client_id } },
    update: { nome: input.nome, cor: input.cor },
    create: { userId: req.userId!, client_id: input.client_id, nome: input.nome, cor: input.cor },
  });
  res.status(201).json(row);
});

apiRouter.delete("/casinha/pessoas/:id", requireAuth, async (req: AuthedRequest, res) => {
  const id = readRouteParam(req, "id");
  if (!id) return res.status(400).json({ error: "BAD_REQUEST" });
  await prisma.casinhaPessoa.deleteMany({ where: { id, userId: req.userId! } });
  res.status(204).send();
});

// ── CASINHA: TAREFAS ─────────────────────────────────────────────────────────
apiRouter.get("/casinha/tarefas", requireAuth, async (req: AuthedRequest, res) => {
  assertUserMatchesQuery(req);
  const rows = await prisma.casinhaTarefa.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: "desc" },
  });
  res.json(rows);
});

apiRouter.post("/casinha/tarefas", requireAuth, async (req: AuthedRequest, res) => {
  const schema = z.object({
    usuario_id:     z.string().min(1),
    client_id:      z.string().min(1),
    titulo:         z.string().min(1),
    descricao:      z.string().nullable().optional(),
    tipo:           z.string().nullable().optional(),
    ambiente:       z.string().nullable().optional(),
    responsavel:    z.string().nullable().optional(),
    prioridade:     z.string().optional().default("media"),
    status:         z.string().optional().default("planejada"),
    dataVenc:       z.string().nullable().optional(),
    horario:        z.string().nullable().optional(),
    tempoEst:       z.coerce.number().int().nullable().optional(),
    tempoReal:      z.coerce.number().int().nullable().optional(),
    recorrencia:    z.any().optional(),
    obs:            z.string().nullable().optional(),
    dataConclusao:  z.string().nullable().optional(),
    rotinaId:       z.string().nullable().optional(),
  });
  const input = schema.parse(req.body);
  if (input.usuario_id !== req.userId) return res.status(403).json({ error: "FORBIDDEN" });
  const data = {
    titulo: input.titulo, descricao: input.descricao ?? null,
    tipo: input.tipo ?? null, ambiente: input.ambiente ?? null,
    responsavel: input.responsavel ?? null, prioridade: input.prioridade,
    status: input.status, dataVenc: input.dataVenc ?? null,
    horario: input.horario ?? null, tempoEst: input.tempoEst ?? null,
    tempoReal: input.tempoReal ?? null, recorrencia: input.recorrencia ?? null,
    obs: input.obs ?? null, dataConclusao: input.dataConclusao ?? null,
    rotinaId: input.rotinaId ?? null,
  };
  const row = await prisma.casinhaTarefa.upsert({
    where: { userId_client_id: { userId: req.userId!, client_id: input.client_id } },
    update: data,
    create: { userId: req.userId!, client_id: input.client_id, ...data },
  });
  res.status(201).json(row);
});

apiRouter.delete("/casinha/tarefas/:id", requireAuth, async (req: AuthedRequest, res) => {
  const id = readRouteParam(req, "id");
  if (!id) return res.status(400).json({ error: "BAD_REQUEST" });
  await prisma.casinhaTarefa.deleteMany({ where: { id, userId: req.userId! } });
  res.status(204).send();
});

// ── CASINHA: ROTINAS ─────────────────────────────────────────────────────────
apiRouter.get("/casinha/rotinas", requireAuth, async (req: AuthedRequest, res) => {
  assertUserMatchesQuery(req);
  const rows = await prisma.casinhaRotina.findMany({
    where: { userId: req.userId! },
    orderBy: { nome: "asc" },
  });
  res.json(rows);
});

apiRouter.post("/casinha/rotinas", requireAuth, async (req: AuthedRequest, res) => {
  const schema = z.object({
    usuario_id:   z.string().min(1),
    client_id:    z.string().min(1),
    nome:         z.string().min(1),
    icone:        z.string().nullable().optional(),
    tipo:         z.string().nullable().optional(),
    ambiente:     z.string().nullable().optional(),
    responsavel:  z.string().nullable().optional(),
    prioridade:   z.string().nullable().optional(),
    recorrencia:  z.any().default({}),
    horario:      z.string().nullable().optional(),
    tempoEst:     z.coerce.number().int().nullable().optional(),
    proximaData:  z.string().nullable().optional(),
    ativo:        z.boolean().optional().default(true),
  });
  const input = schema.parse(req.body);
  if (input.usuario_id !== req.userId) return res.status(403).json({ error: "FORBIDDEN" });
  const data = {
    nome: input.nome, icone: input.icone ?? null,
    tipo: input.tipo ?? null, ambiente: input.ambiente ?? null,
    responsavel: input.responsavel ?? null, prioridade: input.prioridade ?? null,
    recorrencia: input.recorrencia, horario: input.horario ?? null,
    tempoEst: input.tempoEst ?? null, proximaData: input.proximaData ?? null,
    ativo: input.ativo,
  };
  const row = await prisma.casinhaRotina.upsert({
    where: { userId_client_id: { userId: req.userId!, client_id: input.client_id } },
    update: data,
    create: { userId: req.userId!, client_id: input.client_id, ...data },
  });
  res.status(201).json(row);
});

apiRouter.delete("/casinha/rotinas/:id", requireAuth, async (req: AuthedRequest, res) => {
  const id = readRouteParam(req, "id");
  if (!id) return res.status(400).json({ error: "BAD_REQUEST" });
  await prisma.casinhaRotina.deleteMany({ where: { id, userId: req.userId! } });
  res.status(204).send();
});

// ── SAÚDE: MÉDICOS ───────────────────────────────────────────────────────────
apiRouter.get("/saude/medicos", requireAuth, async (req: AuthedRequest, res) => {
  assertUserMatchesQuery(req);
  const rows = await prisma.saudeMedico.findMany({ where: { userId: req.userId! }, orderBy: { nome: "asc" } });
  res.json(rows);
});
apiRouter.post("/saude/medicos", requireAuth, async (req: AuthedRequest, res) => {
  const schema = z.object({
    usuario_id: z.string().min(1), client_id: z.string().min(1), nome: z.string().min(1),
    especialidade: z.string().nullable().optional(), frequencyDays: z.coerce.number().int().nullable().optional(),
    phone: z.string().nullable().optional(), whats: z.string().nullable().optional(),
    email: z.string().nullable().optional(), clinica: z.string().nullable().optional(),
    endereco: z.string().nullable().optional(), obs: z.string().nullable().optional(),
  });
  const input = schema.parse(req.body);
  if (input.usuario_id !== req.userId) return res.status(403).json({ error: "FORBIDDEN" });
  const data = { nome: input.nome, especialidade: input.especialidade ?? null, frequencyDays: input.frequencyDays ?? null, phone: input.phone ?? null, whats: input.whats ?? null, email: input.email ?? null, clinica: input.clinica ?? null, endereco: input.endereco ?? null, obs: input.obs ?? null };
  const row = await prisma.saudeMedico.upsert({ where: { userId_client_id: { userId: req.userId!, client_id: input.client_id } }, update: data, create: { userId: req.userId!, client_id: input.client_id, ...data } });
  res.status(201).json(row);
});
apiRouter.delete("/saude/medicos/:id", requireAuth, async (req: AuthedRequest, res) => {
  const id = readRouteParam(req, "id"); if (!id) return res.status(400).json({ error: "BAD_REQUEST" });
  await prisma.saudeMedico.deleteMany({ where: { id, userId: req.userId! } }); res.status(204).send();
});

// ── SAÚDE: EXAMES ────────────────────────────────────────────────────────────
apiRouter.get("/saude/exames", requireAuth, async (req: AuthedRequest, res) => {
  assertUserMatchesQuery(req);
  const rows = await prisma.saudeExame.findMany({ where: { userId: req.userId! }, orderBy: { date: "desc" } });
  res.json(rows);
});
apiRouter.post("/saude/exames", requireAuth, async (req: AuthedRequest, res) => {
  const schema = z.object({
    usuario_id: z.string().min(1), client_id: z.string().min(1), nome: z.string().min(1),
    categoria: z.string().nullable().optional(), status: z.string().nullable().optional(),
    resultado: z.string().nullable().optional(),
    laboratorio: z.string().nullable().optional(), medicoId: z.string().nullable().optional(),
    date: z.string().min(1), nextDate: z.string().nullable().optional(),
    obs: z.string().nullable().optional(), fileName: z.string().nullable().optional(),
    fileData: z.string().nullable().optional(),
  });
  const input = schema.parse(req.body);
  if (input.usuario_id !== req.userId) return res.status(403).json({ error: "FORBIDDEN" });
  const data = { nome: input.nome, categoria: input.categoria ?? null, status: input.status ?? null, resultado: input.resultado ?? null, laboratorio: input.laboratorio ?? null, medicoId: input.medicoId ?? null, date: input.date, nextDate: input.nextDate ?? null, obs: input.obs ?? null, fileName: input.fileName ?? null, fileData: input.fileData ?? null };
  const row = await prisma.saudeExame.upsert({ where: { userId_client_id: { userId: req.userId!, client_id: input.client_id } }, update: data, create: { userId: req.userId!, client_id: input.client_id, ...data } });
  res.status(201).json(row);
});
apiRouter.delete("/saude/exames/:id", requireAuth, async (req: AuthedRequest, res) => {
  const id = readRouteParam(req, "id"); if (!id) return res.status(400).json({ error: "BAD_REQUEST" });
  await prisma.saudeExame.deleteMany({ where: { id, userId: req.userId! } }); res.status(204).send();
});

// ── SAÚDE: CONSULTAS ─────────────────────────────────────────────────────────
apiRouter.get("/saude/consultas", requireAuth, async (req: AuthedRequest, res) => {
  assertUserMatchesQuery(req);
  const rows = await prisma.saudeConsulta.findMany({ where: { userId: req.userId! }, orderBy: { date: "desc" } });
  res.json(rows);
});
apiRouter.post("/saude/consultas", requireAuth, async (req: AuthedRequest, res) => {
  const schema = z.object({
    usuario_id: z.string().min(1), client_id: z.string().min(1), date: z.string().min(1),
    time: z.string().nullable().optional(), medicoId: z.string().nullable().optional(),
    especialidade: z.string().nullable().optional(), motivo: z.string().nullable().optional(),
    status: z.string().nullable().optional(), returnDays: z.coerce.number().int().nullable().optional(),
    nextDate: z.string().nullable().optional(), resumo: z.string().nullable().optional(),
  });
  const input = schema.parse(req.body);
  if (input.usuario_id !== req.userId) return res.status(403).json({ error: "FORBIDDEN" });
  const data = { date: input.date, time: input.time ?? null, medicoId: input.medicoId ?? null, especialidade: input.especialidade ?? null, motivo: input.motivo ?? null, status: input.status ?? null, returnDays: input.returnDays ?? null, nextDate: input.nextDate ?? null, resumo: input.resumo ?? null };
  const row = await prisma.saudeConsulta.upsert({ where: { userId_client_id: { userId: req.userId!, client_id: input.client_id } }, update: data, create: { userId: req.userId!, client_id: input.client_id, ...data } });
  res.status(201).json(row);
});
apiRouter.delete("/saude/consultas/:id", requireAuth, async (req: AuthedRequest, res) => {
  const id = readRouteParam(req, "id"); if (!id) return res.status(400).json({ error: "BAD_REQUEST" });
  await prisma.saudeConsulta.deleteMany({ where: { id, userId: req.userId! } }); res.status(204).send();
});

// ── HÁBITOS ──────────────────────────────────────────────────────────────────
apiRouter.get("/habitos", requireAuth, async (req: AuthedRequest, res) => {
  assertUserMatchesQuery(req);
  const rows = await prisma.habito.findMany({ where: { userId: req.userId! }, orderBy: { createdAt: "asc" } });
  res.json(rows);
});
apiRouter.post("/habitos", requireAuth, async (req: AuthedRequest, res) => {
  const schema = z.object({
    usuario_id: z.string().min(1), client_id: z.string().min(1), nome: z.string().min(1),
    icone: z.string().nullable().optional(), categoria: z.string().nullable().optional(),
    frequencia: z.string().nullable().optional(), weekdays: z.any().optional(),
    monthDay: z.coerce.number().int().min(1).max(31).nullable().optional(),
    obs: z.string().nullable().optional(), autoType: z.string().nullable().optional(),
    autoKeyword: z.string().nullable().optional(),
    tipo: z.string().nullable().optional(),
    unit: z.string().nullable().optional(),
    startDate: z.string().nullable().optional(),
    logs: z.any().optional(),
  });
  const input = schema.parse(req.body);
  if (input.usuario_id !== req.userId) return res.status(403).json({ error: "FORBIDDEN" });
  const base = { nome: input.nome, icone: input.icone ?? null, categoria: input.categoria ?? null, frequencia: input.frequencia ?? null, weekdays: input.weekdays ?? null, obs: input.obs ?? null, autoType: input.autoType ?? null, autoKeyword: input.autoKeyword ?? null, tipo: input.tipo ?? null, unit: input.unit ?? null, startDate: input.startDate ?? null, logs: input.logs ?? null };
  const monthPatch = input.monthDay !== undefined ? { monthDay: input.monthDay } : {};
  const row = await prisma.habito.upsert({
    where: { userId_client_id: { userId: req.userId!, client_id: input.client_id } },
    update: { ...base, ...monthPatch },
    create: { userId: req.userId!, client_id: input.client_id, ...base, monthDay: input.monthDay ?? null },
  });
  res.status(201).json(row);
});
apiRouter.delete("/habitos/:id", requireAuth, async (req: AuthedRequest, res) => {
  const id = readRouteParam(req, "id"); if (!id) return res.status(400).json({ error: "BAD_REQUEST" });
  await prisma.habito.deleteMany({ where: { id, userId: req.userId! } }); res.status(204).send();
});

// ── ALIMENTAÇÃO ──────────────────────────────────────────────────────────────
apiRouter.get("/alimentacao/refeicoes", requireAuth, async (req: AuthedRequest, res) => {
  assertUserMatchesQuery(req);
  const rows = await prisma.alimentacaoRefeicao.findMany({ where: { userId: req.userId! }, orderBy: [{ date: "desc" }, { time: "desc" }] });
  res.json(rows);
});
apiRouter.post("/alimentacao/refeicoes", requireAuth, async (req: AuthedRequest, res) => {
  const schema = z.object({
    usuario_id: z.string().min(1), client_id: z.string().min(1), nome: z.string().min(1),
    tipo: z.string().nullable().optional(), date: z.string().min(1),
    time: z.string().nullable().optional(), calories: z.coerce.number().int().nullable().optional(),
    obs: z.string().nullable().optional(),
  });
  const input = schema.parse(req.body);
  if (input.usuario_id !== req.userId) return res.status(403).json({ error: "FORBIDDEN" });
  const data = { nome: input.nome, tipo: input.tipo ?? null, date: input.date, time: input.time ?? null, calories: input.calories ?? null, obs: input.obs ?? null };
  const row = await prisma.alimentacaoRefeicao.upsert({ where: { userId_client_id: { userId: req.userId!, client_id: input.client_id } }, update: data, create: { userId: req.userId!, client_id: input.client_id, ...data } });
  res.status(201).json(row);
});
apiRouter.delete("/alimentacao/refeicoes/:id", requireAuth, async (req: AuthedRequest, res) => {
  const id = readRouteParam(req, "id"); if (!id) return res.status(400).json({ error: "BAD_REQUEST" });
  await prisma.alimentacaoRefeicao.deleteMany({ where: { id, userId: req.userId! } }); res.status(204).send();
});
apiRouter.get("/alimentacao/config", requireAuth, async (req: AuthedRequest, res) => {
  assertUserMatchesQuery(req);
  const row = await prisma.alimentacaoConfig.findUnique({ where: { userId: req.userId! } });
  res.json(row || { goals: null, plan: null });
});
apiRouter.post("/alimentacao/config", requireAuth, async (req: AuthedRequest, res) => {
  const schema = z.object({ usuario_id: z.string().min(1), goals: z.any().optional(), plan: z.any().optional() });
  const input = schema.parse(req.body);
  if (input.usuario_id !== req.userId) return res.status(403).json({ error: "FORBIDDEN" });
  const row = await prisma.alimentacaoConfig.upsert({ where: { userId: req.userId! }, update: { goals: input.goals ?? null, plan: input.plan ?? null }, create: { userId: req.userId!, goals: input.goals ?? null, plan: input.plan ?? null } });
  res.status(201).json(row);
});

// ── ÁGUA ─────────────────────────────────────────────────────────────────────
apiRouter.get("/alimentacao/water", requireAuth, async (req: AuthedRequest, res) => {
  const date = req.query.date as string | undefined;
  const where: any = { userId: req.userId! };
  if (date) where.date = date;
  const rows = await prisma.alimentacaoWater.findMany({ where, orderBy: { createdAt: "asc" } });
  res.json(rows);
});
apiRouter.post("/alimentacao/water", requireAuth, async (req: AuthedRequest, res) => {
  const schema = z.object({ usuario_id: z.string().min(1), date: z.string().min(10), ml: z.coerce.number().int().positive(), client_id: z.string().optional() });
  const input = schema.parse(req.body);
  if (input.usuario_id !== req.userId) return res.status(403).json({ error: "FORBIDDEN" });
  let row;
  if (input.client_id) {
    const existing = await prisma.alimentacaoWater.findFirst({ where: { userId: req.userId!, clientId: input.client_id } });
    if (existing) {
      row = await prisma.alimentacaoWater.update({ where: { id: existing.id }, data: { date: input.date, ml: input.ml } });
    } else {
      row = await prisma.alimentacaoWater.create({ data: { userId: req.userId!, clientId: input.client_id, date: input.date, ml: input.ml } });
    }
  } else {
    row = await prisma.alimentacaoWater.create({ data: { userId: req.userId!, date: input.date, ml: input.ml } });
  }
  res.status(201).json(row);
});
apiRouter.delete("/alimentacao/water/date/:date", requireAuth, async (req: AuthedRequest, res) => {
  const date = readRouteParam(req, "date");
  if (!date) return res.status(400).end();
  await prisma.alimentacaoWater.deleteMany({ where: { date, userId: req.userId! } });
  res.status(204).end();
});
apiRouter.delete("/alimentacao/water/:id", requireAuth, async (req: AuthedRequest, res) => {
  const id = readRouteParam(req, "id");
  if (!id) return res.status(400).end();
  await prisma.alimentacaoWater.deleteMany({ where: { userId: req.userId!, OR: [{ id }, { clientId: id }] } });
  res.status(204).end();
});

// ── REMÉDIOS ─────────────────────────────────────────────────────────────────
apiRouter.get("/saude/remedios", requireAuth, async (req: AuthedRequest, res) => {
  assertUserMatchesQuery(req);
  const rows = await prisma.saudeRemedio.findMany({ where: { userId: req.userId! }, orderBy: { name: "asc" } });
  res.json(rows);
});
apiRouter.post("/saude/remedios", requireAuth, async (req: AuthedRequest, res) => {
  const schema = z.object({
    usuario_id: z.string().optional(),
    client_id: z.string().min(1),
    name: z.string().min(1),
    cat: z.string().nullable().optional(),
    dose: z.string().nullable().optional(),
    stock: z.coerce.number().nullable().optional(),
    qty: z.coerce.number().nullable().optional(),
    days: z.coerce.number().int().nullable().optional(),
    lastBuy: z.string().nullable().optional(),
    note: z.string().nullable().optional(),
    habitId: z.string().nullable().optional(),
    intake_recurrence: z.enum(["diario", "semanal", "mensal"]).nullable().optional(),
    intake_weekdays: z.any().optional(),
    intake_month_day: z.coerce.number().int().min(1).max(31).nullable().optional(),
  });
  const input = schema.parse(req.body);
  const baseRem = { name: input.name, cat: input.cat ?? null, dose: input.dose ?? null, stock: input.stock ?? null, qty: input.qty ?? null, days: input.days ?? null, lastBuy: input.lastBuy ?? null, note: input.note ?? null, habitId: input.habitId ?? null };
  const intakePatch = {
    ...(input.intake_recurrence !== undefined ? { intakeRecurrence: input.intake_recurrence } : {}),
    ...(input.intake_weekdays !== undefined ? { intakeWeekdays: input.intake_weekdays } : {}),
    ...(input.intake_month_day !== undefined ? { intakeMonthDay: input.intake_month_day } : {}),
  };
  const row = await prisma.saudeRemedio.upsert({
    where: { userId_clientId: { userId: req.userId!, clientId: input.client_id } },
    update: { ...baseRem, ...intakePatch },
    create: {
      userId: req.userId!, clientId: input.client_id, ...baseRem,
      intakeRecurrence: input.intake_recurrence ?? null,
      intakeWeekdays: input.intake_weekdays ?? null,
      intakeMonthDay: input.intake_month_day ?? null,
    },
  });
  res.status(201).json(row);
});
apiRouter.delete("/saude/remedios/:id", requireAuth, async (req: AuthedRequest, res) => {
  const id = readRouteParam(req, "id");
  if (!id) return res.status(400).end();
  await prisma.saudeRemedio.deleteMany({ where: { clientId: id, userId: req.userId! } });
  res.status(204).end();
});

// ── CONSUMOS ──────────────────────────────────────────────────────────────────
apiRouter.get("/saude/consumos", requireAuth, async (req: AuthedRequest, res) => {
  assertUserMatchesQuery(req);
  const rows = await prisma.saudeConsumo.findMany({ where: { userId: req.userId! }, orderBy: [{ date: "desc" }, { time: "desc" }] });
  res.json(rows);
});
apiRouter.post("/saude/consumos", requireAuth, async (req: AuthedRequest, res) => {
  const schema = z.object({
    usuario_id: z.string().optional(),
    client_id: z.string().min(1),
    date: z.string().min(10),
    time: z.string().nullable().optional(),
    name: z.string().min(1),
    dose: z.string().nullable().optional(),
    reason: z.string().nullable().optional(),
  });
  const input = schema.parse(req.body);
  const row = await prisma.saudeConsumo.upsert({
    where: { userId_clientId: { userId: req.userId!, clientId: input.client_id } },
    update: { date: input.date, time: input.time ?? null, name: input.name, dose: input.dose ?? null, reason: input.reason ?? null },
    create: { userId: req.userId!, clientId: input.client_id, date: input.date, time: input.time ?? null, name: input.name, dose: input.dose ?? null, reason: input.reason ?? null },
  });
  res.status(201).json(row);
});
apiRouter.delete("/saude/consumos/:id", requireAuth, async (req: AuthedRequest, res) => {
  const id = readRouteParam(req, "id");
  if (!id) return res.status(400).end();
  await prisma.saudeConsumo.deleteMany({ where: { clientId: id, userId: req.userId! } });
  res.status(204).end();
});

// ── GOOGLE CALENDAR ──────────────────────────────────────────────────────────

const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID     || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const GOOGLE_REDIRECT_URI  = process.env.GOOGLE_REDIRECT_URI  || "https://orbi-two-xi.vercel.app/index.html";

async function googleRefreshIfNeeded(userId: string) {
  let token = await prisma.googleToken.findUnique({ where: { userId } });
  if (!token) throw Object.assign(new Error("NOT_CONNECTED"), { status: 400 });
  const now = new Date();
  if (token.expiresAt <= new Date(now.getTime() + 60_000)) {
    if (!token.refreshToken) throw Object.assign(new Error("NO_REFRESH_TOKEN"), { status: 400 });
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: token.refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    });
    if (!r.ok) throw Object.assign(new Error("GOOGLE_REFRESH_ERROR"), { status: 400 });
    const d = await r.json() as { access_token: string; expires_in: number; refresh_token?: string };
    const expiresAt = new Date(Date.now() + d.expires_in * 1000);
    token = await prisma.googleToken.update({
      where: { userId },
      data: {
        accessToken: d.access_token,
        expiresAt,
        ...(d.refresh_token ? { refreshToken: d.refresh_token } : {}),
      },
    });
  }
  return token;
}

apiRouter.post("/google/exchange-token", requireAuth, async (req: AuthedRequest, res) => {
  const { code } = req.body as { code?: string };
  if (!code) return res.status(400).json({ error: "BAD_REQUEST" });
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: "authorization_code",
    }).toString(),
  });
  if (!r.ok) return res.status(400).json({ error: "GOOGLE_ERROR", detail: await r.text() });
  const d = await r.json() as { access_token: string; refresh_token?: string; expires_in: number; token_type: string };
  const expiresAt = new Date(Date.now() + d.expires_in * 1000);
  await prisma.googleToken.upsert({
    where: { userId: req.userId! },
    update: { accessToken: d.access_token, refreshToken: d.refresh_token ?? null, expiresAt },
    create: { userId: req.userId!, accessToken: d.access_token, refreshToken: d.refresh_token ?? null, expiresAt },
  });
  return res.json({ ok: true });
});

apiRouter.get("/google/status", requireAuth, async (req: AuthedRequest, res) => {
  const token = await prisma.googleToken.findUnique({ where: { userId: req.userId! } });
  return res.json({ connected: !!token });
});

apiRouter.delete("/google/disconnect", requireAuth, async (req: AuthedRequest, res) => {
  const token = await prisma.googleToken.findUnique({ where: { userId: req.userId! } });
  if (token) {
    // Revoke token (best-effort)
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token.accessToken)}`, { method: "POST" }).catch(() => null);
    await prisma.googleToken.deleteMany({ where: { userId: req.userId! } });
  }
  return res.status(204).send();
});

apiRouter.get("/google/calendars", requireAuth, async (req: AuthedRequest, res) => {
  const token = await googleRefreshIfNeeded(req.userId!).catch(e => { throw e; });
  const gr = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=50", {
    headers: { Authorization: `Bearer ${token.accessToken}` },
  });
  if (!gr.ok) return res.status(400).json({ error: "GOOGLE_FETCH_ERROR", detail: await gr.text() });
  const data = await gr.json() as { items?: Array<{ id: string; summary?: string; primary?: boolean; selected?: boolean; backgroundColor?: string }> };
  const calendars = (data.items || []).map(c => ({ id: c.id, name: c.summary || c.id, primary: !!c.primary, color: c.backgroundColor || null }));
  return res.json(calendars);
});

apiRouter.get("/google/events", requireAuth, async (req: AuthedRequest, res) => {
  const token = await googleRefreshIfNeeded(req.userId!).catch(e => { throw e; });
  const timeMin = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const timeMax = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();

  type GCalEvent = { id: string; summary?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; hangoutLink?: string; htmlLink?: string; status?: string };

  // Fetch calendar list first, then events from all selected calendars
  const calListRes = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=50", {
    headers: { Authorization: `Bearer ${token.accessToken}` },
  });
  let calendarIds = ["primary"];
  if (calListRes.ok) {
    const calList = await calListRes.json() as { items?: Array<{ id: string; selected?: boolean; accessRole?: string }> };
    calendarIds = (calList.items || [])
      .filter(c => c.selected !== false && (c.accessRole === "owner" || c.accessRole === "writer" || c.accessRole === "reader"))
      .map(c => c.id);
    if (!calendarIds.length) calendarIds = ["primary"];
  }

  const allEvents: ReturnType<typeof mapEvent>[] = [];
  function mapEvent(e: GCalEvent, calId: string) {
    const startRaw = e.start?.dateTime || e.start?.date || "";
    const endRaw   = e.end?.dateTime   || e.end?.date   || "";
    const allDay   = !e.start?.dateTime;
    const date     = startRaw.slice(0, 10);
    const time     = allDay ? "" : startRaw.slice(11, 16);
    const endTime  = allDay ? "" : endRaw.slice(11, 16);
    return { id: `${calId}::${e.id}`, title: e.summary || "Sem título", date, time, endTime, allDay, meetUrl: e.hangoutLink || null, htmlLink: e.htmlLink || null };
  }

  await Promise.all(calendarIds.map(async calId => {
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime&maxResults=250`;
    const gr = await fetch(url, { headers: { Authorization: `Bearer ${token.accessToken}` } });
    if (!gr.ok) return;
    const data = await gr.json() as { items?: GCalEvent[] };
    (data.items || []).filter(e => e.status !== "cancelled").forEach(e => allEvents.push(mapEvent(e, calId)));
  }));

  // Deduplicate by date+time+title in case same event appears in multiple calendars
  const seen = new Set<string>();
  const unique = allEvents.filter(e => { const k = `${e.date}|${e.time}|${e.title}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return res.json(unique);
});

// ── STRAVA ───────────────────────────────────────────────────────────────────

const STRAVA_CLIENT_ID     = process.env.STRAVA_CLIENT_ID     || "";
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET || "";

async function stravaRefreshIfNeeded(userId: string) {
  let token = await prisma.stravaToken.findUnique({ where: { userId } });
  if (!token) throw Object.assign(new Error("NOT_CONNECTED"), { status: 400 });
  const now = Math.floor(Date.now() / 1000);
  if (token.expiresAt < now + 60) {
    const r = await fetch("https://www.strava.com/oauth/token", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: STRAVA_CLIENT_ID, client_secret: STRAVA_CLIENT_SECRET, refresh_token: token.refreshToken, grant_type: "refresh_token" }),
    });
    if (!r.ok) throw Object.assign(new Error("STRAVA_REFRESH_ERROR"), { status: 400 });
    const d = await r.json() as { access_token: string; refresh_token: string; expires_at: number };
    token = await prisma.stravaToken.update({ where: { userId }, data: { accessToken: d.access_token, refreshToken: d.refresh_token, expiresAt: d.expires_at } });
  }
  return token;
}

apiRouter.post("/strava/exchange-token", requireAuth, async (req: AuthedRequest, res) => {
  const { code } = req.body as { code: string };
  if (!code) return res.status(400).json({ error: "BAD_REQUEST" });
  const r = await fetch("https://www.strava.com/oauth/token", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: STRAVA_CLIENT_ID, client_secret: STRAVA_CLIENT_SECRET, code, grant_type: "authorization_code" }),
  });
  if (!r.ok) return res.status(400).json({ error: "STRAVA_ERROR", detail: await r.text() });
  const d = await r.json() as { access_token: string; refresh_token: string; expires_at: number; scope: string; athlete: { id: number; firstname: string; lastname: string } };
  await prisma.stravaToken.upsert({
    where: { userId: req.userId! },
    update: { athleteId: d.athlete.id, accessToken: d.access_token, refreshToken: d.refresh_token, expiresAt: d.expires_at, scope: d.scope },
    create: { userId: req.userId!, athleteId: d.athlete.id, accessToken: d.access_token, refreshToken: d.refresh_token, expiresAt: d.expires_at, scope: d.scope },
  });
  return res.json({ ok: true, athlete: `${d.athlete.firstname} ${d.athlete.lastname}` });
});

apiRouter.get("/strava/status", requireAuth, async (req: AuthedRequest, res) => {
  const token = await prisma.stravaToken.findUnique({ where: { userId: req.userId! } });
  return res.json({ connected: !!token, scope: token?.scope || null, athleteId: token?.athleteId || null });
});

apiRouter.delete("/strava/disconnect", requireAuth, async (req: AuthedRequest, res) => {
  const token = await prisma.stravaToken.findUnique({ where: { userId: req.userId! } });
  if (token) {
    // Notify Strava of deauthorization (best-effort)
    await fetch("https://www.strava.com/oauth/deauthorize", {
      method: "POST",
      headers: { Authorization: `Bearer ${token.accessToken}` },
    }).catch(() => null);
    await prisma.stravaToken.deleteMany({ where: { userId: req.userId! } });
  }
  return res.status(204).send();
});

apiRouter.post("/strava/sync", requireAuth, async (req: AuthedRequest, res) => {
  const token = await stravaRefreshIfNeeded(req.userId!).catch(e => { throw e; });
  const days = Number((req.body as { days?: number }).days || 30);
  const after = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);
  const ar = await fetch(`https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=100`, { headers: { Authorization: `Bearer ${token.accessToken}` } });
  if (!ar.ok) return res.status(400).json({ error: "STRAVA_FETCH_ERROR" });
  const activities = await ar.json() as Array<{ id: number; name: string; type: string; sport_type?: string; start_date_local: string; moving_time: number; distance: number; total_elevation_gain?: number; average_heartrate?: number }>;
  const catMap: Record<string, string> = {
    Run:"cardio",VirtualRun:"cardio",TrailRun:"cardio",
    Ride:"cardio",VirtualRide:"cardio",MountainBikeRide:"cardio",GravelRide:"cardio",EBikeRide:"cardio",EMountainBikeRide:"cardio",
    Swim:"cardio",Walk:"cardio",Hike:"cardio",Rowing:"cardio",Kayaking:"cardio",
    NordicSki:"cardio",AlpineSki:"cardio",BackcountrySki:"cardio",Snowboard:"cardio",
    RollerSki:"cardio",IceSkate:"cardio",Soccer:"cardio",Tennis:"cardio",Badminton:"cardio",
    WeightTraining:"forca",Workout:"forca",CrossFit:"forca",Yoga:"forca",Pilates:"forca",Stretching:"forca",RockClimbing:"forca",Surfing:"forca",
  };
  // Load excluded strava activity IDs for this user
  const excluded = await prisma.stravaExcluded.findMany({ where: { userId: req.userId! }, select: { clientId: true } });
  const excludedSet = new Set(excluded.map(e => e.clientId));
  let synced = 0;
  for (const act of activities) {
    const clientId = `strava_${act.id}`;
    if (excludedSet.has(clientId)) continue; // user deleted this, skip
    const sportType = act.sport_type || act.type;
    const data_str = act.start_date_local.slice(0, 10);
    const hora = act.start_date_local.slice(11, 16);
    const duracao = act.moving_time ? Math.round(act.moving_time / 60) : null;
    const km = act.distance ? act.distance / 1000 : null;
    const tipo_cat = catMap[sportType] || "cardio";
    const extras = [
      act.total_elevation_gain ? `${Math.round(act.total_elevation_gain)}m elevação` : null,
      act.average_heartrate ? `FC ${Math.round(act.average_heartrate)}bpm` : null,
    ].filter(Boolean).join(' · ');
    const payload = { titulo: act.name, data: data_str, hora_inicio: hora, hora_fim: null as string | null, duracao, tipo_cat, tipo_ex: sportType, calorias: null as number | null, km: km != null ? toDecimal(km) : null, local_nome: null as string | null, descricao: "Importado do Strava", obs: extras || null };
    // Skip update if user has manually edited this activity ([EDITED] marker in obs)
    const existing = await prisma.apiTreino.findUnique({ where: { userId_client_id: { userId: req.userId!, client_id: clientId } }, select: { obs: true } });
    if (existing?.obs?.includes('[EDITED]')) { synced++; continue; }
    await prisma.apiTreino.upsert({ where: { userId_client_id: { userId: req.userId!, client_id: clientId } }, update: payload, create: { userId: req.userId!, client_id: clientId, ...payload } });
    synced++;
  }
  return res.json({ ok: true, synced });
});
