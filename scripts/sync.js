/* scripts/sync.js */
const cheerio = require("cheerio");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari",
      accept: "text/html,application/xhtml+xml",
    },
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return await res.text();
}

function toAbsoluteUrl(maybeUrl, base) {
  if (!maybeUrl) return null;
  const s = String(maybeUrl).trim();
  if (!s) return null;

  // evita data: y cosas raras
  if (s.startsWith("data:")) return null;

  try {
    return new URL(s, base).toString();
  } catch {
    return null;
  }
}

function pickFromSrcset(srcset) {
  if (!srcset) return null;
  // "url1 300w, url2 800w" => nos quedamos con el último
  const parts = String(srcset)
    .split(",")
    .map((x) => x.trim().split(" ")[0])
    .filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}

function isBadImageUrl(u) {
  const s = String(u || "").toLowerCase();
  if (!s) return true;
  if (s.includes("logo") || s.includes("icon") || s.includes("sprite")) return true;
  if (s.endsWith(".svg")) return true;
  return false;
}


function bestImgFromCard($, $card, base) {
  // 1) imgs: buscamos la primera “buena” (a veces la 1ra es logo)
  const imgs = $card.find("img").toArray();
  for (const el of imgs) {
    const $img = $(el);
    const src = $img.attr("data-src")
      || $img.attr("data-lazy-src")
      || $img.attr("data-original")
      || $img.attr("data-srcset")
      || pickFromSrcset($img.attr("srcset"))
      || $img.attr("src");

    const abs = toAbsoluteUrl(src, base);
    if (abs && !isBadImageUrl(abs)) return abs;
  }

  // 2) background-image en el card o en cualquier descendiente con style
  const nodes = [$card, ...$card.find("[style]").toArray().map((el) => $(el))];

  for (const $n of nodes) {
    const style = $n.attr("style") || "";
    if (!style) continue;

    const m1 = style.match(/background-image:\s*url\((['"]?)(.*?)\1\)/i);
    const m2 = style.match(/background\s*:\s*[^;]*url\((['"]?)(.*?)\1\)/i);
    const raw = m1?.[2] || m2?.[2];

    if (raw) {
      const abs = toAbsoluteUrl(raw, base);
      if (abs && !isBadImageUrl(abs)) return abs;
    }
  }

  return null;
}



async function bestImgFromDetail(url, base) {
  try {
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);

    // 0) og:image / twitter:image (normalmente es la principal)
    const og =
      $("meta[property='og:image']").attr("content") ||
      $("meta[name='og:image']").attr("content") ||
      $("meta[name='twitter:image']").attr("content") ||
      $("meta[property='twitter:image']").attr("content");

    const ogAbs = toAbsoluteUrl(og, base);
    if (ogAbs && !isBadImageUrl(ogAbs)) return ogAbs;

    // 1) fallback: primera imagen “buena” del contenido
    const candidates = [];
    $("img").each((_, el) => {
      const $img = $(el);
      const src =
        $img.attr("data-src") ||
        $img.attr("data-lazy-src") ||
        $img.attr("data-original") ||
        $img.attr("data-srcset") ||
        pickFromSrcset($img.attr("srcset")) ||
        $img.attr("src");

      const abs = toAbsoluteUrl(src, base);
      if (!abs || isBadImageUrl(abs)) return;
      candidates.push(abs);
    });

    return candidates[0] || null;
  } catch {
    return null;
  }
}



function slugExternalIdFromUrl(url) {
  try {
    const u = new URL(url);
    return u.pathname.replace(/\/+$/, "");
  } catch {
    return url;
  }
}

function normalizeType(raw) {
  const s = String(raw || "").toLowerCase();

  if (/mono/.test(s)) return "monoambiente";
  if (/cocher/.test(s)) return "cochera";
  if (/galp[oó]n/.test(s)) return "galpon";
  if (/local/.test(s)) return "local";
  if (/duplex|d[uú]plex/.test(s)) return "duplex";

  if (/depto|depart/.test(s)) return "depto";
  if (/casa|quinta/.test(s)) return "casa";
  if (/terren|lote/.test(s)) return "terreno";

  return s ? s : "otro";
}

function inferOperation(text, fallback = null) {
  const t = String(text || "").toLowerCase();

  // alquiler / temporario
  if (/alquiler|alquilar|temporar|arrend/.test(t)) return "alquiler";

  // venta
  if (/venta|vender|en venta/.test(t)) return "venta";

  if (fallback) {
    const f = String(fallback).toLowerCase();
    if (f === "sale") return "venta";
    if (f === "rent") return "alquiler";
    if (f === "venta" || f === "alquiler") return f;
  }

  return null;
}

function parseNumberLikeAr(s) {
  // "160.000" -> 160000, "1 200 000" -> 1200000, "160,000" -> 160000
  const cleaned = String(s)
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(/,/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}


function parsePriceNumberSmart(raw) {
  let s = String(raw || "")
    .replace(/\u00a0/g, "")
    .replace(/\s/g, "")
    .trim();
  if (!s) return 0;

  const hasComma = s.includes(",");
  const hasDot = s.includes(".");

  // Si trae ambos, el ÚLTIMO separador suele ser el decimal
  if (hasComma && hasDot) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      // 1.234,56  -> decimal coma
      const n = Number(s.replace(/\./g, "").replace(",", "."));
      return Number.isFinite(n) ? Math.round(n) : 0;
    } else {
      // 1,234.56  -> decimal punto
      const n = Number(s.replace(/,/g, ""));
      return Number.isFinite(n) ? Math.round(n) : 0;
    }
  }

  // Solo comas: 365,000 (miles) o 365,5 (decimal)
  if (hasComma) {
    if (/^\d{1,3}(,\d{3})+$/.test(s)) {
      const n = Number(s.replace(/,/g, ""));
      return Number.isFinite(n) ? Math.round(n) : 0;
    } else {
      const n = Number(s.replace(",", "."));
      return Number.isFinite(n) ? Math.round(n) : 0;
    }
  }

  // Solo puntos: 90.000 (miles) o 365.5 (decimal)
  if (hasDot) {
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
      const n = Number(s.replace(/\./g, ""));
      return Number.isFinite(n) ? Math.round(n) : 0;
    } else {
      const n = Number(s);
      return Number.isFinite(n) ? Math.round(n) : 0;
    }
  }

  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function parsePrice(text) {
  const t = String(text || "").replace(/\u00a0/g, " ");

  // Moneda (prioridad USD si aparece)
  const currency = /U\$S|US\$|USD/i.test(t) ? "USD" : "ARS";

  // ✅ Soporta miles con punto o coma: 90.000 / 365,000 / 1.234.567
  const re =
  /(U\$S|US\$|USD|\$)\s*([0-9]{1,3}(?:\s*[.,]\s*[0-9]{3})*(?:\s*[.,]\s*[0-9]{1,2})?)/i;
  const m = t.match(re);
  if (!m) return { currency, price: 0 };

  let raw = m[2].replace(/\s/g, ""); // ✅ mata "90 .000" => "90.000"
  let price = parsePriceNumberSmart(raw);

  // ✅ Guardrail anti “precio + nro calle” (recorta grupos ,000 o .000)
  if (currency === "USD" && price > 10_000_000) {
    let raw2 = String(raw).replace(/\s/g, "");
    while (price > 10_000_000 && /([.,]\d{3})$/.test(raw2)) {
      raw2 = raw2.replace(/([.,]\d{3})$/, "");
      const tmp = parsePriceNumberSmart(raw2);
      if (tmp > 0) price = tmp;
      else break;
    }
  }

  return { currency, price };
}



/** ---------------------------
 *  SCRAPER 1: JC Bustamante
 *  -------------------------- */
async function scrapeJcBustamante({ purpose, maxPages = 10, delayMs = 300 }) {
  const out = [];
  const base = "https://jcbustamantepropiedades.com.ar";
  const userId = "482";

  // si el listado no trae img en el card, hacemos fallback al detalle
  let detailFetched = 0;
  const detailLimit = 250;

  for (let page = 1; page <= maxPages; page++) {
    const url = `${base}/listing?purpose=${purpose}&user_id=${userId}&page=${page}`;
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);

    const anchors = $("a[href*='/ad/']").toArray();
    let added = 0;

    for (const a of anchors) {
      const href = $(a).attr("href");
      if (!href) continue;

      const fullUrl = new URL(href, base).toString();
      const $a = $(a);

      // ✅ encontrar un contenedor que realmente incluya la imagen
      let card = $a.closest("article, li, .item, .property, .card");
      if (!card.length) card = $a.parent();

      // subimos por padres hasta encontrar uno con <img>
      let cur = $a;
      for (let i = 0; i < 12; i++) {
        const p = cur.parent();
        if (!p.length) break;
        if (p.find("img").length) { card = p; break; }
        cur = p;
      }

      const cardText = card.text().replace(/\s+/g, " ").trim();

      // Código suele venir como "Código: 3511"
      const code = cardText.match(/c[oó]digo:\s*(\d+)/i)?.[1] ?? null;

      // Título: alt de img es confiable en JC
      const title =
        card.find("img").first().attr("alt")?.trim() ||
        card.find("h1,h2,h3,h4,h5").first().text().trim() ||
        $a.attr("title")?.trim() ||
        $a.text().replace(/\s+/g, " ").trim() ||
        `Propiedad ${code ?? slugExternalIdFromUrl(fullUrl)}`;

      const candidates = ["Casa", "Departamento", "Depto", "Terreno", "Lote", "Dúplex", "Duplex", "Quinta", "Monoambiente", "Local", "Cochera", "Galpón", "Galpon"];
      let rawType = "";
      for (const c of candidates) {
        if (cardText.toLowerCase().includes(c.toLowerCase())) { rawType = c; break; }
      }

      const { currency, price } = parsePrice(cardText);
      const operation = inferOperation(cardText, purpose);

      // ✅ Imagen
      let imageUrl = bestImgFromCard($, card, base) || null;
      if (!imageUrl && detailFetched < detailLimit) {
        imageUrl = (await bestImgFromDetail(fullUrl, base)) || null;
        detailFetched++;
        await sleep(80);
      }

      out.push({
        externalId: code ?? slugExternalIdFromUrl(fullUrl),
        url: fullUrl,
        title,
        type: normalizeType(rawType),
        price,
        currency,
        neighborhood: null,
        operation,
        raw: { source: "jcbustamante", purpose, cardText },
        imageUrl,
      });

      added++;
    }

    if (added === 0) break;
    await sleep(delayMs);
  }

  const map = new Map();
  for (const it of out) map.set(it.externalId, it);
  return [...map.values()];
}

/** ---------------------------
 *  SCRAPER 12: Eduardo Rodríguez Inmobiliaria (Venta / Alquiler)
 *  - Dedupe global ANTES de bajar detalle
 *  - Detalle en paralelo con concurrencia controlada
 *  -------------------------- */
async function scrapeEduardoRodriguez({
  metaParam,                 // "Venta" | "Alquiler"
  maxPages = 30,
  delayMs = 200,             // pausa entre páginas
  detailConcurrency = 8,     // 6-10 suele ir bien
  detailDelayMs = 0,         // pausa opcional por detalle (si rate-limitea)
}) {
  const out = [];
  const base = "https://eduardorodriguezinmobiliaria.com";

  // fallback a detalle (para completar precio/tipo/imagen si el card no trae)
  let detailFetched = 0;
  const detailLimit = 800; // ajustable

  // dedupe GLOBAL para no repetir por paginación
  const seenGlobal = new Set();

  function opFromMeta(meta) {
    const m = String(meta || "").toLowerCase();
    return m.includes("alquiler") ? "alquiler" : "venta";
  }

  function pickTypeFromText(txt) {
    const t = String(txt || "").toLowerCase();
    if (t.includes("monoambiente")) return "Monoambiente";
    if (t.includes("departamento") || t.includes("depto")) return "Departamento";
    if (t.includes("duplex") || t.includes("dúplex")) return "Duplex";
    if (t.includes("casa quinta") || t.includes("quinta")) return "Casa Quinta";
    if (t.includes("local")) return "Local";
    if (t.includes("oficina")) return "Oficina";
    if (t.includes("galpon") || t.includes("galpón")) return "Galpón";
    if (t.includes("campo")) return "Campo";
    if (t.includes("terreno") || t.includes("lote")) return "Terreno";
    if (t.includes("casa")) return "Casa";
    return "";
  }

  async function asyncPool(limit, items, worker) {
    const ret = [];
    const executing = new Set();
    const L = Math.max(1, Number(limit) || 1);

    for (const item of items) {
      const p = Promise.resolve().then(() => worker(item));
      ret.push(p);
      executing.add(p);

      const clean = () => executing.delete(p);
      p.then(clean).catch(clean);

      if (executing.size >= L) {
        await Promise.race(executing);
      }
    }

    return Promise.allSettled(ret);
  }

  function extractImgFromDetail($d) {
    // 0) og:image / twitter:image
    const og =
      $d("meta[property='og:image']").attr("content") ||
      $d("meta[name='og:image']").attr("content") ||
      $d("meta[name='twitter:image']").attr("content") ||
      $d("meta[property='twitter:image']").attr("content");

    const ogAbs = toAbsoluteUrl(og, base);
    if (ogAbs && !isBadImageUrl(ogAbs)) return ogAbs;

    // 1) primera imagen “buena”
    let imageUrl = null;
    $d("img").each((_, el) => {
      if (imageUrl) return;

      const src =
        $d(el).attr("data-src") ||
        $d(el).attr("data-lazy-src") ||
        $d(el).attr("data-original") ||
        $d(el).attr("data-srcset") ||
        pickFromSrcset($d(el).attr("srcset")) ||
        $d(el).attr("src");

      const abs = toAbsoluteUrl(src, base);
      if (abs && !isBadImageUrl(abs)) imageUrl = abs;
    });

    return imageUrl;
  }

  for (let page = 1; page <= maxPages; page++) {
    const listUrl =
      page === 1
        ? `${base}/categoria/?meta=${encodeURIComponent(metaParam)}`
        : `${base}/categoria/page/${page}/?meta=${encodeURIComponent(metaParam)}`;

    let html;
    try {
      html = await fetchHtml(listUrl);
    } catch {
      break; // 404/500 => cortamos paginación
    }

    const $ = cheerio.load(html);

    const anchors = $("a[href*='/inmobiliaria/']").toArray();

    const seenPage = new Set();
    const batch = [];

    for (const a of anchors) {
      const $a = $(a);
      const href = $a.attr("href");
      if (!href) continue;

      const fullUrl = new URL(href, base).toString();

      // filtra solo /inmobiliaria/<slug>/
      if (!/\/inmobiliaria\/[^\/]+\/?$/i.test(fullUrl)) continue;

      const externalId = slugExternalIdFromUrl(fullUrl);

      // dedupe por página
      if (seenPage.has(externalId)) continue;
      seenPage.add(externalId);

      // dedupe global
      if (seenGlobal.has(externalId)) continue;
      seenGlobal.add(externalId);

      // Card: subimos hasta algo que incluya img o bg-image (si existe)
      let card = $a.closest("article, li, .property, .item, .card");
      if (!card.length) card = $a.parent();

      let cur = $a;
      for (let i = 0; i < 12; i++) {
        const p = cur.parent();
        if (!p.length) break;

        if (
          p.find("img").length ||
          p.find("[style*='background-image'],[style*='background:']").length
        ) {
          card = p;
          break;
        }
        cur = p;
      }

      const cardText = (card.text() || $a.text()).replace(/\s+/g, " ").trim();

      const titleFromList =
        card.find("h1,h2,h3,h4").first().text().replace(/\s+/g, " ").trim() ||
        $a.attr("title")?.trim() ||
        $a.text().replace(/\s+/g, " ").trim() ||
        `Propiedad ${externalId}`;

      const rawTypeFromList = pickTypeFromText(`${titleFromList} ${cardText}`);

      const { currency: curList, price: priceList } = parsePrice(`${titleFromList} ${cardText}`);

      const imageFromList = bestImgFromCard($, card, base) || null;

      // ¿pedimos detalle?
      const needsDetail =
        detailFetched < detailLimit &&
        (priceList === 0 || !rawTypeFromList || !imageFromList || !titleFromList);

      if (needsDetail) detailFetched++;

      batch.push({
        externalId,
        fullUrl,
        page,
        listUrl,
        titleFromList,
        rawTypeFromList,
        priceList,
        curList,
        imageFromList,
        needsDetail,
      });
    }

    if (batch.length === 0) break;

    await asyncPool(detailConcurrency, batch, async (it) => {
      let title = it.titleFromList;
      let rawType = it.rawTypeFromList;
      let price = it.priceList;
      let currency = it.curList;
      let imageUrl = it.imageFromList;

      if (it.needsDetail) {
        try {
          const dhtml = await fetchHtml(it.fullUrl);
          const $d = cheerio.load(dhtml);

          const dTitle =
            $d("h1").first().text().replace(/\s+/g, " ").trim() ||
            $d("title").text().replace(/\s+/g, " ").trim();

          if (dTitle && dTitle.length >= 4) title = dTitle;

          const detailText = $d("body").text().replace(/\s+/g, " ").trim();

          // mejorar tipo/precio si en listado no vino
          if (!rawType) rawType = pickTypeFromText(`${title} ${detailText}`);

          const p2 = parsePrice(detailText);
          if ((price || 0) === 0 && (p2.price || 0) > 0) {
            price = p2.price;
            currency = p2.currency;
          } else if (!currency) {
            currency = p2.currency;
          }

          if (!imageUrl) {
            imageUrl = extractImgFromDetail($d) || null;
          }
        } catch {
          // si falla detalle, nos quedamos con lo del listado
        }

        if (detailDelayMs > 0) await sleep(detailDelayMs);
      }

      out.push({
        externalId: it.externalId,
        url: it.fullUrl,
        title,
        type: normalizeType(rawType),
        price: typeof price === "number" ? price : 0,
        currency: currency || "ARS",
        neighborhood: null,
        operation: opFromMeta(metaParam),
        raw: { source: "eduardorodriguez", page: it.page, listUrl: it.listUrl },
        imageUrl,
      });
    });

    await sleep(delayMs);
  }

  // dedupe final (por las dudas)
  const map = new Map();
  for (const it of out) map.set(it.externalId, it);
  return [...map.values()];
}


/** ---------------------------
 *  SCRAPER 2: Florencio Bogado
 *  -------------------------- */
async function scrapeFlorencio({ typeParam, maxPages = 10, delayMs = 300 }) {
  const out = [];
  const base = "https://www.florenciobogado.com.ar";

  // el listado muchas veces no trae img => fallback a detalle
  let detailFetched = 0;
  const detailLimit = 300;

  function findCard($a) {
    // contenedores comunes
    let card = $a.closest("article, li, .property, .item, .card, .elementor-widget, .elementor-column, .elementor-container");
    if (card.length) return card;

    // subir por padres buscando img o background-image en algún hijo
    let cur = $a;
    for (let i = 0; i < 14; i++) {
      const p = cur.parent();
      if (!p.length) break;

      if (p.find("img").length) return p;
      if (p.find("[style*='background-image'],[style*='background:']").length) return p;

      cur = p;
    }

    return $a.parent();
  }

  for (let page = 1; page <= maxPages; page++) {
    const url =
      page === 1
        ? `${base}/busqueda/?type=${typeParam}`
        : `${base}/busqueda/page/${page}/?type=${typeParam}`;

    const html = await fetchHtml(url);
    const $ = cheerio.load(html);

    // ✅ el link puede venir vacío pero con title (como el que pegaste)
    const links = $("a.property-link[href*='/propiedades/'], a[href*='/propiedades/']").toArray();

    let added = 0;
    for (const a of links) {
      const href = $(a).attr("href");
      if (!href) continue;

      const fullUrl = new URL(href, base).toString();
      if (!fullUrl.includes("/propiedades/")) continue;

      const $a = $(a);
      const card = findCard($a);
      const cardText = card.text().replace(/\s+/g, " ").trim();

      const title =
        $a.attr("title")?.trim() ||
        card.find("img").first().attr("alt")?.trim() ||
        card.find("h1,h2,h3,h4").first().text().trim() ||
        `Propiedad ${slugExternalIdFromUrl(fullUrl)}`;

      // Tipo por texto (si no, queda vacío y normalizeType lo lleva a "otro")
      const rawType =
        /terrenos|terreno|lote/i.test(cardText)
          ? "Terreno"
          : /departamentos|depto|departamento/i.test(cardText)
          ? "Departamento"
          : /casas|casa|quinta|duplex|dúplex/i.test(cardText)
          ? "Casa"
          : "";

      const { currency, price } = parsePrice(cardText);
      const operation = inferOperation(`${title} ${cardText}`, typeParam);

      // ✅ Imagen: card (incluye bg en hijos por bestImgFromCard nuevo) y fallback al detalle
      let imageUrl = bestImgFromCard($, card, base) || null;
      if (!imageUrl && detailFetched < detailLimit) {
        imageUrl = (await bestImgFromDetail(fullUrl, base)) || null;
        detailFetched++;
        await sleep(80);
      }

      out.push({
        externalId: slugExternalIdFromUrl(fullUrl),
        url: fullUrl,
        title,
        type: normalizeType(rawType),
        price,
        currency,
        neighborhood: null,
        operation,
        raw: { source: "florencio", typeParam, cardText },
        imageUrl,
      });

      added++;
    }

    if (added === 0) break;
    await sleep(delayMs);
  }

  const map = new Map();
  for (const it of out) map.set(it.externalId, it);
  return [...map.values()];
}


/** ---------------------------
 *  SCRAPER 3: Inmobiliaria Mega
 *  -------------------------- */
async function scrapeMega({ categorySlug, maxPages = 10, delayMs = 300 }) {
  const out = [];
  const base = "https://inmobiliariamega.com.ar";
  const categoryUrl = `${base}/categorias/${categorySlug}/`;
  const seen = new Map(); // externalId -> index en out

  for (let page = 1; page <= maxPages; page++) {
    const url = page === 1 ? categoryUrl : `${categoryUrl}page/${page}/`;
    let html;
try {
  html = await fetchHtml(url);
} catch (e) {
  const msg = String(e?.message || e);
  if (msg.includes("HTTP 404")) {
    console.log(`ℹ️ Mega: fin de paginación (404) en ${url}`);
  } else {
    console.warn(`⚠️ Mega: error pidiendo ${url}: ${msg}`);
  }
  break; // cortamos paginación para no romper el sync
}

    const $ = cheerio.load(html);

    // ✅ MEGA usa /propiedades/ (plural). Igual soportamos /propiedad/ por las dudas.
    const links = $("a[href*='/propiedades/'], a[href*='/propiedad/']").toArray();

    function findMegaCard($a) {
  // subimos hasta un contenedor que incluya IMG o background-image
  let cur = $a;
  for (let i = 0; i < 12; i++) {
    const p = cur.parent();
    if (!p.length) break;

    if (p.find("img").length) return p;
    if (p.find("[style*='background-image'], [style*='background:']").length) return p;

    cur = p;
  }

  // fallback a contenedores típicos (sin "div" para no agarrar cualquier cosa)
  const c = $a.closest("article, .property, .property_listing, .item, li");
  return c.length ? c : $a.parent();
}


    let added = 0;
    for (const a of links) {
      const href = $(a).attr("href");
      if (!href) continue;

      const fullUrl = new URL(href, base).toString();
      if (!fullUrl.includes("/propiedades/") && !fullUrl.includes("/propiedad/")) continue;

      const $a = $(a);
      const card = findMegaCard($a);

      const cardText = card.text().replace(/\s+/g, " ").trim();
      const title =
        card.find("h1,h2,h3").first().text().trim() ||
        $(a).attr("title") ||
        $(a).text().replace(/\s+/g, " ").trim();

      if (!title || title.length < 4) continue;
      
      

      const rawType =
        /depart/i.test(cardText) ? "Departamento" :
        /casa|quinta/i.test(cardText) ? "Casa" :
        /terren|lote/i.test(cardText) ? "Terreno" :
        categorySlug;

      const { currency, price } = parsePrice(cardText);
      const operation = inferOperation(`${title} ${cardText}`, null);

      let imageUrl = bestImgFromCard($, card, base) || null;


      
const externalId = slugExternalIdFromUrl(fullUrl);
const prevIdx = seen.get(externalId);

if (prevIdx != null) {
  // si ya existe, SOLO mejoramos
  if (!out[prevIdx].imageUrl && imageUrl) out[prevIdx].imageUrl = imageUrl;
  if ((out[prevIdx].price || 0) === 0 && (price || 0) > 0) {
    out[prevIdx].price = price;
    out[prevIdx].currency = currency;
  }
  continue;
}

seen.set(externalId, out.length);

out.push({
  externalId,
  url: fullUrl,
  title,
  type: normalizeType(rawType),
  price,
  currency,
  neighborhood: null,
  operation,
  raw: { source: "mega", categorySlug, cardText },
  imageUrl,
});


      added++;
    }

    if (added === 0) break;
    await sleep(delayMs);
  }

  // dedupe
  return out;
}


/** ---------------------------
 *  SCRAPER 4: León Inmobiliaria (Ventas)
 *  -------------------------- */
async function scrapeLeonInmobiliaria({ maxPages = 15, delayMs = 300 }) {
  const out = [];
  const base = "https://www.leoninmobiliaria.com.ar";

  let detailFetched = 0;
  const detailLimit = 250;

  function extractLeonId(url) {
    const m = String(url).match(/\/detalle-(\d+)-/i);
    return m?.[1] || slugExternalIdFromUrl(url);
  }

  function pickTypeFromText(cardText) {
    const t = String(cardText || "").toLowerCase();
    if (t.includes("departamento")) return "Departamento";
    if (t.includes("duplex") || t.includes("dúplex")) return "Duplex";
    if (t.includes("casa quinta")) return "Casa Quinta";
    if (t.includes("casa")) return "Casa";
    if (t.includes("lote")) return "Lote";
    if (t.includes("cochera")) return "Cochera";
    if (t.includes("campo")) return "Campo";
    if (t.includes("comercial")) return "Comercial";
    return "";
  }

  for (let page = 1; page <= maxPages; page++) {
    const url = page === 1 ? `${base}/ventas` : `${base}/ventas.php?p=${page}`;
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);

    // Los avisos linkean a /detalle-XXX-...
    const links = $("a")
  .filter((i, el) => /detalle-\d+/i.test($(el).attr("href") || ""))
  .toArray();


    let added = 0;

for (const el of links) {
  const $a = $(el); // ✅ acá se inicializa

  const href = $a.attr("href");
  if (!href) continue;

  const fullUrl = new URL(href, base).toString();

  // 1) Texto limpio (mejor desde el <a>)
  const linkTextRaw = ($a.text() || "").replace(/\s+/g, " ").trim();
  const linkText = linkTextRaw.replace(/\[\s*\.\.\.\s*\]\s*$/, "").trim();

  // (opcional) filtro para evitar links basura si aparecen
  if (!linkText) continue;

  // 2) Tipo
  const rawType =
    linkText.match(/^(casa|departamento|lote|comercial|cochera|campo|casa quinta|duplex)\b/i)?.[1] || "";

  // 3) Título corto
  let head = linkText.split(/Ubicación:/i)[0];
  head = head.split(/Precio:/i)[0].trim();

  const parts = head.split(".").map(s => s.trim()).filter(Boolean);

  const locPart = (parts[0] || "").replace(
    /^(casa|departamento|lote|comercial|cochera|campo|casa quinta|duplex)\b\s*/i,
    ""
  ).trim();

  let headline = (parts.slice(1).join(". ") || "").trim();
  headline = headline.replace(/\bVENTA\b[:\s-]*/i, "").trim();

  const title =
    (headline && locPart) ? `${headline} - ${locPart}` :
    (headline || locPart) ? (headline || locPart) :
    `Propiedad ${extractLeonId(fullUrl)}`;

  // 4) Precio (solo desde "Precio:")
  const priceScope = linkText.match(/Precio:/i)
    ? `Precio: ${linkText.split(/Precio:/i)[1]}`
    : linkText;

  const { currency, price } = parsePrice(priceScope);

  // 5) Imagen: buscar un padre que contenga <img>
  let card = $a;
  let cur = $a;

  for (let i = 0; i < 10; i++) {
    if (cur.find("img").length) { card = cur; break; }
    const p = cur.parent();
    if (!p.length) break;
    cur = p;
  }

  let imageUrl = bestImgFromCard($, card, base) || null;
  imageUrl = toAbsoluteUrl(imageUrl, base);


if (!imageUrl && detailFetched < detailLimit) {
  imageUrl = (await bestImgFromDetail(fullUrl, base)) || null;
  detailFetched++;
  await sleep(80);
}



  out.push({
    externalId: extractLeonId(fullUrl),
    url: fullUrl,
    title,
    type: normalizeType(rawType),
    price,
    currency,
    neighborhood: null,
    operation: "venta",
    raw: { source: "leon", page, linkText },
    imageUrl,
  });

  added++;
}



    if (added === 0) break;
    await sleep(delayMs);
  }

  // dedupe por externalId
  const map = new Map();
  for (const it of out) map.set(it.externalId, it);
  return [...map.values()];
}

/** ---------------------------
 *  SCRAPER 5: Caramagna Inmobiliaria (Ventas + Alquileres)
 *  -------------------------- */
async function scrapeCaramagna({ mode, maxPages = 15, delayMs = 300, t = 0 }) {
  const out = [];
  const base = "https://www.caramagnainmobiliaria.com";

  // fallback a detalle si el listado no trae buena img
  let detailFetched = 0;
  const detailLimit = 200;

  const listPath = mode === "venta" ? "ventas.php" : "alquileres.php";

  for (let page = 1; page <= maxPages; page++) {
    const url = `${base}/${listPath}?p=${page}&t=${t}`;
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);

    // links reales a ficha
    const anchors = $("a[href*='propertie-details.php']")
  .filter((i, el) => /[?&]id=\d+/i.test($(el).attr("href") || ""))
  .toArray();

    let added = 0;

    // dedupe por página (hay anchors repetidos)
    const seen = new Set();

    for (const a of anchors) {
      const href = $(a).attr("href");
      if (!href) continue;

      const u = new URL(href, base);
      const id = u.searchParams.get("id");
      if (!id) continue;

      const fullUrl = u.toString();

      const externalId = id || slugExternalIdFromUrl(fullUrl);
      if (seen.has(externalId)) continue;
      seen.add(externalId);

      const $a = $(a);

      // encontrar un contenedor “card” que incluya el bloque de texto (Tipo de propiedad / Ubicación / etc.)
      let card = $a.closest("article, .item, li, .card, div");
      let cur = $a;
      for (let i = 0; i < 10; i++) {
        const p = cur.parent();
        if (!p.length) break;
        const txt = p.text() || "";
        if (
          txt.includes("Tipo de propiedad:") ||
          /Ubicación:/i.test(txt) ||
          /Dormitorios:/i.test(txt)
        ) {
          card = p;
          break;
        }
        cur = p;
      }
      if (!card || !card.length) card = $a.parent();

      const cardText = card.text().replace(/\s+/g, " ").trim();

      const title =
        card.find("h3,h2,h1").first().text().trim() ||
        $a.text().replace(/\s+/g, " ").trim() ||
        `Propiedad ${externalId}`;

      const rawType = cardText.match(/Tipo de propiedad:\s*([A-Za-zÁÉÍÓÚÑáéíóúñ ]+)/i)?.[1]?.trim() || "";

      const { currency, price } = parsePrice(cardText);

      let imageUrl = bestImgFromCard($, card, base) || null;
      if (!imageUrl && detailFetched < detailLimit) {
        imageUrl = (await bestImgFromDetail(fullUrl, base)) || null;
        detailFetched++;
        await sleep(120);
      }

      out.push({
        externalId,
        url: fullUrl,
        title,
        type: normalizeType(rawType),
        price,
        currency,
        neighborhood: null,
        operation: mode, // "venta" | "alquiler"
        raw: { source: "caramagna", page, t, cardText },
        imageUrl,
      });

      added++;
    }

    if (added === 0) break;
    await sleep(delayMs);
  }

  // dedupe global
  const map = new Map();
  for (const it of out) map.set(it.externalId, it);
  return [...map.values()];
}

/** ---------------------------
 *  SCRAPER 6: Casa Propia (Pixel) - Venta / Alquiler / Temporario
 *  -------------------------- */
async function scrapeCasaPropia({ purpose, maxPages = 15, delayMs = 300 }) {
  const out = [];
  const base = "https://casapropiaventas.com.ar";
  const userId = "1526";

  let detailFetched = 0;
  const detailLimit = 250;

  for (let page = 1; page <= maxPages; page++) {
    const url = `${base}/listing?purpose=${purpose}&user_id=${userId}&page=${page}`;
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);

    const anchors = $("a[href*='/ad/']").toArray();
    let added = 0;

    for (const a of anchors) {
      const href = $(a).attr("href");
      if (!href) continue;

      const fullUrl = new URL(href, base).toString();
      const $a = $(a);

      // Card que realmente incluya la imagen
      let card = $a.closest("article, li, .item, .property, .card, div");
      if (!card.length) card = $a.parent();

      // subir por padres hasta encontrar uno con <img> (igual que JC)
      let cur = $a;
      for (let i = 0; i < 12; i++) {
        const p = cur.parent();
        if (!p.length) break;
        if (p.find("img").length) { card = p; break; }
        cur = p;
      }

      const cardText = card.text().replace(/\s+/g, " ").trim();

      // Código (Pixel lo muestra como "Código: 197644")
      const code = cardText.match(/c[oó]digo:\s*(\d+)/i)?.[1] ?? null;

      const title =
        card.find("img").first().attr("alt")?.trim() ||
        card.find("h1,h2,h3,h4,h5").first().text().trim() ||
        $a.attr("title")?.trim() ||
        $a.text().replace(/\s+/g, " ").trim() ||
        `Propiedad ${code ?? slugExternalIdFromUrl(fullUrl)}`;

      // Tipo por heurística (Pixel pone "Casa", "Departamento", etc. en el card)
      const candidates = ["Casa", "Departamento", "Depto", "Terreno", "Lote", "Dúplex", "Duplex", "Quinta", "Monoambiente", "Local", "Cochera", "Galpón", "Galpon", "Casa con Local", "Campo"];
      let rawType = "";
      for (const c of candidates) {
        if (cardText.toLowerCase().includes(c.toLowerCase())) { rawType = c; break; }
      }

      const { currency, price } = parsePrice(cardText);
      const operation = inferOperation(`${title} ${cardText}`, purpose); // sale/rent/temporary_rent

      let imageUrl = bestImgFromCard($, card, base) || null;
      if (!imageUrl && detailFetched < detailLimit) {
        imageUrl = (await bestImgFromDetail(fullUrl, base)) || null;
        detailFetched++;
        await sleep(80);
      }

      out.push({
        externalId: code ?? slugExternalIdFromUrl(fullUrl),
        url: fullUrl,
        title,
        type: normalizeType(rawType),
        price,
        currency,
        neighborhood: null,
        operation,
        raw: { source: "casapropia", purpose, cardText },
        imageUrl,
      });

      added++;
    }

    if (added === 0) break;
    await sleep(delayMs);
  }

  const map = new Map();
  for (const it of out) map.set(it.externalId, it);
  return [...map.values()];
}

/** ---------------------------
 *  SCRAPER 7: La Tène Inmobiliaria (Venta + Alquileres)
 *  -------------------------- */
async function scrapeLaTene({ mode, maxPages = 15, delayMs = 300 }) {
  const out = [];
  const base = "https://lateneinmobiliaria.com.ar";
  const listPath = mode === "venta" ? "venta" : "alquileres";

  let detailFetched = 0;
  const detailLimit = 200;

  function extractIdFromUrl(u) {
    const m = String(u).match(/\/(\d+)-/);
    return m?.[1] || slugExternalIdFromUrl(u);
  }

  function pickTypeFromText(txt) {
    const t = (txt || "").toLowerCase();
    if (t.includes("departamento") || t.includes("depto")) return "Departamento";
    if (t.includes("monoambiente")) return "Monoambiente";
    if (t.includes("casa quinta") || t.includes("quinta")) return "Quinta";
    if (t.includes("casa")) return "Casa";
    if (t.includes("terreno") || t.includes("lote")) return "Terreno";
    if (t.includes("local")) return "Local";
    if (t.includes("galp")) return "Galpón";
    if (t.includes("cochera")) return "Cochera";
    if (t.includes("campo")) return "Campo";
    return "";
  }

  for (let page = 1; page <= maxPages; page++) {
    const url =
      page === 1 ? `${base}/${listPath}` : `${base}/${listPath}/page/${page}`;

    const html = await fetchHtml(url);
    const $ = cheerio.load(html);

    // Links a fichas: tienen formato /7953-depto-... (id-numero al inicio)
    const links = $("a[href]")
      .filter((i, el) => {
        const href = $(el).attr("href") || "";
        const u = href.startsWith("http") ? href : new URL(href, base).toString();
        return /^https?:\/\/lateneinmobiliaria\.com\.ar\/\d{3,}-/i.test(u);
      })
      .toArray();

    let added = 0;
    const seen = new Set();

    for (const el of links) {
      const $a = $(el);
      const href = $a.attr("href");
      if (!href) continue;

      const fullUrl = new URL(href, base).toString();
      const externalId = extractIdFromUrl(fullUrl);
      if (seen.has(externalId)) continue;
      seen.add(externalId);

      // Card: buscamos un contenedor razonable (para texto e img)
      let card = $a.closest("article, .post, li, .item, .property, .card, div");
      if (!card.length) card = $a.parent();

      // Texto del card
      const cardText = (card.text() || $a.text()).replace(/\s+/g, " ").trim();

      // Título
      const title =
        card.find("h1,h2,h3,h4").first().text().trim() ||
        $a.text().replace(/\s+/g, " ").trim() ||
        `Propiedad ${externalId}`;

      // Tipo / Precio / Img
      const rawType = pickTypeFromText(cardText);
      const { currency, price } = parsePrice(cardText);

      let imageUrl = bestImgFromCard($, card, base) || null;
      if (!imageUrl && detailFetched < detailLimit) {
        imageUrl = (await bestImgFromDetail(fullUrl, base)) || null;
        detailFetched++;
        await sleep(80);
      }

      out.push({
        externalId,
        url: fullUrl,
        title,
        type: normalizeType(rawType),
        price,
        currency,
        neighborhood: null,
        operation: mode, // "venta" | "alquiler"
        raw: { source: "latene", page, cardText },
        imageUrl,
      });

      added++;
    }

    if (added === 0) break;
    await sleep(delayMs);
  }

  // dedupe final
  const map = new Map();
  for (const it of out) map.set(it.externalId, it);
  return [...map.values()];
}

/** ---------------------------
 *  SCRAPER 8: Tacuaras Inmobiliaria (Venta + Alquiler)
 *  -------------------------- */
async function scrapeTacuaras({ mode, delayMs = 250 }) {
  const out = [];
  const base = "https://tacuaras-inmobiliaria.com.ar";
  const listUrl = mode === "venta" ? `${base}/buy.php` : `${base}/rent.php`;

  const html = await fetchHtml(listUrl);
  const $ = cheerio.load(html);

  // links a fichas: propiedades-detalles.php?idprop=123
  const anchors = $("a[href*='propiedades-detalles.php']")
    .filter((_, el) => /[?&]idprop=\d+/i.test($(el).attr("href") || ""))
    .toArray();

  const seen = new Set();

  for (const el of anchors) {
    const href = $(el).attr("href");
    if (!href) continue;

    const u = new URL(href, base);
    const idprop = u.searchParams.get("idprop");
    if (!idprop) continue;
    if (seen.has(idprop)) continue;
    seen.add(idprop);

    const url = u.toString();

    // ── leer detalle (ahí están precio, tipo e imágenes)
    const dhtml = await fetchHtml(url);
    const $d = cheerio.load(dhtml);

    const title =
      $d("h1").first().text().trim() ||
      $d("title").text().trim() ||
      `Propiedad ${idprop}`;

    const detailText = $d("body").text().replace(/\s+/g, " ").trim();

    const rawType =
      detailText.match(/TIPO\s+([A-Za-zÁÉÍÓÚÑáéíóúñ ]+)/i)?.[1]?.trim() || "";

    let { currency, price } = parsePrice(detailText);

    // "Consultar" / "Por Privado" (si querés evitar $0, dejalo en null)
    if (/consultar|por privado/i.test(detailText)) {
      price = null;
      currency = null;
    }

    // Imagen: primera imagen válida del detalle (son /admin/images/propiedades/...)
    let imageUrl = null;
    $d("img").each((_, img) => {
      if (imageUrl) return;
      const src =
        $d(img).attr("data-src") ||
        $d(img).attr("data-lazy-src") ||
        $d(img).attr("src");

      const abs = toAbsoluteUrl(src, base);
      if (abs && !isBadImageUrl(abs)) imageUrl = abs;
    });

    out.push({
      externalId: idprop,
      url,
      title,
      type: normalizeType(rawType),
      price,
      currency,
      neighborhood: null,
      operation: mode, // "venta" | "alquiler"
      raw: { source: "tacuaras", listUrl, detailText: detailText.slice(0, 300) },
      imageUrl,
    });

    await sleep(delayMs);
  }

  return out;
}

/** ---------------------------
 *  SCRAPER 9: Pablo Sciortino (Venta/Alquiler)
 *  -------------------------- */
async function scrapePabloSciortino({ mode, maxPages = 5, delayMs = 300 }) {
  const out = [];
  const base = "https://pablosciortino.com.ar";

  let detailFetched = 0;
  const detailLimit = 200;

  function pickTypeFromText(txt) {
    const t = String(txt || "").toLowerCase();
    if (t.includes("departamento")) return "Departamento";
    if (t.includes("duplex") || t.includes("dúplex")) return "Duplex";
    if (t.includes("quinta")) return "Casa Quinta";
    if (t.includes("terreno") || t.includes("lote")) return "Terreno";
    if (t.includes("galpon") || t.includes("galpón")) return "Galpón";
    if (t.includes("local")) return "Local";
    if (t.includes("oficina")) return "Oficina";
    if (t.includes("deposito") || t.includes("depósito")) return "Depósito";
    if (t.includes("consultorio")) return "Consultorio";
    if (t.includes("campo")) return "Campo";
    if (t.includes("casa")) return "Casa";
    return "";
  }

  const seen = new Set();

  for (let page = 1; page <= maxPages; page++) {
    const listUrl =
      page === 1
        ? `${base}/status/${mode}/`
        : `${base}/status/${mode}/page/${page}/`;

    let html;
try {
  html = await fetchHtml(listUrl);
} catch (e) {
  // si no existe la página, cortamos la paginación
  break;
}

    const $ = cheerio.load(html);

    // En este WP hay anchors de imagen SIN TEXTO. Preferimos links con texto (títulos o “Detalles”).
    const anchors = $(
      "h1 a[href*='/property/'], h2 a[href*='/property/'], h3 a[href*='/property/'], a[href*='/property/']"
    ).toArray();

    let added = 0;

    for (const a of anchors) {
      const $a = $(a);
      const href = $a.attr("href");
      if (!href) continue;

      const fullUrl = new URL(href, base).toString();
      if (!fullUrl.includes("/property/")) continue;

      const externalId = slugExternalIdFromUrl(fullUrl);
      if (seen.has(externalId)) continue;

      const linkText = ($a.text() || "").replace(/\s+/g, " ").trim();
      // Saltear anchors de imagen (texto vacío)
      if (!linkText) continue;

      // Card: subir hasta encontrar un contenedor que incluya imagen + info
      let card = $a.closest("article");
      if (!card.length) card = $a.closest("li, .item, .property, div");

      let cur = $a;
      for (let i = 0; i < 12; i++) {
        const p = cur.parent();
        if (!p.length) break;
        if (p.find("img").length) {
          card = p;
          break;
        }
        cur = p;
      }

      const cardText = card.text().replace(/\s+/g, " ").trim();

      const title =
        card.find("h1,h2,h3").first().text().replace(/\s+/g, " ").trim() ||
        linkText ||
        `Propiedad ${externalId}`;

      const rawType =
        cardText.match(
          /\b(Departamento|Casa|Terreno|Quinta|Duplex|Galp[oó]n(?:es)?|Local(?:es)?|Oficina(?:s)?|Campo(?:s)?|Dep[oó]sito(?:s)?|Consultorio(?:s)?|Fondo de comercio)\b/i
        )?.[1] || pickTypeFromText(cardText);

      const { currency, price } = parsePrice(`${title} ${cardText}`);

      let imageUrl = bestImgFromCard($, card, base) || null;
      if (!imageUrl && detailFetched < detailLimit) {
        imageUrl = (await bestImgFromDetail(fullUrl, base)) || null;
        detailFetched++;
        await sleep(120);
      }

      out.push({
        externalId,
        url: fullUrl,
        title,
        type: normalizeType(rawType),
        price, // <- parsePrice ya devuelve 0 si no hay
        currency,
        neighborhood: null,
        operation: mode, // "venta" | "alquiler"
        raw: { source: "pablosciortino", page, listUrl },
        imageUrl,
      });

      seen.add(externalId);
      added++;
    }

    if (added === 0) break;
    await sleep(delayMs);
  }

  return out;
}

/** ---------------------------
 *  SCRAPER 10: OmbuInmobiliaria
 *  -------------------------- */
async function scrapeOmbuInmobiliaria({ purpose, maxPages = 10, delayMs = 300 }) {
  const out = [];
  const base = "https://www.ombuinmobiliaria.com";
  const userId = "198";

  // si el listado no trae img en el card, hacemos fallback al detalle
  let detailFetched = 0;
  const detailLimit = 250;

  for (let page = 1; page <= maxPages; page++) {
    const url = `${base}/listing?purpose=${purpose}&user_id=${userId}&page=${page}`;
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);

    const anchors = $("a[href*='/ad/']").toArray();
    let added = 0;

    for (const a of anchors) {
      const href = $(a).attr("href");
      if (!href) continue;

      const fullUrl = new URL(href, base).toString();
      const $a = $(a);

      // ✅ encontrar un contenedor que realmente incluya la imagen
      let card = $a.closest("article, li, .item, .property, .card");
      if (!card.length) card = $a.parent();

      // subimos por padres hasta encontrar uno con <img>
      let cur = $a;
      for (let i = 0; i < 12; i++) {
        const p = cur.parent();
        if (!p.length) break;
        if (p.find("img").length) { card = p; break; }
        cur = p;
      }

      const cardText = card.text().replace(/\s+/g, " ").trim();

      // Código suele venir como "Código: 3511"
      const code = cardText.match(/c[oó]digo:\s*(\d+)/i)?.[1] ?? null;

      // Título: alt de img es confiable en JC
      const title =
        card.find("img").first().attr("alt")?.trim() ||
        card.find("h1,h2,h3,h4,h5").first().text().trim() ||
        $a.attr("title")?.trim() ||
        $a.text().replace(/\s+/g, " ").trim() ||
        `Propiedad ${code ?? slugExternalIdFromUrl(fullUrl)}`;

      const candidates = ["Casa", "Departamento", "Depto", "Terreno", "Lote", "Dúplex", "Duplex", "Quinta", "Monoambiente", "Local", "Cochera", "Galpón", "Galpon"];
      let rawType = "";
      for (const c of candidates) {
        if (cardText.toLowerCase().includes(c.toLowerCase())) { rawType = c; break; }
      }

      const { currency, price } = parsePrice(cardText);
      const operation = inferOperation(cardText, purpose);

      // ✅ Imagen
      let imageUrl = bestImgFromCard($, card, base) || null;
      if (!imageUrl && detailFetched < detailLimit) {
        imageUrl = (await bestImgFromDetail(fullUrl, base)) || null;
        detailFetched++;
        await sleep(80);
      }

      out.push({
        externalId: code ?? slugExternalIdFromUrl(fullUrl),
        url: fullUrl,
        title,
        type: normalizeType(rawType),
        price,
        currency,
        neighborhood: null,
        operation,
        raw: { source: "jcbustamante", purpose, cardText },
        imageUrl,
      });

      added++;
    }

    if (added === 0) break;
    await sleep(delayMs);
  }

  const map = new Map();
  for (const it of out) map.set(it.externalId, it);
  return [...map.values()];
}

/** ---------------------------
 *  SCRAPER 11 : Torres y Guida (Habitat) - Venta / Alquiler
 *  -------------------------- */
async function scrapeTorresYGuida({ mode, maxPages = 10, delayMs = 300 }) {
  const out = [];
  const base = "https://torresyguida.com";

  function isDetailUrl(u) {
    // queremos /property/<slug>/ pero no /property/?... ni taxonomías
    if (!u.includes("/property/")) return false;
    if (u.includes("/property-type/")) return false;
    if (u.includes("/property-city/")) return false;
    if (u.includes("/property-label/")) return false;
    if (u.includes("/property-status/")) return false;
    if (u.includes("/agent/")) return false;
    if (u.includes("/property/?")) return false;
    return true;
  }

  function pickTypeFromText(txt) {
    const t = (txt || "").toLowerCase();
    if (t.includes("monoambiente")) return "Monoambiente";
    if (t.includes("departamento") || t.includes("depto")) return "Departamento";
    if (t.includes("duplex") || t.includes("dúplex")) return "Duplex";
    if (t.includes("casa")) return "Casa";
    if (t.includes("terreno") || t.includes("lote")) return "Terreno";
    if (t.includes("local")) return "Local";
    if (t.includes("oficina")) return "Oficina";
    if (t.includes("galp")) return "Galpón";
    return "";
  }

  const seen = new Set();

  for (let page = 1; page <= maxPages; page++) {
    // WP suele paginar con /page/N/
    const listUrl =
      page === 1
        ? `${base}/property/?status=${mode}`
        : `${base}/property/page/${page}/?status=${mode}`;

    let html;
    try {
      html = await fetchHtml(listUrl);
    } catch (e) {
      // si devuelve 404/5xx, cortamos paginación para no romper el sync
      break;
    }

    const $ = cheerio.load(html);

    const anchors = $("a[href*='/property/']")
      .filter((i, el) => {
        const href = $(el).attr("href") || "";
        const u = href.startsWith("http") ? href : new URL(href, base).toString();
        return isDetailUrl(u);
      })
      .toArray();

    let added = 0;

    for (const el of anchors) {
      const $a = $(el);
      const href = $a.attr("href");
      if (!href) continue;

      const fullUrl = new URL(href, base).toString();
      if (!isDetailUrl(fullUrl)) continue;

      const externalId = slugExternalIdFromUrl(fullUrl);
      if (seen.has(externalId)) continue;
      seen.add(externalId);

      // Card: subir hasta un contenedor con imagen o info
      let card = $a.closest("article, .property, .item, li, .card, div");
      if (!card.length) card = $a.parent();

      let cur = $a;
      for (let i = 0; i < 12; i++) {
        const p = cur.parent();
        if (!p.length) break;
        if (p.find("img").length) { card = p; break; }
        cur = p;
      }

      const cardText = (card.text() || $a.text()).replace(/\s+/g, " ").trim();

      const title =
        card.find("h1,h2,h3,h4").first().text().replace(/\s+/g, " ").trim() ||
        $a.text().replace(/\s+/g, " ").trim() ||
        `Propiedad ${externalId}`;

      const rawType = pickTypeFromText(`${title} ${cardText}`);
      const { currency, price } = parsePrice(`${title} ${cardText}`);

      let imageUrl = bestImgFromCard($, card, base) || null;
      // (opcional) fallback al detalle si querés, pero probemos primero sin detalle
      // imageUrl = toAbsoluteUrl(imageUrl, base);

      out.push({
        externalId,
        url: fullUrl,
        title,
        type: normalizeType(rawType),
        price,
        currency,
        neighborhood: null,
        operation: mode, // "venta" | "alquiler"
        raw: { source: "torresyguida", page, listUrl },
        imageUrl,
      });

      added++;
    }

    if (added === 0) break;
    await sleep(delayMs);
  }

  return out;
}

///////////////

/** ---------------------------
 *  SCRAPER 13: Inmobiliaria G. Ghisi
 *  -------------------------- */
async function scrapeGhisi({ purpose, maxPages = 10, delayMs = 300 }) {
  const out = [];
  const base = "https://www.inmobiliariagghisi.com.ar";
  const userId = "287";

  let detailFetched = 0;
  const detailLimit = 250;

  for (let page = 1; page <= maxPages; page++) {
    const url = `${base}/listing?purpose=${purpose}&user_id=${userId}&page=${page}`;
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);

    const anchors = $("a[href*='/ad/']").toArray(); // igual que JC
    let added = 0;

    for (const a of anchors) {
      const href = $(a).attr("href");
      if (!href) continue;

      const fullUrl = new URL(href, base).toString();
      const $a = $(a);

      let card = $a.closest("article, li, .item, .property, .card");
      if (!card.length) card = $a.parent();

      let cur = $a;
      for (let i = 0; i < 12; i++) {
        const p = cur.parent();
        if (!p.length) break;
        if (p.find("img").length) { card = p; break; }
        cur = p;
      }

      const cardText = card.text().replace(/\s+/g, " ").trim();

      const code = cardText.match(/c[oó]digo:\s*(\d+)/i)?.[1] ?? null;

      const title =
        card.find("img").first().attr("alt")?.trim() ||
        card.find("h1,h2,h3,h4,h5").first().text().trim() ||
        $a.attr("title")?.trim() ||
        $a.text().replace(/\s+/g, " ").trim() ||
        `Propiedad ${code ?? slugExternalIdFromUrl(fullUrl)}`;

      const candidates = ["Casa","Departamento","Depto","Terreno","Lote","Dúplex","Duplex","Quinta","Monoambiente","Local","Cochera","Galpón","Galpon"];
      let rawType = "";
      for (const c of candidates) {
        if (cardText.toLowerCase().includes(c.toLowerCase())) { rawType = c; break; }
      }

      const { currency, price } = parsePrice(cardText);
      const operation = inferOperation(cardText, purpose);

      let imageUrl = bestImgFromCard($, card, base) || null;
      if (!imageUrl && detailFetched < detailLimit) {
        imageUrl = (await bestImgFromDetail(fullUrl, base)) || null;
        detailFetched++;
        await sleep(80);
      }

      out.push({
        externalId: code ?? slugExternalIdFromUrl(fullUrl),
        url: fullUrl,
        title,
        type: normalizeType(rawType),
        price: price ?? 0,
        currency,
        neighborhood: null,
        operation,
        raw: { source: "ghisi", purpose, page, listUrl: url },
        imageUrl,
      });

      added++;
    }

    if (added === 0) break;
    await sleep(delayMs);
  }

  const map = new Map();
  for (const it of out) map.set(it.externalId, it);
  return [...map.values()];
}

