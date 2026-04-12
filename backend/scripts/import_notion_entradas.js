const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Prisma, PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function sha1(input) {
  return crypto.createHash("sha1").update(input).digest("hex");
}

function decodeHtmlEntities(input) {
  return String(input || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, n) => String.fromCharCode(parseInt(String(n), 16)));
}

function stripHtml(input) {
  const noTags = String(input || "").replace(/<[^>]*>/g, " ");
  return decodeHtmlEntities(noTags).replace(/\s+/g, " ").trim();
}

function parseBrDate(ddmmyyyy) {
  const m = String(ddmmyyyy || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return new Date(`${yyyy}-${mm}-${dd}T00:00:00-03:00`);
}

function parseMoney(raw) {
  const s = String(raw || "").trim().replace(/\s/g, "").replace(/^R\$/i, "");
  if (!s) return null;

  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");

  let normalized = s;
  if (hasComma && hasDot) {
    // decide decimal separator by whichever appears last
    if (lastDot > lastComma) {
      // 5,600.00 -> remove commas
      normalized = s.replace(/,/g, "");
    } else {
      // 5.600,00 -> remove dots, comma -> dot
      normalized = s.replace(/\./g, "").replace(/,/g, ".");
    }
  } else if (hasComma && !hasDot) {
    // 5600,00 -> comma decimal
    normalized = s.replace(/\./g, "").replace(/,/g, ".");
  } else {
    // 5600.00 or 5600
    normalized = s.replace(/,/g, "");
  }

  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return n;
}

function parseCaixaToMonthYear(caixaText, refDate) {
  const raw = String(caixaText || "").trim().toUpperCase();
  const m = raw.match(/(\d{1,2})\.\s*([A-ZÇ]{3})/);
  if (!m) return null;
  const mon = m[2];
  const map = { JAN: 1, FEV: 2, MAR: 3, ABR: 4, MAI: 5, JUN: 6, JUL: 7, AGO: 8, SET: 9, OUT: 10, NOV: 11, DEZ: 12 };
  const month = map[mon];
  if (!month) return null;

  const refYear = refDate.getUTCFullYear();
  const refMonth = refDate.getUTCMonth() + 1;
  if (Math.abs(month - refMonth) <= 6) return `${refYear}-${String(month).padStart(2, "0")}`;

  const candidates = [refYear - 1, refYear, refYear + 1].map((y) => ({ y, m: month }));
  let best = candidates[0];
  let bestScore = Infinity;
  for (const c of candidates) {
    const d = new Date(`${c.y}-${String(c.m).padStart(2, "0")}-15T00:00:00-03:00`);
    const diffDays = Math.abs((d.getTime() - refDate.getTime()) / (1000 * 60 * 60 * 24));
    const tieBreaker = c.y === refYear ? -0.1 : 0;
    const score = diffDays + tieBreaker;
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return `${best.y}-${String(best.m).padStart(2, "0")}`;
}

async function resolveUserId(emailArg) {
  if (emailArg) {
    const user = await prisma.user.findUnique({ where: { email: String(emailArg).toLowerCase() } });
    if (!user) throw new Error(`Usuário não encontrado para email: ${emailArg}`);
    return user.id;
  }
  const users = await prisma.user.findMany({ orderBy: { createdAt: "desc" }, take: 2 });
  if (users.length === 0) throw new Error("Nenhum usuário encontrado. Faça Register/Login na tela primeiro.");
  if (users.length > 1) throw new Error("Mais de um usuário encontrado. Rode novamente passando --email=seu@email.com.");
  return users[0].id;
}

async function ensureConta(userId, contaNome) {
  const existing = await prisma.apiConta.findFirst({ where: { userId, nome: contaNome } });
  if (existing) return existing;
  const clientId = `import_${sha1(contaNome).slice(0, 10)}`;
  return prisma.apiConta.create({
    data: {
      userId,
      client_id: clientId,
      nome: contaNome,
      banco: "Banco",
      tipo: "credito",
      vencimento: null,
      limite_total: null,
      cor: "#7b9cff",
      ativo: true,
    },
  });
}

async function ensureCategoria(userId, categoriaNome) {
  const existing = await prisma.apiCategoria.findFirst({ where: { userId, nome: categoriaNome } });
  if (existing) return existing;
  const clientId = `import_${sha1(categoriaNome).slice(0, 10)}`;
  return prisma.apiCategoria.create({ data: { userId, client_id: clientId, nome: categoriaNome, cor: "#2dd4a0" } });
}

function extractRows(html) {
  const rows = [];
  const trRe = /<tr\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/g;
  let trMatch;
  while ((trMatch = trRe.exec(html))) {
    const trId = trMatch[1];
    const trInner = trMatch[2];
    const cells = [];
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
    let tdMatch;
    while ((tdMatch = tdRe.exec(trInner))) cells.push(stripHtml(tdMatch[1] || ""));
    if (cells.length < 4) continue;

    const data = parseBrDate(cells[0]);
    const descricao = cells[1];
    const valor = parseMoney(cells[2]);
    const caixa = cells[3] || "";
    if (!data || !descricao || valor == null) continue;
    rows.push({ clientId: trId, data, descricao, valor, caixa });
  }
  return rows;
}

function categoriaFromDescricao(descricao) {
  const d = String(descricao || "").toLowerCase();
  if (d.includes("salário") || d.includes("salario")) return "Salário";
  return "Outros";
}

async function main() {
  const htmlPathArg = process.argv.find((a) => String(a).toLowerCase().endsWith(".html"));
  const emailArg = process.argv.find((a) => String(a).toLowerCase().startsWith("--email="))?.split("=", 2)?.[1];
  if (!htmlPathArg) throw new Error("Passe o caminho do HTML. Ex: node scripts/import_notion_entradas.js \"C:\\path\\Entradas.html\"");

  const htmlPath = path.resolve(htmlPathArg);
  const html = fs.readFileSync(htmlPath, "utf8");
  const userId = await resolveUserId(emailArg);

  const extracted = extractRows(html);
  if (extracted.length === 0) throw new Error("Não encontrei linhas de tabela no HTML (export do Notion).");

  const contaNome = "Conta principal";
  await ensureConta(userId, contaNome);
  await ensureCategoria(userId, "Salário");
  await ensureCategoria(userId, "Outros");

  let upserts = 0;
  for (const r of extracted) {
    const fatura = parseCaixaToMonthYear(r.caixa, r.data) || `${r.data.getUTCFullYear()}-${String(r.data.getUTCMonth() + 1).padStart(2, "0")}`;
    const categoria = categoriaFromDescricao(r.descricao);

    const observacaoParts = [];
    if (r.caixa) observacaoParts.push(`Caixa: ${r.caixa}`);
    observacaoParts.push(`Importado do Notion: ${path.basename(htmlPath)}`);

    await prisma.apiTransacao.upsert({
      where: { userId_client_id: { userId, client_id: r.clientId } },
      update: {
        tipo: "receita",
        descricao: r.descricao,
        valor: new Prisma.Decimal(r.valor),
        data_lancamento: r.data,
        fatura,
        categoria_nome: categoria,
        conta_nome: contaNome,
        observacao: observacaoParts.join(" | "),
        grupo_parcela_id: null,
        n_parcelas: null,
        parcela_atual: null,
        valor_parcela: null,
        conta_fixa_id: null,
      },
      create: {
        userId,
        client_id: r.clientId,
        tipo: "receita",
        descricao: r.descricao,
        valor: new Prisma.Decimal(r.valor),
        data_lancamento: r.data,
        fatura,
        categoria_nome: categoria,
        conta_nome: contaNome,
        observacao: observacaoParts.join(" | "),
        grupo_parcela_id: null,
        n_parcelas: null,
        parcela_atual: null,
        valor_parcela: null,
        conta_fixa_id: null,
      },
    });
    upserts += 1;
  }

  console.log(`Import concluído: ${upserts} linhas upsertadas em ApiTransacao (tipo=receita).`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

