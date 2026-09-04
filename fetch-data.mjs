// fetch-data.mjs
//
// Fetches current Mythic+ score, season cutoff, and recent Mythic+ runs
// for multiple characters.
//
// Score history:
//   One point per character per Pacific calendar day.
//   Multiple fetches on the same day replace that day's point.
//
// Run history:
//   Stores the raw Raider.IO run response, plus the character that
//   the run was found under. Runs are de-duplicated by keystone_run_id.
//
// Requires Node 18+.

import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";

// ============================================================
// CONFIG
// ============================================================

const REGION = "us";
const REALM = "mal-ganis";
const SEASON = "season-mn-2";

// Characters can be specified as strings (name) which use the default
// `REALM` and `REGION`, or as objects with `{ name, realm, region }`
// to track characters on other realms/regions.
const CHARACTERS = [
  { name: "Doodypoop", realm: "mal-ganis", region: "us" },
  { name: "Doodypoopy", realm: "mal-ganis", region: "us" },
  { name: "Bawolstank", realm: "mal-ganis", region: "us" },
  { name: "Doodyysoup", realm: "mal-ganis", region: "us" },
  // Add Zellaraa on Sargeras
  { name: "Zellaraa", realm: "sargeras", region: "us" }
];

const SCORE_FILE = path.join(
  process.cwd(),
  "data",
  "score-history.json"
);

const TITLE_CUTOFF_FILE = path.join(
  process.cwd(),
  "data",
  "title-cutoff.json"
);

const RUNS_FILE = path.join(
  process.cwd(),
  "data",
  "runs.json"
);

// ============================================================
// Helpers
// ============================================================