/** ---------------------------
 *  SCRAPER X: Benvenuto y Zanni (Amaira) - Venta / Alquiler
 *  -------------------------- */
async function scrapeBenvenutoYZanni({ mode, maxPages = 15, delayMs = 300 }) {
  const out = [];
  const inm = "BZN"; // por "ficha-bzn###"
  const listBase = "https://ficha.amaira.com.ar/propiedades_gen.php";

  const ope = mode === "venta" ? "V" : "A"; // Venta / Alquiler

  // fallback al detalle para imagen (el listado a veces no trae img)
  let detailFetched = 0;
  const detailLimit = 250;

  const seen = new Set();

  function extractId(urlOrText) {
    const s = String(urlOrText || "");
    // ...ficha-bzn328  ó ...?ficha=BZN328  ó texto "... BZN328"
    return (
      s.match(/ficha-([a-z]{3}\d+)/i)?.[1]?.toUpperCase() ||
      s.match(/[?&]ficha=([a-z]{3}\d+)/i)?.[1]?.toUpperCase() ||
      s.match(/\b([A-Z]{3}\d+)\b/)?.[1]?.toUpperCase() ||
      slugExternalIdFromUrl(s)
    );
  }

  function pickTypeFromText(txt) {
    const t = (txt || "").toLowerCase();
    if (t.includes("monoamb")) return "Monoambiente";
    if (t.includes("depart")) return "Departamento";
    if (t.includes("duplex") || t.includes("dúplex")) return "Duplex";
    if (t.includes("oficina")) return "Oficina";
    if (t.includes("local")) return "Local";
    if (t.includes("galp")) return "Galpón";
    if (t.includes("terreno") || t.includes("lote")) return "Terreno";
    if (t.includes("casa")) return "Casa";
    return "";
  }

  for (let page = 1; page <= maxPages; page++) {
    const listUrl = `${listBase}?a=All&a1=All&inm=${inm}&loc=All&ope=${ope}&p=${page}&tipo=All`;

    let html;
    try {
      html = await fetchHtml(listUrl);
    } catch {
      break;
    }

    const $ = cheerio.load(html);

    // Este listado trae "Ver propiedad" apuntando al dominio de la inmobiliaria
    const links = $("a[href*='benvenutoyzanni.com.ar/']").toArray();

    let added = 0;

    for (const el of links) {
      const $a = $(el);
      const href = $a.attr("href");
      if (!href) continue;

      const fullUrl = href.startsWith("http") ? href : `https://${href.replace(/^\/+/, "")}`;

      // evitá agarrar links a secciones del sitio si aparecieran
      if (!/ficha-/i.test(fullUrl) && !/[?&]ficha=/i.test(fullUrl)) continue;

      const externalId = extractId(fullUrl);
      if (seen.has(externalId)) continue;
      seen.add(externalId);

      // card = subimos hasta algo “tipo item”
      let card = $a.closest("li, article, .item, .card, div");
      if (!card.length) card = $a.parent();

      const cardText = (card.text() || $a.text()).replace(/\s+/g, " ").trim();

      // Título: intenta armar algo decente con la línea “Tipo en venta/alquiler” + ubicación
      const title =
        card.find("h1,h2,h3,h4").first().text().replace(/\s+/g, " ").trim() ||
        cardText.split("Ver propiedad")[0]?.trim() ||
        `Propiedad ${externalId}`;

      const rawType = pickTypeFromText(`${title} ${cardText}`);
      const { currency, price } = parsePrice(`${title} ${cardText}`);

      let imageUrl = bestImgFromCard($, card, "https://benvenutoyzanni.com.ar") || null;
      if (!imageUrl && detailFetched < detailLimit) {
        imageUrl = (await bestImgFromDetail(fullUrl, "https://benvenutoyzanni.com.ar")) || null;
        detailFetched++;
        await sleep(80);
      }

      out.push({
        externalId,
        url: fullUrl,
        title,
        type: normalizeType(rawType),
        price: price ?? 0,        // <- IMPORTANTE: nunca null (Prisma)
        currency,
        neighborhood: null,
        operation: mode,          // "venta" | "alquiler"
        raw: { source: "benvenutoyzanni", page, listUrl, cardText },
        imageUrl,
      });

      added++;
    }

    if (added === 0) break;
    await sleep(delayMs);
  }

  return out;
}


