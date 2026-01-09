"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";



type PropertyItem = {
  id: string;
  title: string;
  type: string;
  price: number;
  currency: string;
  neighborhood?: string | null;
  address?: string | null;
  url: string;
  operation?: "venta" | "alquiler" | null;
  source: { name: string };
  imageUrl?: string | null;
};

type ApiResponse = {
  items: PropertyItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

type TypeFilter =
  | "all"
  | "casa"
  | "depto"
  | "monoambiente"
  | "duplex"
  | "terreno"
  | "cochera"
  | "local"
  | "galpon"
  | "oficina"
  | "otros";

type OperationFilter = "all" | "venta" | "alquiler";
type CurrencyFilter = "all" | "USD" | "ARS";
type SortFilter = "new" | "price_asc" | "price_desc";
type TypeKey = Exclude<TypeFilter, "all">;





function formatMoney(currency: string, value: number) {
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString("es-AR")}`;
  }
}

function prettyType(t: string) {
  const map: Record<string, string> = {
    casa: "Casa",
    depto: "Depto",
    terreno: "Terreno",
    monoambiente: "Monoambiente",
    duplex: "Dúplex",
    cochera: "Cochera",
    local: "Local",
    galpon: "Galpón",
    oficina: "Oficina",
    otros: "Otros",
  };
  return map[t] ?? t;
}

function badgeStyle(kind: "dark" | "soft"): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 12,
    border: kind === "dark" ? "1px solid rgba(255,255,255,0.14)" : "1px solid rgba(0,0,0,0.10)",
    background: kind === "dark" ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.04)",
    color: kind === "dark" ? "rgba(255,255,255,0.92)" : "rgba(0,0,0,0.75)",
    whiteSpace: "nowrap",
  };
}

function chip(active: boolean): CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: 999,
    border: active ? "1px solid rgba(0,0,0,0.9)" : "1px solid rgba(0,0,0,0.12)",
    background: active ? "rgba(0,0,0,0.92)" : "rgba(255,255,255,0.9)",
    color: active ? "white" : "rgba(0,0,0,0.85)",
    cursor: "pointer",
    fontWeight: 600,
    fontSize: 13,
  };
}

function inputStyle(): CSSProperties {
  return {
    width: "100%",
    padding: "12px 12px",
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.12)",
    outline: "none",
    background: "rgba(255,255,255,0.9)",
  };
}

function selectStyle(): CSSProperties {
  return {
    width: "100%",
    padding: "12px 12px",
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.12)",
    outline: "none",
    background: "rgba(255,255,255,0.9)",
    appearance: "none",
  };
}

function TopFilterBar(props: {
  qDraft: string;
  setQDraft: (v: string) => void;

  opDraft: OperationFilter;
  setOpDraft: (v: OperationFilter) => void;

  typesDraft: TypeKey[];
  setTypesDraft: React.Dispatch<React.SetStateAction<TypeKey[]>>;

  currencyDraft: CurrencyFilter;
  setCurrencyDraft: (v: CurrencyFilter) => void;

  minDraft: number;
  setMinDraft: (v: number) => void;
  maxDraft: number;
  setMaxDraft: (v: number) => void;

  sortDraft: SortFilter;
  setSortDraft: (v: SortFilter) => void;

  viewMode: "grid" | "list";
  setViewMode: (v: "grid" | "list") => void;

  typeOptions: Array<{ key: TypeFilter; label: string }>;

  apply: (next?: Partial<{ q: string; types: TypeKey[]; operation: OperationFilter; currency: CurrencyFilter; sort: SortFilter; min: number; max: number }>) => void;
  clearAll: () => void;
}) {
  type MenuKey = null | "op" | "prop" | "amb" | "price" | "more";
  const [openMenu, setOpenMenu] = useState<MenuKey>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDown(e: PointerEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpenMenu(null);
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  return (
    <div className="topBarWrap">
      <div className="topBarInner" ref={ref}>
        <div className="topBarRow">
          <button
  type="button"
  className="brand"
  onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
  title="Inicio"
>
  <span className="brandMark" aria-hidden="true">CP</span>
  <span className="brandText">
    <span className="brandName">Comparador Paraná</span>
    <span className="brandTag">venta / alquiler • múltiples inmobiliarias</span>
  </span>
</button>

          <div className="searchWrap">
            <input
              className="searchInput"
              value={props.qDraft}
              onChange={(e) => props.setQDraft(e.target.value)}
              placeholder="Ingresá ciudades o barrios"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  props.apply();
                  setOpenMenu(null);
                }
              }}
            />
            <span className="searchIcon">🔎</span>
          </div>

          <div className="ddWrap">
            <button type="button" className="filterBtn" onClick={() => setOpenMenu(openMenu === "op" ? null : "op")}>
              {props.opDraft === "venta" ? "Comprar" : props.opDraft === "alquiler" ? "Alquilar" : "Operación"}
              <span className="chev">▾</span>
            </button>

            {openMenu === "op" && (
              <div className="popover">
                <div className="popTitle">Tipo de operación</div>

                <label className="optRow">
                  <input type="radio" checked={props.opDraft === "alquiler"} onChange={() => props.setOpDraft("alquiler")} />
                  <span>Alquilar</span>
                </label>
                <label className="optRow">
                  <input type="radio" checked={props.opDraft === "venta"} onChange={() => props.setOpDraft("venta")} />
                  <span>Comprar</span>
                </label>
                <label className="optRow">
                  <input type="radio" checked={props.opDraft === "all"} onChange={() => props.setOpDraft("all")} />
                  <span>Todas</span>
                </label>

                <div className="popFooter">
                  <button type="button" className="btnGhost" onClick={() => props.clearAll()}>
                    Limpiar
                  </button>
                  <button
                    type="button"
                    className="btnPrimary"
                    onClick={() => {
                      props.apply({ operation: props.opDraft });
                      setOpenMenu(null);
                    }}
                  >
                    Ver resultados
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="ddWrap">
            <button type="button" className="filterBtn" onClick={() => setOpenMenu(openMenu === "prop" ? null : "prop")}>
              {props.typesDraft.length === 0
                ? "Propiedad"
                : props.typesDraft.length === 1
                  ? prettyType(props.typesDraft[0])
                  : `${prettyType(props.typesDraft[0])} +${props.typesDraft.length - 1}`}
              <span className="chev">▾</span>
            </button>

            {openMenu === "prop" && (
              <div className="popover">
                <div className="popTitle">Tipo de propiedad</div>

                <div className="scrollList">
                  {props.typeOptions
                    .filter((o) => o.key !== "all")
                    .map((o) => {
                      const key = o.key as TypeKey;
                      const checked = props.typesDraft.includes(key);
                      return (
                        <label key={o.key} className="optRow">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              props.setTypesDraft((prev) => (prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]));
                            }}
                          />
                          <span>{o.label}</span>
                        </label>
                      );
                    })}
                </div>

                <div className="popFooter">
                  <button
                    type="button"
                    className="btnGhost"
                    onClick={() => {
                      props.setTypesDraft([]);
                      props.apply({ types: [] });
                      setOpenMenu(null);
                    }}
                  >
                    Limpiar
                  </button>
                  <button
                    type="button"
                    className="btnPrimary"
                    onClick={() => {
                      props.apply({ types: props.typesDraft });
                      setOpenMenu(null);
                    }}
                  >
                    Ver resultados
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="ddWrap">
            <button type="button" className="filterBtn" onClick={() => setOpenMenu(openMenu === "price" ? null : "price")}>
              Precio <span className="chev">▾</span>
            </button>

            {openMenu === "price" && (
              <div className="popover">
                <div className="popTitle">Precio</div>

                <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
                  <label className="optRow" style={{ gap: 8 }}>
                    <input type="radio" checked={props.currencyDraft === "ARS"} onChange={() => props.setCurrencyDraft("ARS")} />
                    <span>Pesos</span>
                  </label>
                  <label className="optRow" style={{ gap: 8 }}>
                    <input type="radio" checked={props.currencyDraft === "USD"} onChange={() => props.setCurrencyDraft("USD")} />
                    <span>USD</span>
                  </label>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
                  <input className="miniInput" placeholder="Desde" type="number" value={props.minDraft || ""} onChange={(e) => props.setMinDraft(Number(e.target.value || 0))} />
                  <input className="miniInput" placeholder="Hasta" type="number" value={props.maxDraft || ""} onChange={(e) => props.setMaxDraft(Number(e.target.value || 0))} />
                </div>

                <div className="popFooter">
                  <button
                    type="button"
                    className="btnGhost"
                    onClick={() => {
                      props.setCurrencyDraft("all");
                      props.setMinDraft(0);
                      props.setMaxDraft(0);
                      props.apply({ currency: "all", min: 0, max: 0 });
                      setOpenMenu(null);
                    }}
                  >
                    Limpiar
                  </button>
                  <button
                    type="button"
                    className="btnPrimary"
                    onClick={() => {
                      props.apply({ currency: props.currencyDraft, min: props.minDraft, max: props.maxDraft });
                      setOpenMenu(null);
                    }}
                  >
                    Ver resultados
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="ddWrap">
            <button type="button" className="filterBtn" onClick={() => setOpenMenu(openMenu === "more" ? null : "more")}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span style={{ opacity: 0.75 }}>⛭</span> Más filtros
              </span>
            </button>

            {openMenu === "more" && (
              <div className="popover">
                <div className="popTitle">Más filtros</div>

                <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6, marginTop: 10 }}>Orden</div>
                <select className="miniInput" value={props.sortDraft} onChange={(e) => props.setSortDraft(e.target.value as SortFilter)}>
                  <option value="new">Más nuevos</option>
                  <option value="price_desc">Precio Alto a Bajo</option>
                  <option value="price_asc">Precio Bajo a Alto</option>
                </select>

                <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6, marginTop: 10 }}>Vista</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" className={props.viewMode === "grid" ? "pillActive" : "pill"} onClick={() => props.setViewMode("grid")}>
                    Grilla
                  </button>
                  <button type="button" className={props.viewMode === "list" ? "pillActive" : "pill"} onClick={() => props.setViewMode("list")}>
                    Lista
                  </button>
                </div>

                <div className="popFooter">
                  <button
                    type="button"
                    className="btnGhost"
                    onClick={() => {
                      props.setSortDraft("new");
                      props.apply({ sort: "new" });
                      setOpenMenu(null);
                    }}
                  >
                    Limpiar
                  </button>
                  <button
                    type="button"
                    className="btnPrimary"
                    onClick={() => {
                      props.apply({ sort: props.sortDraft });
                      setOpenMenu(null);
                    }}
                  >
                    Ver resultados
                  </button>
                </div>
              </div>
            )}
          </div>

          <button type="button" className="alertBtn" onClick={() => alert("Próximamente: crear alerta")}>
            Crear alerta
          </button>
        </div>
      </div>
    </div>
  );
}


export default function Page() {
  
  
  // Draft UI
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [qDraft, setQDraft] = useState("");
  const [typesDraft, setTypesDraft] = useState<TypeKey[]>([]);
  const [opDraft, setOpDraft] = useState<OperationFilter>("all");
  const [currencyDraft, setCurrencyDraft] = useState<CurrencyFilter>("all");
  const [sortDraft, setSortDraft] = useState<SortFilter>("new");
  const [minDraft, setMinDraft] = useState(0);
  const [maxDraft, setMaxDraft] = useState(0);

  // Applied API
  const [q, setQ] = useState("");
  const [types, setTypes] = useState<TypeKey[]>([]);
  const [operation, setOperation] = useState<OperationFilter>("all");
  const [currency, setCurrency] = useState<CurrencyFilter>("all");
  const [sort, setSort] = useState<SortFilter>("new");
  const [minPrice, setMinPrice] = useState(0);
  const [maxPrice, setMaxPrice] = useState(0);

  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

// Adaptador: mantiene compatibilidad con el código viejo (type/typeDraft)
const typeDraft: TypeFilter = (typesDraft[0] ?? "all") as TypeFilter;
const setTypeDraft = (v: TypeFilter) => setTypesDraft(v === "all" ? [] : [v as TypeKey]);

const type: TypeFilter = (types[0] ?? "all") as TypeFilter;
const setType = (v: TypeFilter) => setTypes(v === "all" ? [] : [v as TypeKey]);


  function apply(
  next?: Partial<{
    q: string;
    types: TypeKey[];
    operation: OperationFilter;
    currency: CurrencyFilter;
    sort: SortFilter;
    min: number;
    max: number;
  }>
) {
  const qNext = next?.q ?? qDraft;
  const typesNext = next?.types ?? typesDraft;
  const opNext = next?.operation ?? opDraft;
  const curNext = next?.currency ?? currencyDraft;
  const sortNext = next?.sort ?? sortDraft;
  const minNext = next?.min ?? minDraft;
  const maxNext = next?.max ?? maxDraft;

  setPage(1);
  setQ(qNext);
  setTypes(typesNext);
  setOperation(opNext);
  setCurrency(curNext);
  setSort(sortNext);
  setMinPrice(minNext);
  setMaxPrice(maxNext);
}


  // Debounce para texto + precios
  useEffect(() => {
    const id = setTimeout(() => apply(), 350);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qDraft, minDraft, maxDraft]);

  const queryString = useMemo(() => {
    const sp = new URLSearchParams();

    if (q.trim()) sp.set("q", q.trim());
    if (types.length) sp.set("type", types.join(","));
    if (operation !== "all") sp.set("operation", operation);
    if (currency !== "all") sp.set("currency", currency);
    if (minPrice) sp.set("minPrice", String(minPrice));
    if (maxPrice) sp.set("maxPrice", String(maxPrice));
    if (sort !== "new") sp.set("sort", sort);

    sp.set("page", String(page));
    sp.set("pageSize", String(pageSize));
    return sp.toString();
  }, [q, type, operation, currency, minPrice, maxPrice, sort, page]);

  useEffect(() => {
    const controller = new AbortController();

    async function run() {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch(`/api/properties?${queryString}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as ApiResponse;
        setData(json);
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        setErr(e?.message ?? "Error");
        setData(null);
      } finally {
        setLoading(false);
      }
    }

    run();
    return () => controller.abort();
  }, [queryString]);

  function clearAll() {
  setQDraft("");
  setTypesDraft([]);
  setOpDraft("all");
  setCurrencyDraft("all");
  setSortDraft("new");
  setMinDraft(0);
  setMaxDraft(0);
  apply({ q: "", types: [], operation: "all", currency: "all", sort: "new", min: 0, max: 0 });
}


