// app/page.tsx
"use client";

import db from "@/data/foxhole-logi-db.json";
import React, { useEffect, useMemo, useState } from "react";

type Row = Record<string, any>;
type Mode = "units" | "crates";

type Conversions = {
  componentsPerRmat: number;
  sulfurPerEmat: number;
  salvagePerBmat: number;
};

type Capacities = {
  component: { hauler: number; atlas: number; flatbed: number };
  salvage: { hauler: number; atlas: number; flatbed: number };
  sulfur: { hauler: number; atlas: number; flatbed: number };
  coal: { hauler: number; atlas: number; flatbed: number };
  petrol: { hauler: number; atlas: number; flatbed: number };
  heavyOil: { hauler: number; atlas: number; flatbed: number };
  rareMetal: { hauler: number; atlas: number; flatbed: number };
};

type Totals = {
  SalvagePerUnit: number;
  CoalPerUnit: number;
  ComponentPerUnit: number;
  SulfurPerUnit: number;
  PetrolPerUnit: number;
  HeavyOilPerUnit: number;
  RareMetalPerUnit: number;
};

const RAW_KEYS: (keyof Totals)[] = [
  "SalvagePerUnit",
  "CoalPerUnit",
  "ComponentPerUnit",
  "SulfurPerUnit",
  "PetrolPerUnit",
  "HeavyOilPerUnit",
  "RareMetalPerUnit",
];

// FOXHOLE COLONIAL THEME (dark + colonial green)
const T = {
  bg: "#0b1610",
  panel: "#0f2017",
  panel2: "#10251a",
  border: "#1f3a2b",
  border2: "#254233",
  text: "#e7f3ea",
  muted: "#a9c0b0",
  accent: "#46c26e", // colonial green pop
  accent2: "#2aa85a",
  warn: "#d9b45b",
  danger: "#e06c6c",
  chipBg: "#132a1e",
  chipBorder: "#2b5b41",
  tableHead: "#0d1c14",
  codeBg: "#0a130f",
  shadow: "0 10px 30px rgba(0,0,0,0.35)",
};

function n(v: any): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function ceilTrips(amount: number, cap: number) {
  if (!cap || cap <= 0) return 0;
  return Math.ceil(amount / cap);
}

function norm(s: any) {
  return String(s ?? "").trim().toLowerCase();
}

function getRecipeKey(r: Row) {
  const prod = String(r.ProductionType ?? "").trim();
  const faction = String(r.Faction ?? "").trim();
  const cat = String(r.ProductionCategory ?? "").trim();
  const crate = r.IsCrateOutput ? `crate:${r.CrateCapacity ?? ""}` : "no-crate";
  const time = String(r.ProductionTime ?? "").trim();
  return [prod, faction, cat, crate, time].filter(Boolean).join(" • ") || "recipe";
}

function getOutputUnitsPerCraft(r: Row): number {
  return Math.max(1, n(r.OutputAmount));
}

function getUnitsPerCrate(r: Row): number {
  return r.IsCrateOutput ? Math.max(1, n(r.CrateCapacity)) : 0;
}

function extractInputs(r: Row) {
  const inputs: { item: string; amount: number; unit: string }[] = [];
  for (let i = 1; i <= 6; i++) {
    const item = String(r[`InputItem${i}`] ?? "").trim();
    const amount = n(r[`InputItem${i}Amount`]);
    const unit = String(r[`InputItem${i}Unit`] ?? "").trim();
    if (item) inputs.push({ item, amount, unit });
  }
  return inputs;
}

function rowRawPerUnit(r: Row): Totals {
  return {
    SalvagePerUnit: n(r.SalvagePerUnit),
    CoalPerUnit: n(r.CoalPerUnit),
    ComponentPerUnit: n(r.ComponentPerUnit),
    SulfurPerUnit: n(r.SulfurPerUnit),
    PetrolPerUnit: n(r.PetrolPerUnit),
    HeavyOilPerUnit: n(r.HeavyOilPerUnit),
    RareMetalPerUnit: n(r.RareMetalPerUnit),
  };
}

function mulTotals(t: Totals, factor: number): Totals {
  const out: any = {};
  for (const k of RAW_KEYS) out[k] = (t as any)[k] * factor;
  return out as Totals;
}