/** ---------------------------
 *  UPSERT EN DB
 *  -------------------------- */
async function upsertAll(source, items) {
  const src = await prisma.source.upsert({
    where: { id: source.id },
    update: { name: source.name, baseUrl: source.baseUrl, isActive: true },
    create: { id: source.id, name: source.name, baseUrl: source.baseUrl, isActive: true },
  });

  let ok = 0;
  const now = new Date();

  for (const it of items) {
    if (!it.externalId || !it.url) continue;

  const normalizedImageUrl = toAbsoluteUrl(it.imageUrl, source.baseUrl);
  


    try {
  await prisma.property.upsert({
    where: { sourceId_externalId: { sourceId: src.id, externalId: it.externalId } },
    update: {
      url: it.url,
      title: it.title,
      type: it.type,
      price: (typeof it.price === "number" ? it.price : 0),
      currency: it.currency === "USD" || it.currency === "ARS" ? it.currency : "ARS",
      neighborhood: it.neighborhood ?? null,
      operation: it.operation ?? null,
      isActive: true,
      lastSeenAt: now,
      raw: it.raw ?? null,
      imageUrl: normalizedImageUrl,
    },
    create: {
      source: { connect: { id: src.id } },
      externalId: it.externalId,
      url: it.url,
      title: it.title,
      type: it.type,
      price: it.price ?? 0,
      currency: it.currency === "USD" || it.currency === "ARS" ? it.currency : "ARS",
      neighborhood: it.neighborhood ?? null,
      operation: it.operation ?? null,
      isActive: true,
      lastSeenAt: now,
      raw: it.raw ?? null,
      imageUrl: normalizedImageUrl,
    },
  });

  ok++;
} catch (e) {
  console.warn(`⚠️ Upsert falló (${source.id} / ${it.externalId}):`, e?.message || e);
  // seguimos con el siguiente item
}

  }

  console.log(`✅ ${source.name}: upsert ${ok} props`);
}

