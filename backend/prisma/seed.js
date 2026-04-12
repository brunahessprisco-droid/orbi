"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function main() {
    await prisma.account.upsert({
        where: { id: "seed-account-cash" },
        update: {},
        create: {
            id: "seed-account-cash",
            name: "Carteira",
            type: client_1.AccountType.CASH,
            currency: "BRL",
        },
    });
    const categories = [
        { name: "Salário", kind: client_1.CategoryKind.INCOME },
        { name: "Mercado", kind: client_1.CategoryKind.EXPENSE },
        { name: "Transporte", kind: client_1.CategoryKind.EXPENSE },
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
