#!/usr/bin/env node
// scripts/build-i18n.mjs — generate i18n/<iso>.json from Wikidata
// lexemes, via Wikifunctions' Z33668 "word for concept" function.
// Strict dogfood: no machine translation, no translatewiki, no
// hand-written English fallback. Every string in every catalog —
// English included — comes from this pipeline.
//
// Usage:
//   node scripts/build-i18n.mjs --lang en                # one language
//   node scripts/build-i18n.mjs --all                    # en + de + fr
//   node scripts/build-i18n.mjs --probe Q29485 Q1084 en  # test a single lookup
//
// Inputs:
//   i18n/mappings.json — UI key → { concept: Qxxx, category: Qxxx, english?: "…" }
//                        or { skip: true, reason: "…" }
//
// Outputs:
//   i18n/<iso>.json                  — catalog (generated; committed)
//   i18n/missing-lexemes.<iso>.md    — report of unresolved keys
//
// The report is the point: every entry there is a gap on Wikidata
// (a missing lexeme or a missing P5137). Closing those gaps on
// Wikidata benefits every dogfooded tool, not just zblocks.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const WF_API = "https://www.wikifunctions.org/w/api.php";
const CONCURRENCY = 2;              // polite to the orchestrator
const RETRY_MAX = 4;                // on 429 or transient failures
const RETRY_BASE_MS = 1000;
const DEFAULT_LANGS = ["en", "de", "fr"];

// Dedupe cache: many UI keys share the same (concept, lang, category)
// triple. One call per unique triple, shared result across keys.
const callCache = new Map();
function cacheKey(concept, lang, category) { return `${concept}|${lang}|${category}`; }

async function main() {
  const argv = process.argv.slice(2);
  const langsData = await loadLangsData();

  if (argv[0] === "--probe") {
    const [, concept, category, lang] = argv;
    const l = langsData.find(x => x.iso === lang);
    if (!l) throw new Error(`Unknown language: ${lang}`);
    const r = await callZ33668(concept, l.wfZid, category);
    console.log(JSON.stringify(r, null, 2));
    return;
  }

  const mappings = JSON.parse(await fs.readFile(path.join(REPO, "i18n/mappings.json"), "utf8"));
  let langs;
  if (argv.includes("--all")) {
    langs = DEFAULT_LANGS.map(iso => langsData.find(l => l.iso === iso)).filter(Boolean);
  } else if (argv.includes("--lang")) {
    const iso = argv[argv.indexOf("--lang") + 1];
    const l = langsData.find(x => x.iso === iso);
    if (!l) throw new Error(`Unknown language: ${iso}`);
    langs = [l];
  } else {
    langs = [langsData.find(l => l.iso === "en")];
  }

  for (const lang of langs) await buildFor(lang, mappings);
}

async function loadLangsData() {
  // Read js/languages-data.js without executing it — strip the
  // `export const LANGUAGES =` preamble and parse the JSON.
  const src = await fs.readFile(path.join(REPO, "js/languages-data.js"), "utf8");
  const m = src.match(/LANGUAGES\s*=\s*(\[[\s\S]*\])\s*;?\s*$/);
  if (!m) throw new Error("Can't parse languages-data.js");
  return JSON.parse(m[1]);
}

async function buildFor(lang, mappings) {
  console.log(`Building ${lang.iso} (${lang.native} — ${lang.wfZid})…`);
  const entries = Object.entries(mappings).filter(([k]) => !k.startsWith("@"));

  const tasks = [];
  let skipped = 0;
  const incomplete = [];
  for (const [key, m] of entries) {
    if (m.skip) { skipped++; continue; }
    if (!m.concept || !m.category) {
      incomplete.push({ key, english: m.english });
      continue;
    }
    tasks.push({ key, m });
  }

  const catalog = {
    "@metadata": {
      built: new Date().toISOString(),
      source: "Z33668 word-for-concept via Wikifunctions",
      lang: lang.iso,
      wfLang: lang.wfZid,
    },
  };
  const missing = [];
  const errors = [];
  let resolved = 0;

  for (let i = 0; i < tasks.length; i += CONCURRENCY) {
    const chunk = tasks.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map(async ({ key, m }) => {
      const r = await callZ33668(m.concept, lang.wfZid, m.category);
      return { key, m, r };
    }));
    for (const { key, m, r } of results) {
      if (r.ok) { catalog[key] = r.lemma; resolved++; }
      else if (r.missing) missing.push({ key, concept: m.concept, category: m.category, english: m.english });
      else errors.push({ key, concept: m.concept, category: m.category, reason: r.error });
    }
    process.stdout.write(`  ${Math.min(i + CONCURRENCY, tasks.length)}/${tasks.length}\r`);
  }
  console.log();

  catalog["@metadata"].coverage =
    `${resolved} resolved / ${tasks.length} attempted ` +
    `(${skipped} skipped, ${missing.length} missing, ${errors.length} errored, ${incomplete.length} incomplete mapping)`;

  await fs.writeFile(
    path.join(REPO, `i18n/${lang.iso}.json`),
    JSON.stringify(catalog, null, 2) + "\n"
  );
  await writeReport(lang, { resolved, missing, errors, skipped, incomplete, total: tasks.length });

  console.log(`  → i18n/${lang.iso}.json (${resolved} keys)`);
  console.log(`  → i18n/missing-lexemes.${lang.iso}.md (${missing.length} missing, ${errors.length} errored)`);
}

