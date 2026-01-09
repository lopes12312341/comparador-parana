const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.property.findMany({
    select: { type: true },
  });

  const counts = {};
  for (const r of rows) counts[r.type] = (counts[r.type] || 0) + 1;

  console.log("Tipos encontrados en DB:");
  console.table(counts);

  const sample = await prisma.property.findMany({
    take: 10,
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, type: true, price: true },
  });

  console.log("Ejemplos:");
  console.table(sample);
}

main()
  .catch(console.error)
  .finally(async () => prisma.$disconnect());
