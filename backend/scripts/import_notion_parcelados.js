const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
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

function formatFatura(date) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`;
}

function parseCaixaToMonthYear(caixaText, refDate) {
  const raw = String(caixaText || "").trim().toUpperCase();
  // Examples: "25. NOV", "26. MAI"
  const m = raw.match(/(\d{1,2})\.\s*([A-ZÇ]{3})/);
  if (!m) return null;
  const mon = m[2]
    .replace("FEV", "FEV")
    .replace("MAR", "MAR")
    .replace("ABR", "ABR")
    .replace("MAI", "MAI")
    .replace("JUN", "JUN")
    .replace("JUL", "JUL")
    .replace("AGO", "AGO")
    .replace("SET", "SET")
    .replace("OUT", "OUT")
    .replace("NOV", "NOV")
    .replace("DEZ", "DEZ")
    .replace("JAN", "JAN");
  const map = { JAN: 1, FEV: 2, MAR: 3, ABR: 4, MAI: 5, JUN: 6, JUL: 7, AGO: 8, SET: 9, OUT: 10, NOV: 11, DEZ: 12 };
  const month = map[mon];
  if (!month) return null;

  const refYear = refDate.getUTCFullYear();
  const refMonth = refDate.getUTCMonth() + 1;
  const candidates = [refYear - 1, refYear, refYear + 1].map((y) => ({ y, m: month }));

  // pick closest month-year to refDate (avoid year boundary issues)
  let best = candidates[0];
  let bestScore = Infinity;
  for (const c of candidates) {
    const d = new Date(`${c.y}-${String(c.m).padStart(2, "0")}-15T00:00:00-03:00`);
    const diffDays = Math.abs((d.getTime() - refDate.getTime()) / (1000 * 60 * 60 * 24));
    // slight preference for same-year when tie
    const tieBreaker = c.y === refYear ? -0.1 : 0;
    const score = diffDays + tieBreaker;
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }

  // Also handle obvious same-year mismatch if month is close
  if (Math.abs(month - refMonth) <= 6) best = { y: refYear, m: month };

  return `${best.y}-${String(best.m).padStart(2, "0")}`;
}

function parseMoney(raw) {
  const cleaned = String(raw || "")
    .replace(/\s/g, "")
    .replace(/^R\$/i, "")
    .replace(/,/g, ".");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return n;
}

function mapConta(rawConta) {
  const c = String(rawConta || "").trim();
  if (c === "CC Parcelado BI") return "Inter Crédito 0111 e 1926";
  if (c === "CC Parcelado Itau") return "Itaú Crédito 5221";
  return c;
}

async function resolveUserId(emailArg) {
  if (emailArg) {
    const user = await prisma.user.findUnique({ where: { email: String(emailArg).toLowerCase() } });
    if (!user) throw new Error(`Usuário não encontrado para email: ${emailArg}`);
    return user.id;
  }
  const users = await prisma.user.findMany({ orderBy: { createdAt: "desc" }, take: 2 });
  if (users.length === 0) throw new Error("Nenhum usuário encontrado. Faça Register/Login na tela primeiro.");
  if (users.length > 1) {
    throw new Error("Mais de um usuário encontrado. Rode novamente passando --email=seu@email.com.");
  }
  return users[0].id;
}

async function ensureConta(userId, contaNome) {
  const existing = await prisma.apiConta.findFirst({ where: { userId, nome: contaNome } });
  if (existing) return existing;
  const clientId = `import_${sha1(contaNome).slice(0, 10)}`;
  const lower = contaNome.toLowerCase();
  const banco = lower.includes("itaú") || lower.includes("itau") ? "Itaú" : lower.includes("inter") ? "Banco Inter" : "Banco";
  return prisma.apiConta.create({
    data: {
      userId,
      client_id: clientId,
      nome: contaNome,
      banco,
      tipo: "parcelado",
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
  return prisma.apiCategoria.create({
    data: { userId, client_id: clientId, nome: categoriaNome, cor: "#7b9cff" },
  });
}

function extractRowsFromNotionTable(html) {
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
    if (cells.length < 9) continue;

    const dataComp = parseBrDate(cells[0]);
    const dataCaix = parseBrDate(cells[1]);
    const valor = parseMoney(cells[2]);
    const totalParc = Number(cells[3]);
    const parcAtual = Number(cells[4]);
    const oQue = cells[5];
    const categoria = cells[6] || "Outros";
    const caixa = cells[7] || "";
    const conta = cells[8] || "";

    if (!dataComp || !dataCaix || valor == null || !oQue || !conta) continue;
    if (!Number.isFinite(totalParc) || !Number.isFinite(parcAtual) || totalParc <= 0 || parcAtual <= 0) continue;

    rows.push({ clientId: trId, dataComp, dataCaix, valor, totalParc, parcAtual, oQue, categoria, caixa, conta });
  }
  return rows;
}

async function main() {
  const htmlPathArg = process.argv.find((a) => String(a).toLowerCase().endsWith(".html"));
  const emailArg = process.argv.find((a) => String(a).toLowerCase().startsWith("--email="))?.split("=", 2)?.[1];
  if (!htmlPathArg) throw new Error("Passe o caminho do HTML. Ex: node scripts/import_notion_parcelados.js \"C:\\path\\Parcelados.html\"");

  const htmlPath = path.resolve(htmlPathArg);
  const html = fs.readFileSync(htmlPath, "utf8");
  const userId = await resolveUserId(emailArg);

  const extracted = extractRowsFromNotionTable(html);
  if (extracted.length === 0) throw new Error("Não encontrei linhas de tabela no HTML (export do Notion).");

  const contaNames = Array.from(new Set(extracted.map((r) => mapConta(r.conta))));
  for (const contaNome of contaNames) await ensureConta(userId, contaNome);

  const catNames = Array.from(new Set(extracted.map((r) => r.categoria || "Outros")));
  for (const catNome of catNames) await ensureCategoria(userId, catNome);

  let upserts = 0;
  for (const r of extracted) {
    const contaNome = mapConta(r.conta);
    const groupKey = `${contaNome}|${r.oQue}|${r.dataComp.toISOString().slice(0, 10)}|${r.totalParc}|${r.valor}`;
    const grupo = sha1(groupKey).slice(0, 16);
    const fatura = parseCaixaToMonthYear(r.caixa, r.dataCaix) || formatFatura(r.dataCaix);

    const observacaoParts = [];
    observacaoParts.push(`Compra: ${r.dataComp.toISOString().slice(0, 10)}`);
    if (r.caixa) observacaoParts.push(`Caixa: ${r.caixa}`);
    observacaoParts.push(`Importado do Notion: ${path.basename(htmlPath)}`);

    await prisma.apiTransacao.upsert({
      where: { userId_client_id: { userId, client_id: r.clientId } },
      update: {
        tipo: "parcela",
        descricao: r.oQue,
        valor: new Prisma.Decimal(r.valor),
        data_lancamento: r.dataCaix,
        fatura,
        categoria_nome: r.categoria || "Outros",
        conta_nome: contaNome,
        observacao: observacaoParts.join(" | "),
        grupo_parcela_id: grupo,
        n_parcelas: r.totalParc,
        parcela_atual: r.parcAtual,
        valor_parcela: new Prisma.Decimal(r.valor),
        conta_fixa_id: null,
      },
      create: {
        userId,
        client_id: r.clientId,
        tipo: "parcela",
        descricao: r.oQue,
        valor: new Prisma.Decimal(r.valor),
        data_lancamento: r.dataCaix,
        fatura,
        categoria_nome: r.categoria || "Outros",
        conta_nome: contaNome,
        observacao: observacaoParts.join(" | "),
        grupo_parcela_id: grupo,
        n_parcelas: r.totalParc,
        parcela_atual: r.parcAtual,
        valor_parcela: new Prisma.Decimal(r.valor),
        conta_fixa_id: null,
      },
    });
    upserts += 1;
  }

  console.log(`Import concluído: ${upserts} linhas upsertadas em ApiTransacao.`);
  console.log(`Contas mapeadas: ${contaNames.join(", ")}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