async function main() {
  console.log("🔄 Sync start...");

  // 1) JC Bustamante (venta + alquiler)
  const jcVenta = await scrapeJcBustamante({ purpose: "sale", maxPages: 15 });
  const jcAlq = await scrapeJcBustamante({ purpose: "rent", maxPages: 15 });
  await upsertAll(
    { id: "jcbustamante", name: "JC Bustamante", baseUrl: "https://jcbustamantepropiedades.com.ar" },
    [...jcVenta, ...jcAlq]
  );

  

  // 2) Florencio (venta + alquiler)
  const fbVenta = await scrapeFlorencio({ typeParam: "venta", maxPages: 15 });
  const fbAlq = await scrapeFlorencio({ typeParam: "alquiler", maxPages: 15 });
  await upsertAll(
    { id: "florencio", name: "Florencio Bogado", baseUrl: "https://www.florenciobogado.com.ar" },
    [...fbVenta, ...fbAlq]
  );

  // 3) Mega (por categorías)
  const megaTypes = ["casas", "departamentos", "terrenos"];
  const megaAll = [];
  for (const slug of megaTypes) {
    const items = await scrapeMega({ categorySlug: slug, maxPages: 15 });
    megaAll.push(...items);
  }
  await upsertAll(
    { id: "mega", name: "Mega Inmobiliaria", baseUrl: "https://inmobiliariamega.com.ar" },
    megaAll
  );

  // 12) Eduardo Rodríguez (venta + alquiler)
const erVenta = await scrapeEduardoRodriguez({ metaParam: "Venta", maxPages: 40, detailConcurrency: 8 });
const erAlq   = await scrapeEduardoRodriguez({ metaParam: "Alquiler", maxPages: 25, detailConcurrency: 8 });

await upsertAll(
  { id: "eduardorodriguez", name: "Eduardo Rodríguez Inmobiliaria", baseUrl: "https://eduardorodriguezinmobiliaria.com" },
  [...erVenta, ...erAlq]
);


  // 4) León Inmobiliaria (ventas)
  const leonVenta = await scrapeLeonInmobiliaria({ maxPages: 15 });
  await upsertAll(
    { id: "leon", name: "León Inmobiliaria", baseUrl: "https://www.leoninmobiliaria.com.ar" },
    leonVenta
  );

    // 5) Caramagna (venta + alquiler)
  const carVenta = await scrapeCaramagna({ mode: "venta", maxPages: 15, t: 0 });
  const carAlq = await scrapeCaramagna({ mode: "alquiler", maxPages: 15, t: 0 });

  await upsertAll(
    { id: "caramagna", name: "Caramagna Inmobiliaria", baseUrl: "https://www.caramagnainmobiliaria.com" },
    [...carVenta, ...carAlq]
  );

    // 6) Casa Propia (venta + alquiler + temporario)
  const cpVenta = await scrapeCasaPropia({ purpose: "sale", maxPages: 15 });
  const cpAlq = await scrapeCasaPropia({ purpose: "rent", maxPages: 15 });
  const cpTemp = await scrapeCasaPropia({ purpose: "temporary_rent", maxPages: 15 });

  await upsertAll(
    { id: "casapropia", name: "Casa Propia", baseUrl: "https://casapropiaventas.com.ar" },
    [...cpVenta, ...cpAlq, ...cpTemp]
  );

  // 7) La Tène (venta + alquiler)
  const lateneVenta = await scrapeLaTene({ mode: "venta", maxPages: 15 });
  const lateneAlq = await scrapeLaTene({ mode: "alquiler", maxPages: 15 });

  await upsertAll(
    { id: "latene", name: "La Tène Inmobiliaria", baseUrl: "https://lateneinmobiliaria.com.ar" },
    [...lateneVenta, ...lateneAlq]
  );

    //8) Tacuaras (venta + alquiler)
  const tacVenta = await scrapeTacuaras({ mode: "venta" });
  const tacAlq = await scrapeTacuaras({ mode: "alquiler" });

  await upsertAll(
    { id: "tacuaras", name: "Tacuaras Inmobiliaria", baseUrl: "https://tacuaras-inmobiliaria.com.ar" },
    [...tacVenta, ...tacAlq]
  );

// 9) Pablo Sciortino (venta + alquiler)
const psVenta = await scrapePabloSciortino({ mode: "venta", maxPages: 5 });
const psAlq = await scrapePabloSciortino({ mode: "alquiler", maxPages: 5 });

await upsertAll(
  { id: "pablosciortino", name: "Pablo Sciortino", baseUrl: "https://pablosciortino.com.ar" },
  [...psVenta, ...psAlq]
);

// 10) Ombú Inmobiliaria (venta + alquiler)
const ombuVenta = await scrapeOmbuInmobiliaria({ purpose: "sale", maxPages: 15 });
const ombuAlq = await scrapeOmbuInmobiliaria({ purpose: "rent", maxPages: 15 });

await upsertAll(
  { id: "ombu", name: "Ombú Inmobiliaria", baseUrl: "https://www.ombuinmobiliaria.com" },
  [...ombuVenta, ...ombuAlq]
);

// 11) Torres y Guida (Habitat) - venta + alquiler
const tygVenta = await scrapeTorresYGuida({ mode: "venta", maxPages: 10 });
const tygAlq = await scrapeTorresYGuida({ mode: "alquiler", maxPages: 10 });

await upsertAll(
  { id: "torresyguida", name: "Torres y Guida (Habitat)", baseUrl: "https://torresyguida.com" },
  [...tygVenta, ...tygAlq]
);

/////////////////////////

// 13) "Inmobiliaria G. Ghisi" (venta + alquiler)
const ghisiVenta = await scrapeGhisi({ purpose: "sale" });
const ghisiAlq   = await scrapeGhisi({ purpose: "rent" });

await upsertAll(
  { id: "ghisi", name: "Inmobiliaria G. Ghisi", baseUrl: "https://www.inmobiliariagghisi.com.ar" },
  [...ghisiVenta, ...ghisiAlq]
);

// 13) Benvenuto y Zanni (Amaira) - Venta / Alquiler
const byzVenta = await scrapeBenvenutoYZanni({ mode: "venta", maxPages: 15 });
const byzAlq = await scrapeBenvenutoYZanni({ mode: "alquiler", maxPages: 15 });

await upsertAll(
  { id: "benvenutoyzanni", name: "Benvenuto y Zanni", baseUrl: "https://benvenutoyzanni.com.ar" },
  [...byzVenta, ...byzAlq]
);


  console.log("✅ Sync done.");
}

main()
  .catch((e) => {
    console.error("❌ Sync error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