const pageWindow = useMemo(() => {
  if (!data) return [];
  const total = data.totalPages;
  const cur = data.page;

  const size = 3; // siempre 3 botones
  let start = cur;
  let end = Math.min(total, start + size - 1);

  // si estás cerca del final, corré la ventana para mantener 3
  start = Math.max(1, end - size + 1);

  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}, [data]);



  const typeOptions: Array<{ key: TypeFilter; label: string }> = [
    { key: "all", label: "Todos" },
    { key: "casa", label: "Casas" },
    { key: "depto", label: "Departamentos" },
    { key: "monoambiente", label: "Monoambientes" },
    { key: "duplex", label: "Dúplex" },
    { key: "terreno", label: "Terrenos / Lotes" },
    { key: "cochera", label: "Cocheras" },
    { key: "local", label: "Locales" },
    { key: "galpon", label: "Galpones" },
    { key: "oficina", label: "Oficinas" },
    { key: "otros", label: "Otros" },
  ];

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(1200px 600px at 20% 0%, rgba(0,0,0,0.06), transparent 60%), radial-gradient(1000px 500px at 90% 10%, rgba(0,0,0,0.05), transparent 55%), #fafafa",
          
      }}
      
    >
      
      {/* Content */}
      <div style={{ maxWidth: 1520, margin: "0 auto", padding: "22px 16px 44px" }}>

        <div style={{ display: "grid", gap: 16 }}>


          {/* Top filter bar (estilo portal) */}