async function callZ33668(conceptQid, langZid, categoryQid) {
  const ck = cacheKey(conceptQid, langZid, categoryQid);
  if (callCache.has(ck)) return callCache.get(ck);
  const result = await callZ33668Uncached(conceptQid, langZid, categoryQid);
  callCache.set(ck, result);
  return result;
}

async function callZ33668Uncached(conceptQid, langZid, categoryQid) {
  const call = {
    Z1K1: "Z7",
    Z7K1: "Z33668",
    Z33668K1: { Z1K1: "Z6091", Z6091K1: conceptQid },
    Z33668K2: langZid,
    Z33668K3: { Z1K1: "Z6091", Z6091K1: categoryQid },
  };
  const body = new URLSearchParams({
    action: "wikilambda_function_call",
    format: "json",
    origin: "*",
    wikilambda_function_call_zobject: JSON.stringify(call),
  });
  for (let attempt = 0; attempt <= RETRY_MAX; attempt++) {
    try {
      const resp = await fetch(WF_API, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      if (resp.status === 429 || resp.status >= 500) {
        if (attempt < RETRY_MAX) {
          await sleep(RETRY_BASE_MS * 2 ** attempt);
          continue;
        }
        return { ok: false, error: `HTTP ${resp.status} after ${RETRY_MAX} retries` };
      }
      if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
      const outer = await resp.json();
      if (outer.error) return { ok: false, error: `${outer.error.code}: ${outer.error.info}` };
      const data = JSON.parse(outer.wikilambda_function_call.data);
      if (data.Z22K1 === "Z24") {
        let errType = "unknown";
        for (const p of data.Z22K2?.K1 || []) {
          if (p?.K1 === "errors") { errType = p.K2?.Z5K1 || "unknown"; break; }
        }
        // Z28158 (item has no statement with property) and Z28170 (empty list)
        // both indicate "no lexeme found" — missing data on Wikidata side.
        const missing = errType === "Z28158" || errType === "Z28170";
        return { ok: false, missing, error: errType };
      }
      const lemma = typeof data.Z22K1 === "string" ? data.Z22K1 : data.Z22K1?.Z6K1;
      if (typeof lemma !== "string" || !lemma) return { ok: false, error: "empty-lemma" };
      return { ok: true, lemma };
    } catch (e) {
      if (attempt < RETRY_MAX) {
        await sleep(RETRY_BASE_MS * 2 ** attempt);
        continue;
      }
      return { ok: false, error: e.message };
    }
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function writeReport(lang, { resolved, missing, errors, skipped, incomplete, total }) {
  const l = [];
  l.push(`# Missing lexemes — ${lang.iso} (${lang.native})`);
  l.push(``);
  l.push(`Generated by \`scripts/build-i18n.mjs\` on ${new Date().toISOString()}.`);
  l.push(``);
  l.push(`- **Resolved:** ${resolved} of ${total} attempted` +
    ` (${total === 0 ? "—" : ((resolved/total)*100).toFixed(1) + "%"})`);
  l.push(`- **Missing lexeme on Wikidata:** ${missing.length}`);
  l.push(`- **Other errors:** ${errors.length}`);
  l.push(`- **Skipped** (mapping marked \`skip: true\`): ${skipped}`);
  if (incomplete.length) l.push(`- **Incomplete mappings** (no concept/category): ${incomplete.length}`);
  l.push(``);
  if (missing.length) {
    l.push(`## Missing lexemes`);
    l.push(``);
    l.push(`Keys below map to a Wikidata concept, but no ${lang.native} lexeme`);
    l.push(`exists with \`P5137 → <concept>\` yet. Closing each gap means either:`);
    l.push(`(a) finding an existing lexeme and adding \`P5137\`, or (b) creating`);
    l.push(`the lexeme. Either way, the fix lives on Wikidata and benefits every`);
    l.push(`dogfooded tool, not just zblocks.`);
    l.push(``);
    l.push(`| UI key | Concept | Category | English reference |`);
    l.push(`|---|---|---|---|`);
    for (const m of missing) {
      l.push(`| \`${m.key}\` | [${m.concept}](https://www.wikidata.org/wiki/${m.concept}) | [${m.category}](https://www.wikidata.org/wiki/${m.category}) | ${m.english || "—"} |`);
    }
    l.push(``);
  }
  if (errors.length) {
    l.push(`## Call errors`);
    l.push(``);
    l.push(`| UI key | Concept | Category | Error |`);
    l.push(`|---|---|---|---|`);
    for (const e of errors) {
      l.push(`| \`${e.key}\` | ${e.concept || "—"} | ${e.category || "—"} | ${e.reason} |`);
    }
    l.push(``);
  }
  if (incomplete.length) {
    l.push(`## Incomplete mappings`);
    l.push(``);
    l.push(`These keys appear in \`mappings.json\` but don't yet have a concept + category.`);
    l.push(``);
    for (const i of incomplete) {
      l.push(`- \`${i.key}\`${i.english ? ` — ${i.english}` : ""}`);
    }
    l.push(``);
  }
  await fs.writeFile(path.join(REPO, `i18n/missing-lexemes.${lang.iso}.md`), l.join("\n"));
}

main().catch(e => { console.error(e); process.exit(1); });
