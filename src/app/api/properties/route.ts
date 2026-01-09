import { NextResponse } from "next/server";
import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function roundRobinBySource<T extends { sourceId: string }>(items: T[]): T[] {
  const buckets = new Map<string, T[]>();
  for (const it of items) {
    const arr = buckets.get(it.sourceId) ?? [];
    arr.push(it);
    buckets.set(it.sourceId, arr);
  }

  // orden estable de fuentes (para que no cambie en cada request)
  const keys = [...buckets.keys()].sort();

  const out: T[] = [];
  let moved = true;
  while (moved) {
    moved = false;
    for (const k of keys) {
      const arr = buckets.get(k)!;
      if (arr.length) {
        out.push(arr.shift()!);
        moved = true;
      }
    }
  }
  return out;
}


export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const q = (searchParams.get("q") || "").trim();
  const type = searchParams.get("type") || "all";
  const operation = searchParams.get("operation") || "all"; // venta | alquiler | all
  const currency = searchParams.get("currency") || "all"; // USD | ARS | all
  const sort = searchParams.get("sort") || "new"; // new | price_asc | price_desc

  const minPrice = Number(searchParams.get("minPrice") || 0);
  const maxPrice = Number(searchParams.get("maxPrice") || 0);

  const page = Math.max(1, Number(searchParams.get("page") || 1));
  const pageSize = Math.min(50, Math.max(5, Number(searchParams.get("pageSize") || 20)));
  const skip = (page - 1) * pageSize;

  const where: Prisma.PropertyWhereInput = {
    isActive: true,
    ...(type !== "all" ? { type } : {}),
    ...(operation !== "all" ? { operation } : {}),
    ...(currency !== "all" ? { currency } : {}),
    ...((minPrice || maxPrice)
      ? {
          price: {
            ...(minPrice ? { gte: minPrice } : {}),
            ...(maxPrice ? { lte: maxPrice } : {}),
          },
        }
      : {}),
    ...(q
      ? {
          OR: [
        { title: { contains: q } },
        { neighborhood: { contains: q } },
        { address: { contains: q } },
          ],
        }
      : {}),
  };

  const orderBy: Prisma.PropertyOrderByWithRelationInput[] =
    sort === "price_asc"
      ? [{ price: Prisma.SortOrder.asc }, { updatedAt: Prisma.SortOrder.desc }]
      : sort === "price_desc"
      ? [{ price: Prisma.SortOrder.desc }, { updatedAt: Prisma.SortOrder.desc }]
      : [{ updatedAt: Prisma.SortOrder.desc }];

  const total = await prisma.property.count({ where });

// ✅ Mezclar SOLO cuando el sort es "new"
if (sort === "new") {
  const takeForMix = page * pageSize * 5; // pool grande para poder intercalar

  const rawItems = await prisma.property.findMany({
    where,
    orderBy,
    skip: 0,
    take: takeForMix,
    include: { source: true },
  });

  const mixed = roundRobinBySource(rawItems);
  const items = mixed.slice(skip, skip + pageSize);

  return NextResponse.json({
    items,
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  });
}

// ✅ Para otros sorts, paginado normal
const items = await prisma.property.findMany({
  where,
  orderBy,
  skip,
  take: pageSize,
  include: { source: true },
});

return NextResponse.json({
  items,
  page,
  pageSize,
  total,
  totalPages: Math.ceil(total / pageSize),
});


  return NextResponse.json({
    items,
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  });
}