<TopFilterBar
  qDraft={qDraft}
  setQDraft={setQDraft}
  opDraft={opDraft}
  setOpDraft={setOpDraft}
  typesDraft={typesDraft}
  setTypesDraft={setTypesDraft}
  currencyDraft={currencyDraft}
  setCurrencyDraft={setCurrencyDraft}
  minDraft={minDraft}
  setMinDraft={setMinDraft}
  maxDraft={maxDraft}
  setMaxDraft={setMaxDraft}
  sortDraft={sortDraft}
  setSortDraft={setSortDraft}
  viewMode={viewMode}
  setViewMode={setViewMode}
  typeOptions={typeOptions}
  apply={apply}
  clearAll={clearAll}
/>


                


          {/* Results */}
          <div>
            <div
              style={{
                border: "1px solid rgba(0,0,0,0.10)",
                borderRadius: 16,
                background: "rgba(255,255,255,0.9)",
                boxShadow: "0 10px 30px rgba(0,0,0,0.05)",
                padding: 14,
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <div style={{ fontSize: 16, fontWeight: 900 }}>Resultados</div>
                <div style={{ fontSize: 13, opacity: 0.7 }}>{loading ? "Cargando…" : data ? `${data.total} encontrados` : "—"}</div>

                <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <span style={badgeStyle("soft")}>Operación: {operation === "all" ? "todas" : operation}</span>
                  <span style={badgeStyle("soft")}>Tipo: {type === "all" ? "todos" : prettyType(type)}</span>
                  {currency !== "all" && <span style={badgeStyle("soft")}>Moneda: {currency}</span>}
                </div>
              </div>

              {/* Toolbar arriba del grid */}
<div
  style={{
    marginTop: 12,
    padding: 12,
    borderRadius: 14,
    border: "1px solid rgba(0,0,0,0.08)",
    background: "rgba(255,255,255,0.95)",
    display: "flex",
    alignItems: "center",
    gap: 12,
  }}
>
  {/* Orden */}
  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 260 }}>
    <select
      value={sortDraft}
      onChange={(e) => {
        const v = e.target.value as SortFilter;
        setSortDraft(v);
        apply({ sort: v });
      }}
      style={{
        width: "100%",
        padding: "12px 12px",
        borderRadius: 12,
        border: "1px solid rgba(0,0,0,0.12)",
        outline: "none",
        background: "white",
        appearance: "none",
        fontWeight: 600,
      }}
    >
      <option value="price_desc">Precio Alto a Bajo</option>
      <option value="price_asc">Precio Bajo a Alto</option>
      <option value="new">Más recientes</option>
    </select>
  </div>

  <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
    {/* Vista lista */}
    <button
      type="button"
      onClick={() => setViewMode("list")}
      style={{
        width: 40,
        height: 40,
        borderRadius: 12,
        border: viewMode === "list" ? "1px solid rgba(0,0,0,0.9)" : "1px solid rgba(0,0,0,0.12)",
        background: viewMode === "list" ? "rgba(0,0,0,0.92)" : "white",
        color: viewMode === "list" ? "white" : "rgba(0,0,0,0.8)",
        cursor: "pointer",
        fontSize: 18,
        fontWeight: 800,
      }}
      title="Vista lista"
    >
      ≡
    </button>

    {/* Vista grilla */}
    <button
      type="button"
      onClick={() => setViewMode("grid")}
      style={{
        width: 40,
        height: 40,
        borderRadius: 12,
        border: viewMode === "grid" ? "1px solid rgba(0,0,0,0.9)" : "1px solid rgba(0,0,0,0.12)",
        background: viewMode === "grid" ? "rgba(0,0,0,0.92)" : "white",
        color: viewMode === "grid" ? "white" : "rgba(0,0,0,0.8)",
        cursor: "pointer",
        fontSize: 18,
        fontWeight: 800,
      }}
      title="Vista grilla"
    >
      ▦
    </button>
  </div>
