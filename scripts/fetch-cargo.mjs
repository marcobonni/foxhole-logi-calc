#!/usr/bin/env node
/**
 * Fetch all rows from a Cargo table via MediaWiki API (action=cargoquery),
 * with pagination (limit/offset), and write to a JSON file.
 *
 * Compatible with both Cargo response formats:
 * - formatversion=2: { cargoquery: [{ title, cargoquery: {...} }] }
 * - default/older:   { cargoquery: [{ title: {...fields...} }] }
 *
 * Usage examples:
 *   node scripts/fetch-cargo.mjs \
 *     --api "https://foxhole.wiki.gg/api.php" \
 *     --tables "productionmerged3" \
 *     --fields "PetrolPerUnit" \
 *     --limit 5 \
 *     --out "data/test.json"
 *
 *   node scripts/fetch-cargo.mjs \
 *     --api "https://foxhole.wiki.gg/api.php" \
 *     --tables "productionmerged3" \
 *     --fields "Field1,Field2,Field3" \
 *     --where "Field1 != ''" \
 *     --out "data/productionmerged3.json"
 */

import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

function toInt(v, fallback) {
  const n = Number.parseInt(String(v), 10);
  return Number.isFinite(n) ? n : fallback;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function cargoQueryPage({
  api,
  tables,
  fields,
  where,
  joinOn,
  orderBy,
  groupBy,
  having,
  limit,
  offset,
}) {
  const url = new URL(api);
  url.searchParams.set("action", "cargoquery");
  url.searchParams.set("format", "json");

  // Note: Some wikis don't behave as expected with formatversion=2.
  // We keep the default format and parse both shapes robustly.
  // url.searchParams.set("formatversion", "2");

  url.searchParams.set("tables", tables);
  url.searchParams.set("fields", fields);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));

  if (where) url.searchParams.set("where", where);
  if (joinOn) url.searchParams.set("join_on", joinOn);
  if (orderBy) url.searchParams.set("order_by", orderBy);
  if (groupBy) url.searchParams.set("group_by", groupBy);
  if (having) url.searchParams.set("having", having);

  const res = await fetch(url, {
    headers: {
      "User-Agent": "foxhole-logi-cargo-fetch/1.1 (personal project)",
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}\n${text.slice(0, 500)}`);
  }

  const data = await res.json();

  // MediaWiki can return HTTP 200 with an "error" payload
  if (data?.error) {
    throw new Error(`MediaWiki error: ${data.error.code} - ${data.error.info}`);
  }

  // Support both Cargo formats:
  // - formatversion=2: { cargoquery: [{ title, cargoquery: {...} }] }
  // - default:         { cargoquery: [{ title: {...fields...} }] }
  const rows = (data?.cargoquery ?? [])
    .map((r) => r?.cargoquery ?? r?.title)
    .filter((x) => x && typeof x === "object");

  return rows;
}

async function main() {
  const args = parseArgs(process.argv);

  const api = args.api ?? "https://foxhole.wiki.gg/api.php";
  const tables = args.tables;
  const fields = args.fields;
  const out = args.out ?? "data/cargo.json";

  if (!tables || !fields) {
    console.error(
      `Missing required args.
Required: --tables, --fields
Optional: --api, --where, --joinOn, --orderBy, --groupBy, --having, --limit, --out

Example:
node scripts/fetch-cargo.mjs --api "https://foxhole.wiki.gg/api.php" --tables "productionmerged3" --fields "PetrolPerUnit" --limit 5 --out "data/test.json"
`
    );
    process.exit(1);
  }

  const where = args.where ?? "";
  const joinOn = args.joinOn ?? "";
  const orderBy = args.orderBy ?? "";
  const groupBy = args.groupBy ?? "";
  const having = args.having ?? "";

  const limit = toInt(args.limit ?? "500", 500);
  let offset = 0;

  const all = [];
  for (;;) {
    const page = await cargoQueryPage({
      api,
      tables,
      fields,
      where,
      joinOn,
      orderBy,
      groupBy,
      having,
      limit,
      offset,
    });

    all.push(...page);

    if (page.length < limit) break;

    offset += limit;

    // Be nice to the wiki
    await sleep(250);
  }

  fs.mkdirSync(path.dirname(out), { recursive: true });

  const payload = {
    meta: {
      fetchedAt: new Date().toISOString(),
      api,
      tables,
      fields,
      where,
      joinOn,
      orderBy,
      groupBy,
      having,
      limit,
    },
    rows: all,
  };

  fs.writeFileSync(out, JSON.stringify(payload, null, 2), "utf8");
  console.log(`Saved ${all.length} rows -> ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});