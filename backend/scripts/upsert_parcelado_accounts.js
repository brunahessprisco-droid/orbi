const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function sha1(input) {
  return crypto.createHash("sha1").update(input).digest("hex");
}

async function resolveUserId(emailArg) {
  if (emailArg) {
    const user = await prisma.user.findUnique({ where: { email: String(emailArg).toLowerCase() } });
    if (!user) throw new Error(`Usuário não encontrado para email: ${emailArg}`);
    return user.id;
  }
  const users = await prisma.user.findMany({ orderBy: { createdAt: "desc" }, take: 1 });
  if (users.length === 0) throw new Error("Nenhum usuário encontrado. Faça Register/Login na tela primeiro.");
  return users[0].id;
}

async function upsertByName(userId, account) {
  const clientId = `acct_${sha1(account.nome).slice(0, 10)}`;

  const existing = await prisma.apiConta.findFirst({ where: { userId, nome: account.nome } });
  if (existing) {
    return prisma.apiConta.update({
      where: { id: existing.id },
      data: {
        banco: account.banco,
        tipo: account.tipo,
        vencimento: account.vencimento,
        limite_total: account.limite_total,
        cor: account.cor,
        ativo: true,
      },
    });
  }

  return prisma.apiConta.create({
    data: {
      userId,
      client_id: clientId,
      nome: account.nome,
      banco: account.banco,
      tipo: account.tipo,
      vencimento: account.vencimento,
      limite_total: account.limite_total,
      cor: account.cor,
      ativo: true,
    },
  });
}

async function main() {
  const emailArg = process.argv.find((a) => String(a).toLowerCase().startsWith("--email="))?.split("=", 2)?.[1];
  const userId = await resolveUserId(emailArg);

  const accounts = [
    {
      nome: "Inter Crédito 0111 e 1926",
      banco: "Banco Inter",
      tipo: "parcelado",
      vencimento: 7,
      limite_total: null,
      cor: "#2dd4a0",
    },
    {
      nome: "Itaú Crédito 5221",
      banco: "Itaú",
      tipo: "parcelado",
      vencimento: 7,
      limite_total: null,
      cor: "#fbbf24",
    },
  ];

  const results = [];
  for (const a of accounts) results.push(await upsertByName(userId, a));

  console.log("OK: contas atualizadas/criadas:", results.map((r) => r.nome).join(", "));
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