</div>


              {err && (
                <div style={{ marginTop: 10, padding: 12, borderRadius: 12, background: "rgba(220,38,38,0.08)", color: "rgb(185,28,28)" }}>
                  {err}
                </div>
              )}

              <div className="cardsGrid" style={{ display: "grid", gap: 16, marginTop: 16 }}>

              
                {loading &&
                  Array.from({ length: 6 }).map((_, i) => (
                    <div
                      key={i}
                      style={{
                        height: 88,
                        borderRadius: 14,
                        border: "1px solid rgba(0,0,0,0.08)",
                        background: "linear-gradient(90deg, rgba(0,0,0,0.04), rgba(0,0,0,0.02), rgba(0,0,0,0.04))",
                      }}
                    />
                  ))}

                {!loading && data?.items?.map((p) =>viewMode === "grid" ? (
      // ✅ GRID CARD
      <a
        key={p.id}
        href={p.url}
        target="_blank"
        rel="noreferrer"
        className="propCard propCardGrid"
        style={{
          textDecoration: "none",
          color: "inherit",
          borderRadius: 18,
          border: "1px solid rgba(0,0,0,0.10)",
          background: "white",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          minHeight: 320,
          boxShadow: "0 8px 22px rgba(0,0,0,0.05)",
        }}
      >
        <div style={{ position: "relative" }}>
          {p.imageUrl ? (
            <img
              src={p.imageUrl}
              alt={p.title}
              loading="lazy"
              className="propImg"
              style={{
                width: "100%",
                height: 200,
                objectFit: "cover",
                display: "block",
                background: "rgba(0,0,0,0.06)",
              }}
            />
          ) : (
            <div style={{ width: "100%", height: 200, background: "rgba(0,0,0,0.06)" }} />
          )}

          <div style={{ position: "absolute", top: 10, left: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {p.operation && <span style={badgeStyle("dark")}>{p.operation}</span>}
          </div>
        </div>

        <div style={{ padding: 14, display: "grid", gap: 8, flex: 1 }}>
          <div style={{ fontWeight: 900, fontSize: 15, lineHeight: 1.2 }}>{p.title}</div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span style={{ ...badgeStyle("soft"), fontWeight: 800 }}>
    🏢    {p.source?.name ?? "—"}
          </span>
        </div>


          <div style={{ opacity: 0.72, fontSize: 13 }}>
            {p.neighborhood ?? "—"} {p.address ? `· ${p.address}` : ""}
          </div>

          <div style={{ marginTop: "auto", fontWeight: 900, fontSize: 17, color: "rgb(22,163,74)" }}>
            {formatMoney(p.currency, p.price)}
          </div>
        </div>
      </a>
    ) : (
      // ✅ LIST CARD
      <a
        key={p.id}
        href={p.url}
        target="_blank"
        rel="noreferrer"
        className="propCard propCardList"
        style={{
          textDecoration: "none",
          color: "inherit",
          borderRadius: 16,
          border: "1px solid rgba(0,0,0,0.10)",
          background: "white",
          overflow: "hidden",
          display: "grid",
          gridTemplateColumns: "120px 1fr auto",
          gap: 12,
          padding: 12,
          alignItems: "center",
        }}
      >
        {p.imageUrl ? (
          <img
           className="propImg"
            src={p.imageUrl}
            alt={p.title}
            loading="lazy"
            style={{ width: 120, height: 86, objectFit: "cover", borderRadius: 12, background: "rgba(0,0,0,0.06)" }}
          />
        ) : (
          <div style={{ width: 120, height: 86, borderRadius: 12, background: "rgba(0,0,0,0.06)" }} />
        )}

        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ fontWeight: 900, fontSize: 15, lineHeight: 1.2 }}>{p.title}</div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
  {p.operation && <span style={badgeStyle("soft")}>{p.operation}</span>}
  <span style={{ ...badgeStyle("soft"), fontWeight: 800 }}>
    🏢 {p.source?.name ?? "—"}
  </span>
</div>
            

          <div style={{ opacity: 0.7, fontSize: 13 }}>
            {p.neighborhood ?? "—"} {p.address ? `· ${p.address}` : ""}
          </div>
        </div>

        <div style={{ fontWeight: 900, fontSize: 16, color: "rgb(22,163,74)", whiteSpace: "nowrap" }}>
          {formatMoney(p.currency, p.price)}
        </div>
      </a>
    )
  )}



                

              </div>
            {!loading && data && data.totalPages > 1 && (
  <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14 }}>
    <button
      disabled={data.page <= 1}
      onClick={() => setPage((x) => Math.max(1, x - 1))}
      style={{
        padding: "10px 12px",
        borderRadius: 12,
        border: "1px solid rgba(0,0,0,0.12)",
        background: "white",
        cursor: "pointer",
        opacity: data.page <= 1 ? 0.5 : 1,
        fontWeight: 800,
        whiteSpace: "nowrap",
      }}
    >
      ← Anterior
    </button>

    <div style={{ flex: 1, display: "flex", justifyContent: "center", gap: 8, alignItems: "center" }}>
      {pageWindow.map((pNum) => {
        const active = pNum === data.page;
        return (
          <button
            key={pNum}
            onClick={() => setPage(pNum)}
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              border: active ? "1px solid rgba(0,0,0,0.9)" : "1px solid rgba(0,0,0,0.12)",
              background: active ? "rgba(0,0,0,0.92)" : "white",
              color: active ? "white" : "rgba(0,0,0,0.85)",
              cursor: "pointer",
              fontWeight: 900,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              lineHeight: 1,
              boxSizing: "border-box",
              flex: "0 0 auto",
            }}
          >
            {pNum}
          </button>
        );
      })}
    </div>

    <button
      disabled={data.page >= data.totalPages}
      onClick={() => setPage((x) => Math.min(data.totalPages, x + 1))}
      style={{
        padding: "10px 12px",
        borderRadius: 12,
        border: "1px solid rgba(0,0,0,0.12)",
        background: "white",
        cursor: "pointer",
        opacity: data.page >= data.totalPages ? 0.5 : 1,
        fontWeight: 800,
        whiteSpace: "nowrap",
      }}
    >
      Siguiente →
    </button>
  </div>
)}

              
            </div>

            
              
            
          </div>
        </div>

        {/* Responsive: en pantallas chicas apila */}
        <style>{`
  /* Cards grid columns */
  .cardsGrid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  @media (max-width: 1400px) {
    .cardsGrid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  }

  @media (max-width: 1100px) {
    .cardsGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }

  @media (max-width: 720px) {
    .cardsGrid { grid-template-columns: 1fr; }
  }

  /* Filters grid */
  .filtersGrid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  @media (max-width: 1100px) {
    .filtersGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }

  @media (max-width: 720px) {
    .filtersGrid { grid-template-columns: 1fr; }
    .filtersGrid > div[style*="grid-column: span 2"] {
      grid-column: span 1 !important;
    }
  }

  /* Hover animations */
  .propCard {
    transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease;
    will-change: transform;
  }

  .propCard:hover {
    transform: translateY(-6px);
    box-shadow: 0 16px 38px rgba(0,0,0,0.10);
    border-color: rgba(0,0,0,0.18);
  }

  .propCard:active {
    transform: translateY(-2px) scale(0.99);
  }

  .propCard:focus-visible {
    outline: 3px solid rgba(59, 130, 246, 0.35);
    outline-offset: 2px;
  }

  .propImg {
    transition: transform 220ms ease;
    transform-origin: center;
  }

  .propCardGrid:hover .propImg { transform: scale(1.04); }
  .propCardList:hover .propImg { transform: scale(1.03); }

  @media (prefers-reduced-motion: reduce) {
    .propCard, .propImg { transition: none !important; }
  }

  @media (hover: none) {
    .propCard:hover { transform: none; }
    .propCardGrid:hover .propImg,
    .propCardList:hover .propImg { transform: none; }
  }
/* Top filter bar */
.topBarWrap{
  position: sticky;
  top: 0;
  z-index: 60;
  background: rgba(250,250,250,0.85);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(0,0,0,0.08);
}

.topBarInner{
  max-width: 1520px;
  margin: 0 auto;
  padding: 12px 16px;
}

.topBarRow{
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.searchWrap{
  position: relative;
  flex: 1 1 320px;
  min-width: 260px;
}

.searchInput{
  width: 100%;
  height: 44px;
  padding: 0 40px 0 14px;
  border-radius: 12px;
  border: 1px solid rgba(0,0,0,0.16);
  background: white;
  font-weight: 650;
  outline: none;
}

.searchInput:focus{
  border-color: rgba(0,0,0,0.28);
  box-shadow: 0 10px 22px rgba(0,0,0,0.06);
}

.searchIcon{
  position: absolute;
  right: 12px;
  top: 12px;
  opacity: 0.55;
  pointer-events: none;
}

.ddWrap{ position: relative; }

.filterBtn{
  height: 44px;
  padding: 0 12px;
  border-radius: 12px;
  border: 1px solid rgba(0,0,0,0.16);
  background: white;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-weight: 800;
  white-space: nowrap;
}

.filterBtn:hover{
  border-color: rgba(0,0,0,0.28);
  box-shadow: 0 10px 22px rgba(0,0,0,0.06);
}

.chev{ opacity: 0.6; }

.popover{
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  width: 340px;
  max-width: 92vw;
  background: white;
  border: 1px solid rgba(0,0,0,0.12);
  border-radius: 14px;
  box-shadow: 0 18px 45px rgba(0,0,0,0.12);
  padding: 12px;
  z-index: 80;
}

.popTitle{
  font-weight: 900;
  font-size: 13px;
  opacity: 0.9;
}

.scrollList{
  margin-top: 10px;
  max-height: 240px;
  overflow: auto;
  padding-right: 4px;
}

.optRow{
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 8px;
  border-radius: 12px;
  cursor: pointer;
}

.optRow:hover{ background: rgba(0,0,0,0.04); }

.popFooter{
  display: flex;
  justify-content: space-between;
  gap: 10px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid rgba(0,0,0,0.08);
}

.btnGhost{
  height: 40px;
  padding: 0 12px;
  border-radius: 12px;
  border: 1px solid rgba(0,0,0,0.12);
  background: white;
  cursor: pointer;
  font-weight: 800;
}

.btnPrimary{
  height: 40px;
  padding: 0 14px;
  border-radius: 12px;
  border: 1px solid rgba(0,0,0,0.92);
  background: rgba(0,0,0,0.92);
  color: white;
  cursor: pointer;
  font-weight: 900;
}

.miniInput{
  width: 100%;
  height: 40px;
  border-radius: 12px;
  border: 1px solid rgba(0,0,0,0.16);
  padding: 0 12px;
  background: white;
  font-weight: 700;
}

.pill, .pillActive{
  height: 36px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid rgba(0,0,0,0.14);
  background: white;
  cursor: pointer;
  font-weight: 800;
}

.pillActive{
  border-color: rgba(0,0,0,0.92);
  background: rgba(0,0,0,0.92);
  color: white;
}

.alertBtn{
  height: 44px;
  padding: 0 14px;
  border-radius: 12px;
  border: 1px solid rgba(255,90,0,0.65);
  background: white;
  cursor: pointer;
  font-weight: 900;
  white-space: nowrap;
}
  /* App background */
.appShell{
  min-height: 100vh;
  background:
    radial-gradient(1000px 520px at 18% -8%, rgba(255,90,0,0.12), transparent 60%),
    radial-gradient(900px 560px at 88% 8%, rgba(0,0,0,0.08), transparent 55%),
    linear-gradient(180deg, #fbfbfc 0%, #f6f6f8 45%, #f9f9fb 100%);
}

/* Marca / logo */
.brand{
  display: inline-flex;
  align-items: center;
  gap: 10px;
  height: 44px;
  padding: 0 10px 0 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  border-radius: 12px;
}

.brand:hover{
  background: rgba(0,0,0,0.04);
}

.brandMark{
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 950;
  letter-spacing: -0.02em;
  color: rgba(0,0,0,0.88);
  background:
    radial-gradient(18px 18px at 30% 30%, rgba(255,90,0,0.25), transparent 60%),
    rgba(0,0,0,0.06);
  border: 1px solid rgba(0,0,0,0.10);
}

.brandText{
  display: inline-flex;
  flex-direction: column;
  line-height: 1.05;
  text-align: left;
}

.brandName{
  font-weight: 950;
  font-size: 13px;
  letter-spacing: -0.01em;
  color: rgba(0,0,0,0.9);
}

.brandTag{
  font-weight: 700;
  font-size: 11px;
  opacity: 0.65;
  margin-top: 2px;
}

/* Responsive: en mobile ocultamos el tagline para que no rompa */
@media (max-width: 720px){
  .brandTag{ display:none; }
  .brandName{ font-size: 12px; }
}


`}</style>


      </div>
    </div>
  );
}
