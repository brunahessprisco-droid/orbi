const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function resolveUserId(emailArg) {
  if (emailArg) {
    const user = await prisma.user.findUnique({ where: { email: String(emailArg).toLowerCase() } });
    if (!user) throw new Error(`Usuário não encontrado para email: ${emailArg}`);
    return user.id;
  }
  const user = await prisma.user.findFirst({ orderBy: { createdAt: "desc" } });
  if (!user) throw new Error("Nenhum usuário encontrado.");
  return user.id;
}

function parseArg(name) {
  const prefix = `--${name}=`;
  const v = process.argv.find((a) => String(a).toLowerCase().startsWith(prefix));
  return v ? v.slice(prefix.length) : null;
}

function inRange(fatura, from, to) {
  if (from && fatura < from) return false;
  if (to && fatura > to) return false;
  return true;
}

function toNum(v) {
  // Prisma Decimal comes as string in JS
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function main() {
  const email = parseArg("email");
  const from = parseArg("from"); // YYYY-MM
  const to = parseArg("to"); // YYYY-MM

  const userId = await resolveUserId(email);

  const rows = await prisma.apiTransacao.findMany({
    where: { userId },
    select: {
      fatura: true,
      tipo: true,
      valor: true,
      valor_parcela: true,
      conta_nome: true,
      categoria_nome: true,
    },
  });

  /** @type {Record<string, {receita:number,despesa:number,parcela:number,total:number,count:number, porConta: Record<string, number>}>} */
  const agg = {};

  for (const r of rows) {
    const f = r.fatura || "—";
    if (f === "—") continue;
    if (!inRange(f, from, to)) continue;
    if (!agg[f]) agg[f] = { receita: 0, despesa: 0, parcela: 0, total: 0, count: 0, porConta: {} };

    const tipo = r.tipo || "";
    const valor = tipo === "parcela" ? toNum(r.valor_parcela ?? r.valor) : toNum(r.valor);

    agg[f].count += 1;
    if (tipo === "receita") agg[f].receita += valor;
    else if (tipo === "parcela") agg[f].parcela += valor;
    else agg[f].despesa += valor;

    agg[f].total += valor;

    const conta = r.conta_nome || "—";
    agg[f].porConta[conta] = (agg[f].porConta[conta] || 0) + valor;
  }

  const meses = Object.keys(agg).sort();
  for (const m of meses) {
    const a = agg[m];
    console.log(
      `${m} | receitas=${a.receita.toFixed(2)} despesas=${a.despesa.toFixed(2)} parcelas=${a.parcela.toFixed(2)} total=${a.total.toFixed(2)} lançamentos=${a.count}`,
    );
    const topContas = Object.entries(a.porConta)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 6);
    for (const [conta, v] of topContas) console.log(`  - ${conta}: ${v.toFixed(2)}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