async function readJson(file, fallback) {
  try {
    const raw = await readFile(file, "utf-8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  await mkdir(path.dirname(file), { recursive: true });

  // Atomic write: write to temp file then rename to avoid partial writes
  const tmp = file + ".tmp";
  await writeFile(
    tmp,
    JSON.stringify(data, null, 2) + "\n",
    "utf-8"
  );
  await writeFile(tmp, "", { flag: "a" }); // ensure file is flushed to disk by closing
  await rename(tmp, file);
}

function getCharacterId(region, realm, characterName) {
  return `${region}-${realm}-${characterName}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function getPacificDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

async function fetchJson(url) {
  const res = await fetch(url);

  if (!res.ok) {
    const body = await res.text();

    throw new Error(
      `Request failed: ${res.status} ${res.statusText}\n${body}`
    );
  }

  return res.json();
}

// ============================================================
// Raider.IO
// ============================================================

async function fetchCharacterData(characterName, realm, region) {
  const url =
    `https://raider.io/api/v1/characters/profile` +
    `?region=${region}` +
    `&realm=${realm}` +
    `&name=${encodeURIComponent(characterName)}` +
    `&fields=mythic_plus_scores_by_season:current,mythic_plus_recent_runs`;

  const json = await fetchJson(url);

  const current = json.mythic_plus_scores_by_season?.[0];

  const score = current?.scores?.all;

  if (score === undefined) {
    throw new Error(
      `Could not find Mythic+ score for ${characterName}`
    );
  }

  const recentRuns =
    json.mythic_plus_recent_runs ?? [];

  return {
    score,
    recentRuns
  };
}

async function fetchSeasonCutoff() {
  const url =
    `https://raider.io/api/v1/mythic-plus/season-cutoffs` +
    `?season=${SEASON}&region=${REGION}`;

  const json = await fetchJson(url);

  const cutoff =
    json.cutoffs?.p999?.all?.quantileMinValue;

  if (cutoff === undefined) {
    throw new Error(
      "Could not find season cutoff at " +
      "cutoffs.p999.all.quantileMinValue"
    );
  }

  return cutoff;
}

// ============================================================
// Score history
// ============================================================

function updateScoreHistory(
  scoreHistory,
  characterName,
  realm,
  region,
  score,
  timestamp
) {
  const characterId =
    getCharacterId(region, realm, characterName);

  const date = getPacificDate(timestamp);

  const point = {
    characterId,
    character: characterName,
    realm,
    region,
    date,
    timestamp: timestamp.toISOString(),
    score
  };

  const existingIndex =
    scoreHistory.findIndex(
      entry =>
        entry.characterId === characterId &&
        entry.date === date
    );

  if (existingIndex >= 0) {
    scoreHistory[existingIndex] = point;

    console.log(
      `${characterName}: updated ${date} → ${score}`
    );
  } else {
    scoreHistory.push(point);

    console.log(
      `${characterName}: added ${date} → ${score}`
    );
  }
}

function updateTitleCutoffHistory(
  cutoffHistory,
  cutoff,
  timestamp
) {
  const date = getPacificDate(timestamp);

  const point = {
    date,
    timestamp: timestamp.toISOString(),
    cutoff
  };

  const existingIndex =
    cutoffHistory.findIndex(
      entry => entry.date === date
    );

  if (existingIndex >= 0) {
    cutoffHistory[existingIndex] = point;
    console.log(
      `Title cutoff: updated ${date} → ${cutoff}`
    );
  } else {
    cutoffHistory.push(point);
    console.log(
      `Title cutoff: added ${date} → ${cutoff}`
    );
  }
}

// ============================================================
// Run history
// ============================================================

function getRunId(run) {
  return (
    run.keystone_run_id ??
    run.id ??
    null
  );
}

function updateRuns(
  runsHistory,
  characterName,
  realm,
  region,
  recentRuns
) {
  const characterId =
    getCharacterId(region, realm, characterName);

  let added = 0;

  for (const run of recentRuns) {
    const runId = getRunId(run);

    if (!runId) {
      console.warn(
        `${characterName}: run had no keystone_run_id`
      );
      continue;
    }

    const alreadyExists =
      runsHistory.some(
        existing =>
          String(existing.id) === String(runId)
      );

    if (alreadyExists) {
      continue;
    }

    runsHistory.push({
      id: runId,
      characterId,
      character: characterName,
      realm,
      region,
      run
    });

    added++;
  }

  console.log(
    `${characterName}: ${recentRuns.length} recent run(s), ` +
    `${added} new run(s)`
  );

  return added;
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log("========================================");
  console.log("Raider.IO data update");
  console.log(`Season: ${SEASON}`);
  const characterList = CHARACTERS
    .map(entry => typeof entry === "string" ? entry : entry.name)
    .join(", ");
  console.log(`Characters: ${characterList}`);
  console.log("========================================");

  const timestamp = new Date();

  const scoreHistory =
    await readJson(SCORE_FILE, []);

  const cutoffHistory =
    await readJson(TITLE_CUTOFF_FILE, []);

  const runsHistory =
    await readJson(RUNS_FILE, []);

  // The cutoff is regional/season-wide, so only fetch it once.
  const cutoff =
    await fetchSeasonCutoff();

  console.log(`Season cutoff: ${cutoff}`);

  updateTitleCutoffHistory(
    cutoffHistory,
    cutoff,
    timestamp
  );

  let totalNewRuns = 0;

  for (const entry of CHARACTERS) {
    const {
      name: characterName,
      realm = REALM,
      region = REGION
    } = typeof entry === "string" ? { name: entry } : entry;

    console.log("");
    console.log(
      `===== ${characterName}-${realm} (${region}) =====`
    );

    try {
      const {
        score,
        recentRuns
      } = await fetchCharacterData(
        characterName,
        realm,
        region
      );

      console.log(
        `${characterName} score: ${score}`
      );

      // One point per Pacific calendar day.
      updateScoreHistory(
        scoreHistory,
        characterName,
        realm,
        region,
        score,
        timestamp
      );

      // Store raw Raider.IO runs.
      totalNewRuns += updateRuns(
        runsHistory,
        characterName,
        realm,
        region,
        recentRuns
      );

    } catch (error) {
      console.error(
        `FAILED: ${characterName} (${realm})`
      );

      console.error(error);
    }
  }

  // Keep score history organized by character/date.
  scoreHistory.sort((a, b) => {
    const characterCompare =
      a.characterId.localeCompare(
        b.characterId
      );

    if (characterCompare !== 0) {
      return characterCompare;
    }

    return a.date.localeCompare(b.date);
  });

  cutoffHistory.sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  // Keep runs chronologically ordered when possible.
  runsHistory.sort((a, b) => {
    const aTime =
      a.run?.completed_at ?? "";

    const bTime =
      b.run?.completed_at ?? "";

    return aTime.localeCompare(bTime);
  });

  await writeJson(
    SCORE_FILE,
    scoreHistory
  );

  await writeJson(
    TITLE_CUTOFF_FILE,
    cutoffHistory
  );

  await writeJson(
    RUNS_FILE,
    runsHistory
  );

  console.log("");
  console.log("========================================");
  console.log("Update complete");
  console.log(
    `Score history: ${scoreHistory.length} entries`
  );
  console.log(
    `Title cutoff history: ${cutoffHistory.length} entries`
  );
  console.log(
    `Runs: ${runsHistory.length} entries`
  );
  console.log(
    `New runs this update: ${totalNewRuns}`
  );
  console.log("========================================");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});