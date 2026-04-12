const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const { Prisma, PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function sha1(input) {
  return crypto.createHash("sha1").update(input).digest("hex");
}

const USER_ID = "a5afe9be-6f86-4da9-b9fd-4ce5fdf70e4b";

// FATURA format: "JUNHO.25", "MARÇO.26", etc.
const MONTH_MAP = {
  JANEIRO: 1, FEVEREIRO: 2, MARCO: 3, MARÇO: 3, ABRIL: 4, MAIO: 5,
  JUNHO: 6, JULHO: 7, AGOSTO: 8, SETEMBRO: 9, OUTUBRO: 10,
  NOVEMBRO: 11, DEZEMBRO: 12,
};

function parseFatura(raw) {
  // e.g. "JUNHO.25" → "2025-06", "MARÇO.26" → "2026-03"
  const s = raw.trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  // remove accents: MARÇO → MARCO
  const m = s.match(/^([A-Z]+)\.(\d{2})$/);
  if (!m) return null;
  const month = MONTH_MAP[m[1]];
  if (!month) return null;
  const year = 2000 + parseInt(m[2]);
  return `${year}-${String(month).padStart(2, "0")}`;
}

function addMonths(faturaStr, n) {
  // "2025-06" + 1 → "2025-07"
  const [y, mo] = faturaStr.split("-").map(Number);
  const d = new Date(y, mo - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function parseBrDate(s) {
  // "01/05/2025" → "2025-05-01"
  const p = s.trim().split("/");
  if (p.length !== 3) return null;
  return `${p[2]}-${p[1].padStart(2, "0")}-${p[0].padStart(2, "0")}`;
}

function parseMoney(s) {
  const n = parseFloat(
    s.trim().replace(/R\$\s*/g, "").replace(/\./g, "").replace(",", ".")
  );
  return isNaN(n) ? null : n;
}

async function ensureConta(userId, nome) {
  const existing = await prisma.apiConta.findFirst({ where: { userId, nome } });
  if (existing) return;
  const lower = nome.toLowerCase();
  const banco = lower.includes("itaú") || lower.includes("itau") ? "Itaú" : "Banco Inter";
  await prisma.apiConta.create({
    data: {
      userId,
      client_id: `import_${sha1(nome).slice(0, 10)}`,
      nome,
      banco,
      tipo: "parcelado",
      vencimento: null,
      limite_total: null,
      cor: "#7b9cff",
      ativo: true,
    },
  });
}

async function ensureCategoria(userId, nome) {
  const existing = await prisma.apiCategoria.findFirst({ where: { userId, nome } });
  if (existing) return;
  await prisma.apiCategoria.create({
    data: {
      userId,
      client_id: `import_${sha1(nome).slice(0, 10)}`,
      nome,
      cor: "#7b9cff",
    },
  });
}

async function main() {
  const csvPathArg = process.argv.find((a) => a.toLowerCase().endsWith(".csv"));
  if (!csvPathArg) throw new Error("Passe o CSV: node scripts/import_csv_parcelados.js arquivo.csv");

  const raw = fs.readFileSync(path.resolve(csvPathArg), "utf8").replace(/^\uFEFF/, "");
  const lines = raw.split(/\r?\n/);

  const purchases = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(";");
    if (!cols[0] || !cols[0].trim()) continue;

    const dataCompra = parseBrDate(cols[0]);
    const valorTotal = parseMoney(cols[1]);
    const nParcelas = parseInt(cols[2]);
    const descricao = cols[3].trim();
    const categoria = cols[4].trim();
    const faturaRaw = cols[5].trim();
    const conta = cols[6].trim();

    if (!dataCompra || !valorTotal || !nParcelas || !descricao || !faturaRaw || !conta) continue;

    const primeiraFatura = parseFatura(faturaRaw);
    if (!primeiraFatura) {
      console.warn(`Linha ${i + 1}: fatura inválida "${faturaRaw}", pulando`);
      continue;
    }

    purchases.push({ dataCompra, valorTotal, nParcelas, descricao, categoria, primeiraFatura, conta });
  }

  console.log(`${purchases.length} compras encontradas no CSV`);

  // Ensure contas and categorias
  const contaNames = [...new Set(purchases.map((p) => p.conta))];
  const catNames = [...new Set(purchases.map((p) => p.categoria))];
  for (const c of contaNames) await ensureConta(USER_ID, c);
  for (const c of catNames) await ensureCategoria(USER_ID, c);

  let upserts = 0;
  for (const p of purchases) {
    const valorParcela = parseFloat((p.valorTotal / p.nParcelas).toFixed(2));
    const groupKey = `${p.conta}|${p.descricao}|${p.dataCompra}|${p.nParcelas}|${p.valorTotal}`;
    const grupoParcela = sha1(groupKey).slice(0, 16);

    for (let parcAtual = 1; parcAtual <= p.nParcelas; parcAtual++) {
      const fatura = addMonths(p.primeiraFatura, parcAtual - 1);
      const clientId = `csv_${sha1(`${groupKey}|${parcAtual}`).slice(0, 16)}`;

      await prisma.apiTransacao.upsert({
        where: { userId_client_id: { userId: USER_ID, client_id: clientId } },
        update: {
          tipo: "parcela",
          descricao: p.descricao,
          valor: new Prisma.Decimal(valorParcela),
          data_lancamento: new Date(`${p.dataCompra}T00:00:00-03:00`),
          fatura,
          categoria_nome: p.categoria,
          conta_nome: p.conta,
          observacao: null,
          grupo_parcela_id: grupoParcela,
          n_parcelas: p.nParcelas,
          parcela_atual: parcAtual,
          valor_parcela: new Prisma.Decimal(valorParcela),
          conta_fixa_id: null,
        },
        create: {
          userId: USER_ID,
          client_id: clientId,
          tipo: "parcela",
          descricao: p.descricao,
          valor: new Prisma.Decimal(valorParcela),
          data_lancamento: new Date(`${p.dataCompra}T00:00:00-03:00`),
          fatura,
          categoria_nome: p.categoria,
          conta_nome: p.conta,
          observacao: null,
          grupo_parcela_id: grupoParcela,
          n_parcelas: p.nParcelas,
          parcela_atual: parcAtual,
          valor_parcela: new Prisma.Decimal(valorParcela),
          conta_fixa_id: null,
        },
      });
      upserts++;
    }
  }

  console.log(`Import concluído: ${upserts} parcelas inseridas no banco.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
