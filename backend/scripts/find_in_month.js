const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function parseArg(name) {
  const prefix = `--${name}=`;
  const v = process.argv.find((a) => String(a).toLowerCase().startsWith(prefix));
  return v ? v.slice(prefix.length) : null;
}

async function main() {
  const fatura = parseArg("fatura");
  const amountStr = parseArg("amount");
  const email = parseArg("email");
  if (!fatura) throw new Error("Passe --fatura=YYYY-MM");

  const user = email
    ? await prisma.user.findUnique({ where: { email: String(email).toLowerCase() } })
    : await prisma.user.findFirst({ orderBy: { createdAt: "desc" } });
  if (!user) throw new Error("Usuário não encontrado.");

  const where = { userId: user.id, fatura };
  const rows = await prisma.apiTransacao.findMany({
    where,
    orderBy: [{ valor: "desc" }],
    select: {
      id: true,
      client_id: true,
      tipo: true,
      descricao: true,
      valor: true,
      valor_parcela: true,
      conta_nome: true,
      categoria_nome: true,
      parcela_atual: true,
      n_parcelas: true,
      grupo_parcela_id: true,
      data_lancamento: true,
    },
  });

  const amount = amountStr ? Number(amountStr) : null;
  const filtered = amount != null && Number.isFinite(amount)
    ? rows.filter((r) => {
        const v = Number(r.tipo === "parcela" ? r.valor_parcela ?? r.valor : r.valor);
        return Math.abs(v - amount) < 0.005;
      })
    : rows;

  console.log(`user=${user.email} fatura=${fatura} total_rows=${rows.length} shown=${filtered.length}`);
  for (const r of filtered.slice(0, 80)) {
    const v = Number(r.tipo === "parcela" ? r.valor_parcela ?? r.valor : r.valor);
    console.log(
      `${String(r.client_id).slice(0, 8)} ${r.tipo} ${v.toFixed(2)} ${r.parcela_atual || ""}/${r.n_parcelas || ""} ${r.conta_nome} | ${r.descricao}`,
    );
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