function sumTotals(a: Totals, b: Totals): Totals {
  const out: any = {};
  for (const k of RAW_KEYS) out[k] = (a as any)[k] + (b as any)[k];
  return out as Totals;
}

function craftsNeededForUnits(r: Row, desiredUnits: number) {
  const perCraft = getOutputUnitsPerCraft(r);
  return desiredUnits / perCraft;
}

function formatNum(x: number, digits = 2) {
  if (!Number.isFinite(x)) return "0";
  if (Math.abs(x - Math.round(x)) < 1e-9) return String(Math.round(x));
  return x.toFixed(digits);
}

function expandToRawRecursive(params: {
  rows: Row[];
  outputName: string;
  desiredUnits: number;
  depthLimit: number;
  visited: Set<string>;
}): Totals {
  const { rows, outputName, desiredUnits, depthLimit, visited } = params;

  const key = norm(outputName);
  if (!key || desiredUnits <= 0 || depthLimit <= 0) {
    return {
      SalvagePerUnit: 0,
      CoalPerUnit: 0,
      ComponentPerUnit: 0,
      SulfurPerUnit: 0,
      PetrolPerUnit: 0,
      HeavyOilPerUnit: 0,
      RareMetalPerUnit: 0,
    };
  }
  if (visited.has(key)) {
    return {
      SalvagePerUnit: 0,
      CoalPerUnit: 0,
      ComponentPerUnit: 0,
      SulfurPerUnit: 0,
      PetrolPerUnit: 0,
      HeavyOilPerUnit: 0,
      RareMetalPerUnit: 0,
    };
  }
  visited.add(key);

  const candidates = rows.filter((r) => norm(r.Output) === key);
  if (candidates.length === 0) {
    visited.delete(key);
    return {
      SalvagePerUnit: 0,
      CoalPerUnit: 0,
      ComponentPerUnit: 0,
      SulfurPerUnit: 0,
      PetrolPerUnit: 0,
      HeavyOilPerUnit: 0,
      RareMetalPerUnit: 0,
    };
  }

  const r = candidates[0];
  const crafts = craftsNeededForUnits(r, desiredUnits);
  const baseRaw = mulTotals(rowRawPerUnit(r), crafts);

  const inputs = extractInputs(r);

  let inputsRaw: Totals = {
    SalvagePerUnit: 0,
    CoalPerUnit: 0,
    ComponentPerUnit: 0,
    SulfurPerUnit: 0,
    PetrolPerUnit: 0,
    HeavyOilPerUnit: 0,
    RareMetalPerUnit: 0,
  };

  for (const inp of inputs) {
    const raw = expandToRawRecursive({
      rows,
      outputName: inp.item,
      desiredUnits: inp.amount * crafts,
      depthLimit: depthLimit - 1,
      visited,
    });
    inputsRaw = sumTotals(inputsRaw, raw);
  }

  visited.delete(key);
  return sumTotals(baseRaw, inputsRaw);
}

