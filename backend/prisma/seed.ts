import { PrismaClient, CategoryKind, AccountType } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.account.upsert({
    where: { id: "seed-account-cash" },
    update: {},
    create: {
      id: "seed-account-cash",
      name: "Carteira",
      type: AccountType.CASH,
      currency: "BRL",
    },
  });

  const categories = [
    { name: "Salário", kind: CategoryKind.INCOME },
    { name: "Mercado", kind: CategoryKind.EXPENSE },
    { name: "Transporte", kind: CategoryKind.EXPENSE },
  ];

  for (const category of categories) {
    await prisma.category.upsert({
      where: { name: category.name },
      update: { kind: category.kind },
      create: category,
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });

