"use client";

import { useEffect, useMemo, useState } from "react";

type PropertyItem = {
  id: string;
  title: string;
  type: string;
  price: number;
  currency: string;
  neighborhood?: string | null;
  url: string;
  operation?: "venta" | "alquiler" | null;
  source: { name: string };
};

type ApiResponse = {
  items: PropertyItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

type TypeFilter = "all" | "casa" | "depto" | "terreno";
type OperationFilter = "all" | "venta" | "alquiler";

function inferTypeFromText(text: string): TypeFilter | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;

  if (["casa", "casas"].includes(t)) return "casa";
  if (["depto", "deptos", "depto.", "departamento", "departamentos"].includes(t)) return "depto";
  if (["terreno", "terrenos", "lote", "lotes"].includes(t)) return "terreno";
  return null;
}

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

function chipStyle(active: boolean): React.CSSProperties {
  return {
    padding: "8px 12px",
    borderRadius: 999,
    border: "1px solid #ddd",
    background: active ? "#111" : "#fff",
    color: active ? "#fff" : "#111",
    cursor: "pointer",
  };
}

export function HomeClient() {
  // DRAFT (UI)
  const [qDraft, setQDraft] = useState("");
  const [typeDraft, setTypeDraft] = useState<TypeFilter>("all");
  const [opDraft, setOpDraft] = useState<OperationFilter>("all");
  const [minDraft, setMinDraft] = useState(0);
  const [maxDraft, setMaxDraft] = useState(0);

  // APPLIED (lo que consulta la API)
  const [qApplied, setQApplied] = useState("");
  const [typeApplied, setTypeApplied] = useState<TypeFilter>("all");
  const [opApplied, setOpApplied] = useState<OperationFilter>("all");
  const [minApplied, setMinApplied] = useState(0);
  const [maxApplied, setMaxApplied] = useState(0);

  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function applyFilters(
    next?: Partial<{
      q: string;
      type: TypeFilter;
      op: OperationFilter;
      min: number;
      max: number;
    }>
  ) {
    const qNext = next?.q ?? qDraft;
    const typeNext = next?.type ?? typeDraft;
    const opNext = next?.op ?? opDraft;
    const minNext = next?.min ?? minDraft;
    const maxNext = next?.max ?? maxDraft;

    setPage(1);
    setQApplied(qNext);
    setTypeApplied(typeNext);
    setOpApplied(opNext);
    setMinApplied(minNext);
    setMaxApplied(maxNext);
  }

  // ✅ Auto-aplicar al escribir / precio (debounce)
  useEffect(() => {
    const id = setTimeout(() => {
      const inferred = inferTypeFromText(qDraft);

      if (inferred) {
        setTypeDraft(inferred);
        setQDraft("");
        applyFilters({ q: "", type: inferred });
        return;
      }

      applyFilters();
    }, 350);

    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qDraft, minDraft, maxDraft]);

  const queryString = useMemo(() => {
    const sp = new URLSearchParams();

    if (qApplied.trim()) sp.set("q", qApplied.trim());
    if (typeApplied !== "all") sp.set("type", typeApplied);
    if (opApplied !== "all") sp.set("operation", opApplied);
    if (minApplied) sp.set("minPrice", String(minApplied));
    if (maxApplied) sp.set("maxPrice", String(maxApplied));

    sp.set("page", String(page));
    sp.set("pageSize", String(pageSize));
    return sp.toString();
  }, [qApplied, typeApplied, opApplied, minApplied, maxApplied, page]);

  // ✅ Fetch SIEMPRE que cambie queryString
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

  // ✅ Chips instantáneos
  function onTypeClick(t: TypeFilter) {
    const inferredFromQ = inferTypeFromText(qDraft);
    const qNext = inferredFromQ ? "" : qDraft;

    if (inferredFromQ) setQDraft("");
    setTypeDraft(t);
    applyFilters({ type: t, q: qNext });
  }

  function onOperationClick(op: OperationFilter) {
    setOpDraft(op);
    applyFilters({ op });
  }

  function onLimpiar() {
    setQDraft("");
    setTypeDraft("all");
    setOpDraft("all");
    setMinDraft(0);
    setMaxDraft(0);

    applyFilters({ q: "", type: "all", op: "all", min: 0, max: 0 });
  }

  return (
    <div style={{ maxWidth: 980, margin: "40px auto", padding: 16, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>Comparador de propiedades en Paraná</h1>
      <p style={{ marginTop: 0, opacity: 0.7 }}>Filtrá por operación, tipo y precio. Todo automático.</p>

      <div style={{ display: "grid", gap: 12, padding: 16, border: "1px solid #e5e5e5", borderRadius: 12 }}>
        <input
          placeholder='Ej: "Centro" o escribí "casa"'
          value={qDraft}
          onChange={(e) => setQDraft(e.target.value)}
          style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
        />

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 13, opacity: 0.7, marginRight: 6 }}>Operación</span>
          {(
            [
              { key: "all", label: "Todas" },
              { key: "venta", label: "Venta" },
              { key: "alquiler", label: "Alquiler" },
            ] as const
          ).map(({ key, label }) => (
            <button key={key} type="button" onClick={() => onOperationClick(key)} style={chipStyle(opDraft === key)}>
              {label}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 13, opacity: 0.7, marginRight: 6 }}>Tipo</span>
          {(
            [
              { key: "all", label: "Todos" },
              { key: "casa", label: "Casa" },
              { key: "depto", label: "Depto" },
              { key: "terreno", label: "Terreno" },
            ] as const
          ).map(({ key, label }) => (
            <button key={key} type="button" onClick={() => onTypeClick(key)} style={chipStyle(typeDraft === key)}>
              {label}
            </button>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <input
            type="number"
            placeholder="Precio mínimo"
            value={minDraft || ""}
            onChange={(e) => setMinDraft(Number(e.target.value || 0))}
            style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
          />
          <input
            type="number"
            placeholder="Precio máximo"
            value={maxDraft || ""}
            onChange={(e) => setMaxDraft(Number(e.target.value || 0))}
            style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
          />
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={onLimpiar}
            style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #ddd", background: "#fff" }}
          >
            Limpiar
          </button>

          <div style={{ marginLeft: "auto", fontSize: 13, opacity: 0.7, display: "flex", alignItems: "center" }}>
            {opApplied !== "all" ? `Operación: ${opApplied}` : "Operación: todas"} ·{" "}
            {typeApplied !== "all" ? `Tipo: ${typeApplied}` : "Tipo: todos"}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        {loading && <p>Cargando…</p>}
        {err && <p style={{ color: "crimson" }}>{err}</p>}

        {!loading && data && (
          <>
            <h2 style={{ marginBottom: 8 }}>Resultados ({data.total})</h2>

            <div style={{ display: "grid", gap: 10 }}>
              {data.items.map((p) => (
                <a
                  key={p.id}
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: "block",
                    padding: 12,
                    border: "1px solid #e5e5e5",
                    borderRadius: 12,
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <div style={{ fontWeight: 700 }}>{p.title}</div>

                    {p.operation && (
                      <span
                        style={{
                          fontSize: 12,
                          padding: "2px 8px",
                          borderRadius: 999,
                          border: "1px solid #ddd",
                          opacity: 0.85,
                        }}
                      >
                        {p.operation}
                      </span>
                    )}

                    <span
                      style={{
                        fontSize: 12,
                        padding: "2px 8px",
                        borderRadius: 999,
                        border: "1px solid #ddd",
                        opacity: 0.85,
                      }}
                    >
                      {p.type}
                    </span>
                  </div>

                  <div style={{ opacity: 0.75, marginTop: 4 }}>
                    {formatMoney(p.currency, p.price)} · {p.neighborhood ?? "—"} · Fuente: {p.source.name}
                  </div>
                </a>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 16 }}>
              <button
                disabled={data.page <= 1}
                onClick={() => setPage((x) => Math.max(1, x - 1))}
                style={{
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: "1px solid #ddd",
                  background: "#fff",
                  cursor: "pointer",
                  opacity: data.page <= 1 ? 0.5 : 1,
                }}
              >
                Anterior
              </button>

              <span style={{ opacity: 0.75 }}>
                Página {data.page} / {data.totalPages}
              </span>

              <button
                disabled={data.page >= data.totalPages}
                onClick={() => setPage((x) => x + 1)}
                style={{
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: "1px solid #ddd",
                  background: "#fff",
                  cursor: "pointer",
                  opacity: data.page >= data.totalPages ? 0.5 : 1,
                }}
              >
                Siguiente
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
