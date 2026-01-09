const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const src = await prisma.source.upsert({
    where: { id: "local" },
    update: {},
    create: { id: "local", name: "Demo Local", baseUrl: "https://demo.local" },
  });

  for (let i = 1; i <= 50; i++) {
    await prisma.property.upsert({
      where: { sourceId_externalId: { sourceId: src.id, externalId: String(i) } },
      update: { price: 50000 + i * 1000 },
      create: {
        sourceId: src.id,
        externalId: String(i),
        url: `https://demo.local/p/${i}`,
        title: `Propiedad ${i}`,
        type: i % 3 === 0 ? "casa" : i % 3 === 1 ? "depto" : "terreno",
        price: 50000 + i * 1000,
        currency: "USD",
        neighborhood: i % 2 === 0 ? "Centro" : "Zona Norte",
      },
    });
  }
}

main()
  .catch(console.error)
  .finally(async () => prisma.$disconnect());
