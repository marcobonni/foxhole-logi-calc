// app/page.tsx
"use client";

import db from "@/data/foxhole-logi-db.json";
import React, { useEffect, useMemo, useState } from "react";

type Row = Record<string, any>;

type Mode = "units" | "crates";

type Conversions = {
  // Raw -> refined (defaults based on your example only where you gave it)
  componentsPerRmat: number; // 20
  sulfurPerEmat: number; // set by you (default 20 as placeholder)
  salvagePerBmat: number; // default 1 as placeholder
};

type Capacities = {
  // Carry capacity (raw resources) per trip
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
  // useful for selecting among variants
  const prod = String(r.ProductionType ?? "").trim();
  const faction = String(r.Faction ?? "").trim();
  const cat = String(r.ProductionCategory ?? "").trim();
  const crate = r.IsCrateOutput ? `crate:${r.CrateCapacity ?? ""}` : "no-crate";
  const time = String(r.ProductionTime ?? "").trim();
  return [prod, faction, cat, crate, time].filter(Boolean).join(" • ") || "recipe";
}

function getOutputUnitsPerCraft(r: Row): number {
  // OutputAmount is "per craft" (often 1 item, or more for refinery)
  return Math.max(1, n(r.OutputAmount));
}

function getUnitsPerCrate(r: Row): number {
  // If crate output, crate capacity is units per crate; otherwise 0
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

function sumTotals(a: Totals, b: Totals): Totals {
  const out: any = {};
  for (const k of RAW_KEYS) out[k] = (a as any)[k] + (b as any)[k];
  return out as Totals;
}

function mulTotals(t: Totals, factor: number): Totals {
  const out: any = {};
  for (const k of RAW_KEYS) out[k] = (t as any)[k] * factor;
  return out as Totals;
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

/**
 * Convert "desired units" into a multiplier of the recipe "craft" quantity.
 * Example: if recipe outputs 20 units per craft and you want 30 units,
 * crafts = 30 / 20.
 */
function craftsNeededForUnits(r: Row, desiredUnits: number) {
  const perCraft = getOutputUnitsPerCraft(r);
  return desiredUnits / perCraft;
}

function formatNum(x: number, digits = 2) {
  if (!Number.isFinite(x)) return "0";
  // integer-ish values shown without decimals
  if (Math.abs(x - Math.round(x)) < 1e-9) return String(Math.round(x));
  return x.toFixed(digits);
}

/**
 * Optional: expand inputs recursively into raw resources using the same DB.
 * This is an approximation because input units may be item counts, crates, etc.
 * We treat input amount as "units" of the input Output.
 */
function expandToRawRecursive(params: {
  rows: Row[];
  outputName: string;
  desiredUnits: number;
  depthLimit: number;
  visited: Set<string>;
  // choose first recipe variant by default
}): Totals {
  const { rows, outputName, desiredUnits, depthLimit, visited } = params;

  const key = norm(outputName);
  if (!key || desiredUnits <= 0) {
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
  if (visited.has(key) || depthLimit <= 0) {
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
    // Unknown item; can't expand
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

  // pick first recipe variant (you can extend later to pick best)
  const r = candidates[0];

  // base raw from this recipe
  const crafts = craftsNeededForUnits(r, desiredUnits);
  const baseRaw = mulTotals(rowRawPerUnit(r), crafts);

  // plus raw from its inputs (facility chains)
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
    // Interpret input amount as "units of that item"
    // (If the DB uses different units in some cases, you can special-case later)
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

  // Search + selection
  const [query, setQuery] = useState("");
  const [selectedOutput, setSelectedOutput] = useState<string>("");
  const [recipeIndex, setRecipeIndex] = useState(0);

  // Quantity
  const [mode, setMode] = useState<Mode>("units");
  const [amount, setAmount] = useState<number>(1);

  // Options
  const [includeFacilityChain, setIncludeFacilityChain] = useState(false);
  const [depthLimit, setDepthLimit] = useState(3);

  // Conversions (editable)
  const [conv, setConv] = useState<Conversions>({
    componentsPerRmat: 20, // from your example
    sulfurPerEmat: 20, // placeholder (edit it to your known ratio)
    salvagePerBmat: 1, // placeholder (edit if needed)
  });

  // Vehicle capacities (editable)
  const [cap, setCap] = useState<Capacities>({
    // from your example for components:
    component: { hauler: 1500, atlas: 2000, flatbed: 5000 },
    // placeholders (edit as needed):
    salvage: { hauler: 1500, atlas: 2000, flatbed: 5000 },
    sulfur: { hauler: 1500, atlas: 2000, flatbed: 5000 },
    coal: { hauler: 1500, atlas: 2000, flatbed: 5000 },
    petrol: { hauler: 1500, atlas: 2000, flatbed: 5000 },
    heavyOil: { hauler: 1500, atlas: 2000, flatbed: 5000 },
    rareMetal: { hauler: 1500, atlas: 2000, flatbed: 5000 },
  });

  // Hydrate state from URL
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

  // Persist state to URL (shareable)
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

    // crates mode
    const unitsPerCrate = getUnitsPerCrate(recipe);
    if (!unitsPerCrate) {
      // if recipe isn't a crate output, interpret "crates" as "crafts"
      // (you can refine later)
      return a * getOutputUnitsPerCraft(recipe);
    }
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

    if (!includeFacilityChain) {
      return mulTotals(rowRawPerUnit(recipe), crafts);
    }

    return expandToRawRecursive({
      rows,
      outputName: String(recipe.Output ?? ""),
      desiredUnits,
      depthLimit,
      visited: new Set<string>(),
    });
  }, [recipe, desiredUnits, crafts, includeFacilityChain, depthLimit, rows]);

  const refined = useMemo(() => {
    // Only conversions we can safely express given your example.
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

  const discordExport = useMemo(() => {
    if (!recipe || desiredUnits <= 0) return "";
    const outName = String(recipe.Output ?? "Output");
    const variant = getRecipeKey(recipe);

    const lines: string[] = [];
    lines.push(`${outName} (${variant})`);
    lines.push(`Requested: ${formatNum(desiredUnits)} units`);
    lines.push(`Crafts: ${formatNum(crafts)}`);
    lines.push("");
    lines.push(`Raw totals:`);
    if (totalsRaw.SalvagePerUnit) lines.push(`- Salvage: ${formatNum(totalsRaw.SalvagePerUnit)}`);
    if (totalsRaw.CoalPerUnit) lines.push(`- Coal: ${formatNum(totalsRaw.CoalPerUnit)}`);
    if (totalsRaw.ComponentPerUnit) lines.push(`- Components: ${formatNum(totalsRaw.ComponentPerUnit)}`);
    if (totalsRaw.SulfurPerUnit) lines.push(`- Sulfur: ${formatNum(totalsRaw.SulfurPerUnit)}`);
    if (totalsRaw.PetrolPerUnit) lines.push(`- Petrol: ${formatNum(totalsRaw.PetrolPerUnit)}`);
    if (totalsRaw.HeavyOilPerUnit) lines.push(`- Heavy Oil: ${formatNum(totalsRaw.HeavyOilPerUnit)}`);
    if (totalsRaw.RareMetalPerUnit) lines.push(`- Rare Metal: ${formatNum(totalsRaw.RareMetalPerUnit)}`);

    lines.push("");
    lines.push(`Refined (using your ratios):`);
    if (refined.bmats) lines.push(`- Bmats: ${formatNum(refined.bmats)}`);
    if (refined.emats) lines.push(`- Emats: ${formatNum(refined.emats)}`);
    if (refined.rmats) lines.push(`- Rmats: ${formatNum(refined.rmats)}`);

    lines.push("");
    lines.push(`Trips (components): hauler ${travel.component.hauler}, atlas ${travel.component.atlas}, flatbed ${travel.component.flatbed}`);
    return lines.join("\n");
  }, [recipe, desiredUnits, crafts, totalsRaw, refined, travel]);

  const inputs = useMemo(() => (recipe ? extractInputs(recipe) : []), [recipe]);

  return (
    <main style={{ padding: 24, maxWidth: 1100, margin: "0 auto", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 22, marginBottom: 12 }}>Foxhole Logistics Calculator</h1>

      {/* Search / select */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
        <label style={{ fontWeight: 600 }}>Output</label>
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            // keep selection loosely in sync
            setSelectedOutput("");
            setRecipeIndex(0);
          }}
          placeholder='Es: "Flatbed"'
          style={{ padding: "10px 12px", border: "1px solid #ccc", borderRadius: 10 }}
        />

        {outputSuggestions.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {outputSuggestions.map((s) => (
              <button
                key={s}
                onClick={() => {
                  setSelectedOutput(s);
                  setQuery(s);
                  setRecipeIndex(0);
                }}
                style={{
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: "1px solid #ddd",
                  background: "white",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Recipe variants */}
      <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
        <label style={{ fontWeight: 600 }}>Recipe variant</label>
        <select
          value={recipeIndex}
          onChange={(e) => setRecipeIndex(parseInt(e.target.value, 10) || 0)}
          disabled={recipeVariants.length === 0}
          style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ccc", maxWidth: 900 }}
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

      {/* Quantity */}
      <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ fontWeight: 600 }}>Amount</label>
        <input
          type="number"
          value={amount}
          min={0}
          step={1}
          onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
          style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ccc", width: 160 }}
        />
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as Mode)}
          style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ccc" }}
        >
          <option value="units">units</option>
          <option value="crates">crates</option>
        </select>

        <label style={{ marginLeft: 10, display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={includeFacilityChain}
            onChange={(e) => setIncludeFacilityChain(e.target.checked)}
          />
          Include facility chain (recursive inputs)
        </label>

        {includeFacilityChain && (
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            Depth
            <input
              type="number"
              min={1}
              max={10}
              value={depthLimit}
              onChange={(e) => setDepthLimit(Math.min(10, Math.max(1, Number(e.target.value) || 3)))}
              style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #ccc", width: 90 }}
            />
          </label>
        )}
      </div>

      {/* Summary */}
      <div style={{ marginTop: 18, padding: 14, border: "1px solid #eee", borderRadius: 14 }}>
        {!recipe ? (
          <div style={{ opacity: 0.8 }}>Select an output to see cost.</div>
        ) : (
          <>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{String(recipe.Output ?? "")}</div>
            <div style={{ opacity: 0.75, marginTop: 4 }}>{getRecipeKey(recipe)}</div>

            <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
              <div>
                <div style={{ opacity: 0.7, fontSize: 12 }}>Requested units</div>
                <div style={{ fontWeight: 700 }}>{formatNum(desiredUnits)}</div>
              </div>
              <div>
                <div style={{ opacity: 0.7, fontSize: 12 }}>Crafts</div>
                <div style={{ fontWeight: 700 }}>{formatNum(crafts)}</div>
              </div>
              <div>
                <div style={{ opacity: 0.7, fontSize: 12 }}>Output per craft</div>
                <div style={{ fontWeight: 700 }}>{formatNum(getOutputUnitsPerCraft(recipe))}</div>
              </div>
            </div>

            {/* Inputs */}
            <div style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Inputs (as listed in recipe)</div>
              {inputs.length === 0 ? (
                <div style={{ opacity: 0.75 }}>No item inputs listed (raw resource recipe or missing data).</div>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {inputs.map((i, idx) => (
                    <li key={idx}>
                      {i.item}: {formatNum(i.amount)} {i.unit ? `(${i.unit})` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Raw totals */}
            <div style={{ marginTop: 14 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Raw totals</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
                {RAW_KEYS.map((k) => (
                  <div key={k} style={{ border: "1px solid #f1f1f1", borderRadius: 12, padding: 10 }}>
                    <div style={{ opacity: 0.7, fontSize: 12 }}>{k.replace("PerUnit", "")}</div>
                    <div style={{ fontWeight: 700 }}>{formatNum((totalsRaw as any)[k])}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Refined */}
            <div style={{ marginTop: 14 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Refined (using ratios)</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
                <div style={{ border: "1px solid #f1f1f1", borderRadius: 12, padding: 10 }}>
                  <div style={{ opacity: 0.7, fontSize: 12 }}>Bmats</div>
                  <div style={{ fontWeight: 700 }}>{formatNum(refined.bmats)}</div>
                </div>
                <div style={{ border: "1px solid #f1f1f1", borderRadius: 12, padding: 10 }}>
                  <div style={{ opacity: 0.7, fontSize: 12 }}>Emats</div>
                  <div style={{ fontWeight: 700 }}>{formatNum(refined.emats)}</div>
                </div>
                <div style={{ border: "1px solid #f1f1f1", borderRadius: 12, padding: 10 }}>
                  <div style={{ opacity: 0.7, fontSize: 12 }}>Rmats</div>
                  <div style={{ fontWeight: 700 }}>{formatNum(refined.rmats)}</div>
                </div>
              </div>
            </div>

            {/* Trips */}
            <div style={{ marginTop: 14 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Trips (ceil)</div>
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
                  <div key={key} style={{ border: "1px solid #f1f1f1", borderRadius: 12, padding: 10 }}>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>{label}</div>
                    <div style={{ opacity: 0.85, fontSize: 13 }}>
                      Hauler: {travel[key].hauler} • Atlas: {travel[key].atlas} • Flatbed: {travel[key].flatbed}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Export */}
            <div style={{ marginTop: 14 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <div style={{ fontWeight: 700 }}>Export (Discord)</div>
                <button
                  onClick={async () => {
                    await navigator.clipboard.writeText(discordExport || "");
                  }}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 10,
                    border: "1px solid #ddd",
                    background: "white",
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                  disabled={!discordExport}
                >
                  Copy
                </button>
              </div>
              <pre style={{ marginTop: 8, padding: 10, borderRadius: 12, background: "#fafafa", overflowX: "auto" }}>
                {discordExport || "—"}
              </pre>
            </div>
          </>
        )}
      </div>

      {/* Settings */}
      <div style={{ marginTop: 18, padding: 14, border: "1px solid #eee", borderRadius: 14 }}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>Settings</div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, opacity: 0.75 }}>componentsPerRmat</span>
            <input
              type="number"
              value={conv.componentsPerRmat}
              onChange={(e) => setConv((c) => ({ ...c, componentsPerRmat: Math.max(1, Number(e.target.value) || 20) }))}
              style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #ccc" }}
            />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, opacity: 0.75 }}>sulfurPerEmat</span>
            <input
              type="number"
              value={conv.sulfurPerEmat}
              onChange={(e) => setConv((c) => ({ ...c, sulfurPerEmat: Math.max(1, Number(e.target.value) || 20) }))}
              style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #ccc" }}
            />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, opacity: 0.75 }}>salvagePerBmat</span>
            <input
              type="number"
              value={conv.salvagePerBmat}
              onChange={(e) => setConv((c) => ({ ...c, salvagePerBmat: Math.max(1, Number(e.target.value) || 1) }))}
              style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #ccc" }}
            />
          </label>
        </div>

        <div style={{ marginTop: 14, fontWeight: 700 }}>Capacities (raw per trip)</div>
        <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
          {(["component", "salvage", "sulfur", "coal", "petrol", "heavyOil", "rareMetal"] as const).map((k) => (
            <div key={k} style={{ border: "1px solid #f1f1f1", borderRadius: 12, padding: 10 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>{k}</div>
              {(["hauler", "atlas", "flatbed"] as const).map((v) => (
                <label key={v} style={{ display: "grid", gap: 6, marginBottom: 8 }}>
                  <span style={{ fontSize: 12, opacity: 0.75 }}>{v}</span>
                  <input
                    type="number"
                    value={(cap as any)[k][v]}
                    onChange={(e) =>
                      setCap((prev) => ({
                        ...prev,
                        [k]: { ...(prev as any)[k], [v]: Math.max(1, Number(e.target.value) || 1) },
                      }))
                    }
                    style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #ccc" }}
                  />
                </label>
              ))}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}