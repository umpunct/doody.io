// fetch-data.mjs
//
// Fetches a character's current Mythic+ score, the region's current season
// title cutoff, and their 10 most recent runs from the raider.io public API.
//
// - Appends a timestamped score/cutoff point to data/score-history.json
// - Merges any new runs (de-duplicated by run id) into data/runs.json,
//   including who else was in each group — this is what powers the
//   "who does he actually play with" tracking.
//
// Docs: https://raider.io/api
// Rate limit: 200+ requests/minute unauthenticated — running this a few
// times an hour is nowhere close to a concern.
//
// Run locally with:  node fetch-data.mjs
// Requires Node 18+ (built-in fetch). GitHub Actions runners already have this.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

// ---- CONFIG: edit these for your friend's character ----------------------
const REGION = "us";          // us, eu, kr, tw, cn
const REALM = "mal-ganis";    // realm slug, spaces/apostrophes stripped, lowercase, hyphenated
const CHARACTER_NAME = "Doodypoop";
const SEASON = "season-mn-1"; // current season slug used by raider.io's cutoffs pages
// ----------------------------------------------------------------------------

const SCORE_FILE = path.join(process.cwd(), "data", "score-history.json");
const RUNS_FILE = path.join(process.cwd(), "data", "runs.json");

async function fetchCharacterData() {
  const url =
    `https://raider.io/api/v1/characters/profile` +
    `?region=${REGION}&realm=${REALM}&name=${encodeURIComponent(CHARACTER_NAME)}` +
    `&fields=mythic_plus_scores_by_season:current,mythic_plus_recent_runs`;

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Character fetch failed: ${res.status} ${res.statusText}\nResponse body: ${body}`);
  }
  const json = await res.json();
  console.log(JSON.stringify(json.mythic_plus_recent_runs?.[0], null, 2));

  // Uncomment to inspect the full raw shape if fields below ever stop matching:
  // console.log(JSON.stringify(json, null, 2));

  const current = json.mythic_plus_scores_by_season?.[0];
  const score = current?.scores?.all;
  if (score === undefined) {
    throw new Error(
      "Could not find score at mythic_plus_scores_by_season[0].scores.all — " +
      "log the raw response above and adjust the path."
    );
  }

  const recentRuns = json.mythic_plus_recent_runs ?? [];

  return { score, recentRuns };
}

async function fetchSeasonCutoff() {
  const url =
    `https://raider.io/api/v1/mythic-plus/season-cutoffs` +
    `?season=${SEASON}&region=${REGION}`;

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Cutoff fetch failed: ${res.status} ${res.statusText}\nResponse body: ${body}`);
  }
  const json = await res.json();

  // Confirmed field (found via debugging): cutoffs.p999.all.quantileMinValue
  const cutoff = json.cutoffs?.p999?.all?.quantileMinValue;

  if (cutoff === undefined) {
    throw new Error(
      "Could not find cutoff at cutoffs.p999.all.quantileMinValue — " +
      "log the raw response and adjust the path (raider.io occasionally " +
      "renames fields between seasons)."
    );
  }
  return cutoff;
}

async function readJson(file, fallback) {
  try {
    const raw = await readFile(file, "utf-8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function runKey(run) {
  // keystone_run_id is the stable unique id raider.io assigns to a run.
  // Fall back to a composite key if it's ever missing.
  return run.keystone_run_id ?? `${run.dungeon}-${run.completed_at}-${run.mythic_level}`;
}

function normalizeRun(run) {
  const roster = (run.roster ?? []).map((entry) => ({
    name: entry.character?.name,
    realm: entry.character?.realm,
    class: entry.character?.class,
    spec: entry.character?.spec,
    role: entry.role,
  }));

  return {
    id: runKey(run),
    dungeon: run.dungeon ?? run.short_name,
    level: run.mythic_level,
    score: run.score,
    completedAt: run.completed_at,
    timeMs: run.clear_time_ms,
    numUpgrades: run.num_keystone_upgrades,
    roster,
  };
}

async function main() {
  await mkdir(path.dirname(SCORE_FILE), { recursive: true });

  const [charData, cutoff] = await Promise.all([
    fetchCharacterData(),
    fetchSeasonCutoff(),
  ]);

  // --- score/cutoff history: one point per fetch, no de-duping by day,
  //     since you're now running this several times a day ---
  const scoreHistory = await readJson(SCORE_FILE, []);
  scoreHistory.push({
    timestamp: new Date().toISOString(),
    score: charData.score,
    cutoff,
  });
  await writeFile(SCORE_FILE, JSON.stringify(scoreHistory, null, 2));

  // --- run history: merge in any runs we haven't recorded yet ---
  const existingRuns = await readJson(RUNS_FILE, []);
  const seenIds = new Set(existingRuns.map((r) => r.id));

  let newCount = 0;
  for (const rawRun of charData.recentRuns) {
    const normalized = normalizeRun(rawRun);
    if (!seenIds.has(normalized.id)) {
      existingRuns.push(normalized);
      seenIds.add(normalized.id);
      newCount++;
    }
  }

  existingRuns.sort((a, b) => (a.completedAt ?? "").localeCompare(b.completedAt ?? ""));
  await writeFile(RUNS_FILE, JSON.stringify(existingRuns, null, 2));

  console.log(
    `Recorded score point: score=${charData.score} cutoff=${cutoff} | ` +
    `${newCount} new run(s) added (${existingRuns.length} total tracked)`
  );

  if (charData.recentRuns.length === 10 && newCount === 10) {
    console.warn(
      "WARNING: all 10 fetched runs were new — you may have missed runs " +
      "between fetches. Consider increasing fetch frequency."
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