export default function Home() {
  const rows = (db as any).rows as Row[];

  const [query, setQuery] = useState("");
  const [selectedOutput, setSelectedOutput] = useState<string>("");
  const [recipeIndex, setRecipeIndex] = useState(0);
  
  const [showSettings, setShowSettings] = useState(false);

  const [mode, setMode] = useState<Mode>("units");
  const [amount, setAmount] = useState<number>(1);

  const [includeFacilityChain, setIncludeFacilityChain] = useState(false);
  const [depthLimit, setDepthLimit] = useState(3);

  const [conv, setConv] = useState<Conversions>({
    componentsPerRmat: 20,
    sulfurPerEmat: 20,
    salvagePerBmat: 1,
  });

  const [cap, setCap] = useState<Capacities>({
    component: { hauler: 1500, atlas: 2000, flatbed: 5000 },
    salvage: { hauler: 1500, atlas: 2000, flatbed: 5000 },
    sulfur: { hauler: 1500, atlas: 2000, flatbed: 5000 },
    coal: { hauler: 1500, atlas: 2000, flatbed: 5000 },
    petrol: { hauler: 1500, atlas: 2000, flatbed: 5000 },
    heavyOil: { hauler: 1500, atlas: 2000, flatbed: 5000 },
    rareMetal: { hauler: 1500, atlas: 2000, flatbed: 5000 },
  });

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const o = sp.get("o") ?? "";
    const ri = sp.get("r");
    const m = sp.get("m");
    const a = sp.get("a");
    const ch = sp.get("chain");
    const d = sp.get("d");

    if (o) {
      setSelectedOutput(o);
      setQuery(o);
    }
    if (ri) setRecipeIndex(Math.max(0, parseInt(ri, 10) || 0));
    if (m === "crates" || m === "units") setMode(m);
    if (a) setAmount(Math.max(0, Number(a) || 0));
    if (ch) setIncludeFacilityChain(ch === "1");
    if (d) setDepthLimit(Math.min(10, Math.max(1, parseInt(d, 10) || 3)));
  }, []);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (selectedOutput) sp.set("o", selectedOutput);
    sp.set("r", String(recipeIndex));
    sp.set("m", mode);
    sp.set("a", String(amount));
    sp.set("chain", includeFacilityChain ? "1" : "0");
    sp.set("d", String(depthLimit));
    const newUrl = `${window.location.pathname}?${sp.toString()}`;
    window.history.replaceState(null, "", newUrl);
  }, [selectedOutput, recipeIndex, mode, amount, includeFacilityChain, depthLimit]);

  const outputSuggestions = useMemo(() => {
    const q = norm(query);
    if (!q) return [];
    const set = new Set<string>();
    for (const r of rows) {
      const out = String(r.Output ?? "").trim();
      if (!out) continue;
      if (!norm(out).includes(q)) continue;
      set.add(out);
      if (set.size >= 15) break;
    }
    return Array.from(set);
  }, [query, rows]);

  const recipeVariants = useMemo(() => {
    const key = norm(selectedOutput || query);
    if (!key) return [];
    return rows.filter((r) => norm(r.Output) === key);
  }, [rows, selectedOutput, query]);

  const recipe = useMemo(() => {
    if (recipeVariants.length === 0) return null;
    return recipeVariants[Math.min(recipeIndex, recipeVariants.length - 1)];
  }, [recipeVariants, recipeIndex]);

  const desiredUnits = useMemo(() => {
    if (!recipe) return 0;
    const a = Math.max(0, amount || 0);

    if (mode === "units") return a;

    const unitsPerCrate = getUnitsPerCrate(recipe);
    if (!unitsPerCrate) return a * getOutputUnitsPerCraft(recipe);
    return a * unitsPerCrate;
  }, [recipe, amount, mode]);

  const crafts = useMemo(() => {
    if (!recipe) return 0;
    return craftsNeededForUnits(recipe, desiredUnits);
  }, [recipe, desiredUnits]);

  const totalsRaw = useMemo((): Totals => {
    if (!recipe || desiredUnits <= 0) {
      return {
        SalvagePerUnit: 0,
        CoalPerUnit: 0,
        ComponentPerUnit: 0,
        SulfurPerUnit: 0,
        PetrolPerUnit: 0,
        HeavyOilPerUnit: 0,
        RareMetalPerUnit: 0,
      };
    }
    if (!includeFacilityChain) return mulTotals(rowRawPerUnit(recipe), crafts);

    return expandToRawRecursive({
      rows,
      outputName: String(recipe.Output ?? ""),
      desiredUnits,
      depthLimit,
      visited: new Set<string>(),
    });
  }, [recipe, desiredUnits, crafts, includeFacilityChain, depthLimit, rows]);

  const refined = useMemo(() => {
    const components = totalsRaw.ComponentPerUnit;
    const sulfur = totalsRaw.SulfurPerUnit;
    const salvage = totalsRaw.SalvagePerUnit;

    const rmats = conv.componentsPerRmat > 0 ? components / conv.componentsPerRmat : 0;
    const emats = conv.sulfurPerEmat > 0 ? sulfur / conv.sulfurPerEmat : 0;
    const bmats = conv.salvagePerBmat > 0 ? salvage / conv.salvagePerBmat : 0;

    return { rmats, emats, bmats };
  }, [totalsRaw, conv]);

  const travel = useMemo(() => {
    const comp = totalsRaw.ComponentPerUnit;
    const salv = totalsRaw.SalvagePerUnit;
    const sulf = totalsRaw.SulfurPerUnit;
    const coal = totalsRaw.CoalPerUnit;
    const petrol = totalsRaw.PetrolPerUnit;
    const heavy = totalsRaw.HeavyOilPerUnit;
    const rare = totalsRaw.RareMetalPerUnit;

    return {
      component: {
        hauler: ceilTrips(comp, cap.component.hauler),
        atlas: ceilTrips(comp, cap.component.atlas),
        flatbed: ceilTrips(comp, cap.component.flatbed),
      },
      salvage: {
        hauler: ceilTrips(salv, cap.salvage.hauler),
        atlas: ceilTrips(salv, cap.salvage.atlas),
        flatbed: ceilTrips(salv, cap.salvage.flatbed),
      },
      sulfur: {
        hauler: ceilTrips(sulf, cap.sulfur.hauler),
        atlas: ceilTrips(sulf, cap.sulfur.atlas),
        flatbed: ceilTrips(sulf, cap.sulfur.flatbed),
      },
      coal: {
        hauler: ceilTrips(coal, cap.coal.hauler),
        atlas: ceilTrips(coal, cap.coal.atlas),
        flatbed: ceilTrips(coal, cap.coal.flatbed),
      },
      petrol: {
        hauler: ceilTrips(petrol, cap.petrol.hauler),
        atlas: ceilTrips(petrol, cap.petrol.atlas),
        flatbed: ceilTrips(petrol, cap.petrol.flatbed),
      },
      heavyOil: {
        hauler: ceilTrips(heavy, cap.heavyOil.hauler),
        atlas: ceilTrips(heavy, cap.heavyOil.atlas),
        flatbed: ceilTrips(heavy, cap.heavyOil.flatbed),
      },
      rareMetal: {
        hauler: ceilTrips(rare, cap.rareMetal.hauler),
        atlas: ceilTrips(rare, cap.rareMetal.atlas),
        flatbed: ceilTrips(rare, cap.rareMetal.flatbed),
      },
    };
  }, [totalsRaw, cap]);

  const inputs = useMemo(() => (recipe ? extractInputs(recipe) : []), [recipe]);

  const discordExport = useMemo(() => {
    if (!recipe || desiredUnits <= 0) return "";
    const outName = String(recipe.Output ?? "Output");
    const variant = getRecipeKey(recipe);

    const lines: string[] = [];
    lines.push(`🟩 ${outName}`);
    lines.push(`• ${variant}`);
    lines.push(`• Requested: ${formatNum(desiredUnits)} units  |  Crafts: ${formatNum(crafts)}`);
    lines.push("");
    lines.push(`RAW TOTALS`);
    if (totalsRaw.SalvagePerUnit) lines.push(`- Salvage: ${formatNum(totalsRaw.SalvagePerUnit)}`);
    if (totalsRaw.CoalPerUnit) lines.push(`- Coal: ${formatNum(totalsRaw.CoalPerUnit)}`);
    if (totalsRaw.ComponentPerUnit) lines.push(`- Components: ${formatNum(totalsRaw.ComponentPerUnit)}`);
    if (totalsRaw.SulfurPerUnit) lines.push(`- Sulfur: ${formatNum(totalsRaw.SulfurPerUnit)}`);
    if (totalsRaw.PetrolPerUnit) lines.push(`- Petrol: ${formatNum(totalsRaw.PetrolPerUnit)}`);
    if (totalsRaw.HeavyOilPerUnit) lines.push(`- Heavy Oil: ${formatNum(totalsRaw.HeavyOilPerUnit)}`);
    if (totalsRaw.RareMetalPerUnit) lines.push(`- Rare Metal: ${formatNum(totalsRaw.RareMetalPerUnit)}`);
    lines.push("");
    lines.push(`REFINED (ratios)`);
    if (refined.bmats) lines.push(`- Bmats: ${formatNum(refined.bmats)}`);
    if (refined.emats) lines.push(`- Emats: ${formatNum(refined.emats)}`);
    if (refined.rmats) lines.push(`- Rmats: ${formatNum(refined.rmats)}`);
    lines.push("");
    lines.push(`TRIPS (Components)`);
    lines.push(`- Hauler: ${travel.component.hauler} | Atlas: ${travel.component.atlas} | Flatbed: ${travel.component.flatbed}`);

    return lines.join("\n");
  }, [recipe, desiredUnits, crafts, totalsRaw, refined, travel]);

  // Reusable “colonial” styles
  const S = {
    page: {
      padding: 24,
      maxWidth: 1100,
      margin: "0 auto",
      fontFamily: "system-ui, sans-serif",
      background: T.bg,
      color: T.text,
      minHeight: "100vh",
    } as React.CSSProperties,
    title: { fontSize: 22, marginBottom: 12, letterSpacing: 0.2 } as React.CSSProperties,
    panel: {
      background: `linear-gradient(180deg, ${T.panel}, ${T.panel2})`,
      border: `1px solid ${T.border}`,
      borderRadius: 16,
      padding: 14,
      boxShadow: T.shadow,
    } as React.CSSProperties,
    input: {
      padding: "10px 12px",
      borderRadius: 12,
      border: `1px solid ${T.border2}`,
      background: T.codeBg,
      color: T.text,
      outline: "none",
    } as React.CSSProperties,
    select: {
      padding: "10px 12px",
      borderRadius: 12,
      border: `1px solid ${T.border2}`,
      background: T.codeBg,
      color: T.text,
      outline: "none",
    } as React.CSSProperties,
    chip: {
      padding: "6px 10px",
      borderRadius: 999,
      border: `1px solid ${T.chipBorder}`,
      background: T.chipBg,
      color: T.text,
      cursor: "pointer",
      fontSize: 12,
      boxShadow: "0 6px 14px rgba(0,0,0,0.25)",
    } as React.CSSProperties,
    chipActive: {
      border: `1px solid ${T.accent}`,
      boxShadow: `0 0 0 2px rgba(70,194,110,0.15), 0 10px 18px rgba(0,0,0,0.35)`,
    } as React.CSSProperties,
    badge: {
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      padding: "6px 10px",
      borderRadius: 999,
      border: `1px solid ${T.border2}`,
      background: T.tableHead,
      color: T.muted,
      fontSize: 12,
    } as React.CSSProperties,
    card: {
      border: `1px solid ${T.border2}`,
      borderRadius: 14,
      padding: 10,
      background: "rgba(0,0,0,0.15)",
    } as React.CSSProperties,
    muted: { opacity: 0.85, color: T.muted } as React.CSSProperties,
    h: { fontWeight: 800 } as React.CSSProperties,
    sub: { opacity: 0.75, color: T.muted } as React.CSSProperties,
    btn: {
      padding: "7px 10px",
      borderRadius: 12,
      border: `1px solid ${T.border2}`,
      background: `linear-gradient(180deg, rgba(70,194,110,0.18), rgba(70,194,110,0.08))`,
      color: T.text,
      cursor: "pointer",
      fontSize: 12,
    } as React.CSSProperties,
    btnDisabled: { opacity: 0.5, cursor: "not-allowed" } as React.CSSProperties,
    pre: {
      marginTop: 8,
      padding: 12,
      borderRadius: 14,
      background: T.codeBg,
      border: `1px solid ${T.border2}`,
      overflowX: "auto",
      color: T.text,
    } as React.CSSProperties,
    divider: { height: 1, background: T.border, margin: "14px 0" } as React.CSSProperties,
    kbd: {
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 12,
      padding: "2px 6px",
      borderRadius: 8,
      border: `1px solid ${T.border2}`,
      background: T.codeBg,
      color: T.muted,
    } as React.CSSProperties,
  };

  return (
    <main style={S.page}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
  <h1 style={S.title}>🟩 Foxhole Colonial Logistics Calculator</h1>

  <button
    onClick={() => setShowSettings((v) => !v)}
    title="Settings"
    style={{
      background: T.chipBg,
      border: `1px solid ${T.chipBorder}`,
      color: T.text,
      borderRadius: 12,
      padding: "8px 10px",
      cursor: "pointer",
      fontSize: 18,
      lineHeight: 1,
      boxShadow: T.shadow,
    }}
  >
    ⚙️
  </button>
</div>
      
      {/* Search / select */}
      <div style={{ ...S.panel, marginTop: 12 }}>
        <div style={{ display: "grid", gap: 10 }}>
          <label style={S.h}>Output</label>
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedOutput("");
              setRecipeIndex(0);
            }}
            placeholder='Es: "Flatbed"'
            style={S.input}
          />

          {outputSuggestions.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {outputSuggestions.map((s) => {
                const active = norm(s) === norm(selectedOutput || query);
                return (
                  <button
                    key={s}
                    onClick={() => {
                      setSelectedOutput(s);
                      setQuery(s);
                      setRecipeIndex(0);
                    }}
                    style={{ ...S.chip, ...(active ? S.chipActive : {}) }}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          )}

          <div style={{ ...S.muted, fontSize: 13 }}>
            Tip: usa i suggerimenti oppure scrivi il nome esatto. <span style={S.kbd}>o=</span> e <span style={S.kbd}>r=</span> sono salvati in URL.
          </div>
        </div>
      </div>

      {/* Recipe variants + quantity */}
      <div style={{ ...S.panel, marginTop: 14 }}>
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gap: 8 }}>
            <label style={S.h}>Recipe variant</label>
            <select
              value={recipeIndex}
              onChange={(e) => setRecipeIndex(parseInt(e.target.value, 10) || 0)}
              disabled={recipeVariants.length === 0}
              style={S.select}
            >
              {recipeVariants.length === 0 ? (
                <option value={0}>No recipes found</option>
              ) : (
                recipeVariants.map((r, idx) => (
                  <option key={idx} value={idx}>
                    [{idx + 1}/{recipeVariants.length}] {getRecipeKey(r)}
                  </option>
                ))
              )}
            </select>
          </div>

          <div style={S.divider} />

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <label style={S.h}>Amount</label>
            <input
              type="number"
              value={amount}
              min={0}
              step={1}
              onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
              style={{ ...S.input, width: 160 }}
            />
            <select value={mode} onChange={(e) => setMode(e.target.value as Mode)} style={S.select}>
              <option value="units">units</option>
              <option value="crates">crates</option>
            </select>

            <label style={{ marginLeft: 10, display: "flex", alignItems: "center", gap: 10, color: T.text }}>
              <input type="checkbox" checked={includeFacilityChain} onChange={(e) => setIncludeFacilityChain(e.target.checked)} />
              Include facility chain (recursive)
            </label>

            {includeFacilityChain && (
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={S.muted}>Depth</span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={depthLimit}
                  onChange={(e) => setDepthLimit(Math.min(10, Math.max(1, Number(e.target.value) || 3)))}
                  style={{ ...S.input, width: 90 }}
                />
              </label>
            )}
          </div>
        </div>
      </div>

      {/* Results */}
      <div style={{ ...S.panel, marginTop: 14 }}>
        {!recipe ? (
          <div style={S.muted}>Select an output to see cost.</div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 900, fontSize: 16 }}>{String(recipe.Output ?? "")}</div>
                <div style={S.sub}>{getRecipeKey(recipe)}</div>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <div style={S.badge}>Requested: <b style={{ color: T.text }}>{formatNum(desiredUnits)}</b></div>
                <div style={S.badge}>Crafts: <b style={{ color: T.text }}>{formatNum(crafts)}</b></div>
                <div style={S.badge}>Per craft: <b style={{ color: T.text }}>{formatNum(getOutputUnitsPerCraft(recipe))}</b></div>
              </div>
            </div>

            <div style={S.divider} />

            <div>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>Inputs (as listed)</div>
              {inputs.length === 0 ? (
                <div style={S.muted}>No item inputs listed (raw resource recipe or missing data).</div>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18, color: T.text }}>
                  {inputs.map((i, idx) => (
                    <li key={idx} style={{ color: T.text }}>
                      <span style={{ color: T.accent }}>{i.item}</span>: {formatNum(i.amount)} {i.unit ? <span style={S.muted}>({i.unit})</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div style={S.divider} />

            <div>
              <div style={{ fontWeight: 800, marginBottom: 8 }}>Raw totals</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
                {RAW_KEYS.map((k) => (
                  <div key={k} style={S.card}>
                    <div style={{ fontSize: 12, color: T.muted }}>{k.replace("PerUnit", "")}</div>
                    <div style={{ fontWeight: 900, color: T.text }}>{formatNum((totalsRaw as any)[k])}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={S.divider} />

            <div>
              <div style={{ fontWeight: 800, marginBottom: 8 }}>Refined (ratios)</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
                <div style={S.card}>
                  <div style={{ fontSize: 12, color: T.muted }}>Bmats</div>
                  <div style={{ fontWeight: 900, color: T.text }}>{formatNum(refined.bmats)}</div>
                </div>
                <div style={S.card}>
                  <div style={{ fontSize: 12, color: T.muted }}>Emats</div>
                  <div style={{ fontWeight: 900, color: T.text }}>{formatNum(refined.emats)}</div>
                </div>
                <div style={S.card}>
                  <div style={{ fontSize: 12, color: T.muted }}>Rmats</div>
                  <div style={{ fontWeight: 900, color: T.text }}>{formatNum(refined.rmats)}</div>
                </div>
              </div>
            </div>

            <div style={S.divider} />

            <div>
              <div style={{ fontWeight: 800, marginBottom: 8 }}>Trips (ceil)</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                {(
                  [
                    ["Components", "component"],
                    ["Salvage", "salvage"],
                    ["Sulfur", "sulfur"],
                    ["Coal", "coal"],
                    ["Petrol", "petrol"],
                    ["Heavy Oil", "heavyOil"],
                    ["Rare Metal", "rareMetal"],
                  ] as const
                ).map(([label, key]) => (
                  <div key={key} style={S.card}>
                    <div style={{ fontWeight: 900, marginBottom: 6, color: T.text }}>{label}</div>
                    <div style={{ color: T.muted, fontSize: 13 }}>
                      Hauler: <span style={{ color: T.text, fontWeight: 700 }}>{travel[key].hauler}</span> • Atlas:{" "}
                      <span style={{ color: T.text, fontWeight: 700 }}>{travel[key].atlas}</span> • Flatbed:{" "}
                      <span style={{ color: T.text, fontWeight: 700 }}>{travel[key].flatbed}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={S.divider} />

            <div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <div style={{ fontWeight: 800 }}>Export (Discord)</div>
                <button
                  onClick={async () => {
                    await navigator.clipboard.writeText(discordExport || "");
                  }}
                  style={{ ...S.btn, ...(discordExport ? {} : S.btnDisabled) }}
                  disabled={!discordExport}
                >
                  Copy
                </button>
              </div>
              <pre style={S.pre}>{discordExport || "—"}</pre>
            </div>
          </>
        )}
      </div>

      {/* Settings */}
      {showSettings && (
      <div style={{ ...S.panel, marginTop: 14 }}>
        <div style={{ fontWeight: 900, marginBottom: 10 }}>Settings</div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, color: T.muted }}>componentsPerRmat</span>
            <input
              type="number"
              value={conv.componentsPerRmat}
              onChange={(e) => setConv((c) => ({ ...c, componentsPerRmat: Math.max(1, Number(e.target.value) || 20) }))}
              style={S.input}
            />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, color: T.muted }}>sulfurPerEmat</span>
            <input
              type="number"
              value={conv.sulfurPerEmat}
              onChange={(e) => setConv((c) => ({ ...c, sulfurPerEmat: Math.max(1, Number(e.target.value) || 20) }))}
              style={S.input}
            />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, color: T.muted }}>salvagePerBmat</span>
            <input
              type="number"
              value={conv.salvagePerBmat}
              onChange={(e) => setConv((c) => ({ ...c, salvagePerBmat: Math.max(1, Number(e.target.value) || 1) }))}
              style={S.input}
            />
          </label>
        </div>

        <div style={S.divider} />

        <div style={{ fontWeight: 900, marginBottom: 10 }}>Capacities (raw per trip)</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
          {(["component", "salvage", "sulfur", "coal", "petrol", "heavyOil", "rareMetal"] as const).map((k) => (
            <div key={k} style={{ ...S.card, background: "rgba(0,0,0,0.10)" }}>
              <div style={{ fontWeight: 900, marginBottom: 8, color: T.accent }}>{k}</div>
              {(["hauler", "atlas", "flatbed"] as const).map((v) => (
                <label key={v} style={{ display: "grid", gap: 6, marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: T.muted }}>{v}</span>
                  <input
                    type="number"
                    value={(cap as any)[k][v]}
                    onChange={(e) =>
                      setCap((prev) => ({
                        ...prev,
                        [k]: { ...(prev as any)[k], [v]: Math.max(1, Number(e.target.value) || 1) },
                      }))
                    }
                    style={S.input}
                  />
                </label>
              ))}
            </div>
          ))}
        </div>
      </div>
)}
    </main>
  );
}