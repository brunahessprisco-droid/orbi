const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function parseArg(name) {
  const prefix = `--${name}=`;
  const v = process.argv.find((a) => String(a).toLowerCase().startsWith(prefix));
  return v ? v.slice(prefix.length) : null;
}

function csvEscape(v) {
  const s = v == null ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function resolveUserId(emailArg) {
  if (emailArg) {
    const user = await prisma.user.findUnique({ where: { email: String(emailArg).toLowerCase() } });
    if (!user) throw new Error(`Usuário não encontrado para email: ${emailArg}`);
    return { id: user.id, email: user.email };
  }
  const user = await prisma.user.findFirst({ orderBy: { createdAt: "desc" } });
  if (!user) throw new Error("Nenhum usuário encontrado.");
  return { id: user.id, email: user.email };
}

async function main() {
  const fatura = parseArg("fatura");
  const email = parseArg("email");
  if (!fatura) throw new Error("Passe --fatura=YYYY-MM");

  const user = await resolveUserId(email);
  const rows = await prisma.apiTransacao.findMany({
    where: { userId: user.id, fatura },
    orderBy: [{ conta_nome: "asc" }, { categoria_nome: "asc" }, { descricao: "asc" }],
    select: {
      tipo: true,
      descricao: true,
      conta_nome: true,
      categoria_nome: true,
      valor: true,
      valor_parcela: true,
      parcela_atual: true,
      n_parcelas: true,
      data_lancamento: true,
      observacao: true,
      client_id: true,
      grupo_parcela_id: true,
    },
  });

  const header = [
    "fatura",
    "tipo",
    "descricao",
    "conta",
    "categoria",
    "valor",
    "valor_parcela",
    "parcela_atual",
    "n_parcelas",
    "data_lancamento",
    "grupo_parcela_id",
    "client_id",
    "observacao",
  ];

  const lines = [header.map(csvEscape).join(",")];
  for (const r of rows) {
    lines.push(
      [
        fatura,
        r.tipo,
        r.descricao,
        r.conta_nome,
        r.categoria_nome,
        r.valor,
        r.valor_parcela,
        r.parcela_atual,
        r.n_parcelas,
        r.data_lancamento ? r.data_lancamento.toISOString() : "",
        r.grupo_parcela_id,
        r.client_id,
        r.observacao,
      ]
        .map(csvEscape)
        .join(","),
    );
  }

  const outDir = path.join(process.cwd(), "exports");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `fatura_${fatura}.csv`);
  fs.writeFileSync(outPath, lines.join("\n"), "utf8");

  console.log(`OK: exportado ${rows.length} linhas para ${outPath} (user=${user.email})`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

