const cheerio = require("cheerio");
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function hashId(str) {
  return crypto.createHash("sha1").update(str).digest("hex");
}

/**
 * Adapter ejemplo (tenés que ajustar selectores por cada web)
 * - listUrls: obtiene URLs de publicaciones desde una página de listados
 * - parse: entra a la publicación y extrae campos
 */
const adapters = [
  {
    id: "demo-local", // Source.id
    name: "Demo Local",
    baseUrl: "https://demo.local",
    async listUrls() {
      // EJEMPLO: reemplazar por la URL real del listado
      const listingPageUrl = "https://demo.local/listings";
      const html = await fetch(listingPageUrl).then((r) => r.text());
      const $ = cheerio.load(html);

      // EJEMPLO de selector: ajustar!
      const urls = [];
      $("a.card-link").each((_, el) => {
        const href = $(el).attr("href");
        if (href) urls.push(new URL(href, listingPageUrl).toString());
      });

      return [...new Set(urls)];
    },
    async parse(listingUrl) {
      const html = await fetch(listingUrl).then((r) => r.text());
      const $ = cheerio.load(html);

      // EJEMPLO: ajustar!
      const title = $("h1").first().text().trim() || "Sin título";
      const priceText = $(".price").first().text().trim(); // "USD 100.000"
      const neighborhood = $(".neighborhood").first().text().trim() || null;

      // Parse precio (simplón; lo mejoramos cuando veamos un caso real)
      const price = Number(priceText.replace(/[^\d]/g, "")) || 0;
      const currency = priceText.toUpperCase().includes("ARS") ? "ARS" : "USD";

      // Type: desde la página o inferido (ajustar)
      const type = $(".type").first().text().trim().toLowerCase() || "depto";

      // ExternalId: si la web lo tiene, usarlo. Si no, hash de la URL.
      const externalId = hashId(listingUrl);

      return {
        externalId,
        url: listingUrl,
        title,
        type,
        price,
        currency,
        neighborhood,
        address: null,
        raw: { priceText },
      };
    },
  },
];

async function ensureSource(adapter) {
  return prisma.source.upsert({
    where: { id: adapter.id },
    update: { name: adapter.name, baseUrl: adapter.baseUrl, isActive: true },
    create: { id: adapter.id, name: adapter.name, baseUrl: adapter.baseUrl, isActive: true },
  });
}

async function ingestAdapter(adapter) {
  const src = await ensureSource(adapter);
  const now = new Date();

  const urls = await adapter.listUrls();
  console.log(`[${adapter.id}] URLs encontradas:`, urls.length);

  let ok = 0;
  let fail = 0;

  for (const url of urls) {
    try {
      const item = await adapter.parse(url);

      await prisma.property.upsert({
        where: { sourceId_externalId: { sourceId: src.id, externalId: item.externalId } },
        update: {
          url: item.url,
          title: item.title,
          type: item.type,
          price: item.price,
          currency: item.currency,
          neighborhood: item.neighborhood,
          address: item.address,
          isActive: true,
          lastSeenAt: now,
          raw: item.raw,
        },
        create: {
          sourceId: src.id,
          externalId: item.externalId,
          url: item.url,
          title: item.title,
          type: item.type,
          price: item.price,
          currency: item.currency,
          neighborhood: item.neighborhood,
          address: item.address,
          isActive: true,
          lastSeenAt: now,
          raw: item.raw,
        },
      });

      ok++;
      // Rate limit para no matar la web
      await sleep(600);
    } catch (e) {
      fail++;
      console.error(`[${adapter.id}] Error parseando`, url, e?.message ?? e);
      await sleep(600);
    }
  }

  // Desactivar las que NO se vieron en esta corrida
  await prisma.property.updateMany({
    where: { sourceId: src.id, lastSeenAt: { lt: now } },
    data: { isActive: false },
  });

  console.log(`[${adapter.id}] OK=${ok} FAIL=${fail}`);
}

async function main() {
  for (const adapter of adapters) {
    await ingestAdapter(adapter);
  }
}

main()
  .catch(console.error)
  .finally(async () => prisma.$disconnect());
