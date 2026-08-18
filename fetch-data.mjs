import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

// ============================================================
// Configuration
// ============================================================

const CHARACTERS = [
  {
    name: "Doodypoop",
    realm: "Mal'Ganis",
    region: "us"
  },
  {
    name: "Doodypoopy",
    realm: "Mal'Ganis",
    region: "us"
  },
  {
    name: "Bawolstank",
    realm: "Mal'Ganis",
    region: "us"
  },
  {
    name: "Klittaurus",
    realm: "Mal'Ganis",
    region: "us"
  }
];

const SEASON_SLUG = "season-mn-2";

const DATA_DIR = path.join(process.cwd(), "data");
const SCORE_FILE = path.join(DATA_DIR, "score-history.json");
const RUNS_FILE = path.join(DATA_DIR, "runs.json");

const RAIDRIO_BASE = "https://raider.io/api/v1";

// ============================================================
// Helpers
// ============================================================

async function readJson(file, fallback) {
  try {
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  await mkdir(DATA_DIR, { recursive: true });

  await writeFile(
    file,
    JSON.stringify(data, null, 2) + "\n",
    "utf8"
  );
}

function characterId(character) {
  return `${character.region}-${character.realm}-${character.name}`
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
  console.log(`GET ${url}`);

  const response = await fetch(url);

  if (!response.ok) {
    const body = await response.text();

    throw new Error(
      `Raider.IO request failed: ${response.status} ${response.statusText}\n${body}`
    );
  }

  return response.json();
}

// ============================================================
// Raider.IO
// ============================================================

async function fetchCharacterData(character) {
  const profileUrl = new URL(`${RAIDRIO_BASE}/characters/profile`);

  profileUrl.searchParams.set("region", character.region);
  profileUrl.searchParams.set("realm", character.realm);
  profileUrl.searchParams.set("name", character.name);
  profileUrl.searchParams.set(
    "fields",
    "mythic_plus_scores_by_season:current"
  );

  const profile = await fetchJson(profileUrl);

  const score =
    profile.mythic_plus_scores_by_season?.[0]?.scores?.all ?? null;

  if (score === null) {
    throw new Error(
      `No Mythic+ score returned for ${character.name}-${character.realm}`
    );
  }

  return {
    profile,
    score
  };
}

async function fetchRecentRuns(character) {
  const url = new URL(`${RAIDRIO_BASE}/characters/mythic-plus-runs`);

  url.searchParams.set("region", character.region);
  url.searchParams.set("realm", character.realm);
  url.searchParams.set("name", character.name);
  url.searchParams.set("season", SEASON_SLUG);

  const data = await fetchJson(url);

  return data.mythic_plus_recent_runs ?? [];
}

async function fetchSeasonCutoff(character) {
  const url = new URL(`${RAIDRIO_BASE}/mythic-plus/season-cutoffs`);

  url.searchParams.set("region", character.region);
  url.searchParams.set("season", SEASON_SLUG);

  const data = await fetchJson(url);

  // Raider.IO's response contains the title cutoff information.
  // Use the first available cutoff value from the returned data.
  const cutoff =
    data.cutoffs?.[0]?.score ??
    data.cutoffs?.[0]?.value ??
    null;

  if (cutoff === null) {
    console.warn(
      `No season cutoff found for ${character.region}/${SEASON_SLUG}`
    );
  }

  return cutoff;
}

// ============================================================
// Score history
// ============================================================

async function updateScoreHistory(
  scoreHistory,
  character,
  score,
  cutoff,
  timestamp
) {
  const id = characterId(character);

  const date = getPacificDate(timestamp);

  const point = {
    characterId: id,
    character: character.name,
    realm: character.realm,
    region: character.region,
    date,
    timestamp: timestamp.toISOString(),
    score,
    cutoff
  };

  const existingIndex = scoreHistory.findIndex(
    entry =>
      entry.characterId === id &&
      entry.date === date
  );

  if (existingIndex >= 0) {
    scoreHistory[existingIndex] = point;

    console.log(
      `Updated ${character.name}: ${date} → ${score}`
    );
  } else {
    scoreHistory.push(point);

    console.log(
      `Added ${character.name}: ${date} → ${score}`
    );
  }
}

// ============================================================
// Run history
// ============================================================

async function updateRuns(runsHistory, character, recentRuns) {
  const id = characterId(character);

  let added = 0;

  for (const run of recentRuns) {
    const runId =
      run.keystone_run_id ??
      run.id ??
      run.run_id;

    if (!runId) {
      console.warn(
        `${character.name}: recent run did not contain a run ID`
      );
      continue;
    }

    const alreadyExists = runsHistory.some(
      existing =>
        existing.characterId === id &&
        String(existing.id) === String(runId)
    );

    if (alreadyExists) {
      continue;
    }

    runsHistory.push({
      characterId: id,
      character: character.name,
      realm: character.realm,
      region: character.region,
      id: runId,
      run
    });

    added++;
  }

  console.log(
    `${character.name}: added ${added} new run(s)`
  );
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log("========================================");
  console.log("Raider.IO data update");
  console.log(`Season: ${SEASON_SLUG}`);
  console.log(`Characters: ${CHARACTERS.length}`);
  console.log("========================================");

  const scoreHistory = await readJson(SCORE_FILE, []);
  const runsHistory = await readJson(RUNS_FILE, []);

  const timestamp = new Date();

  const cutoff = await fetchSeasonCutoff(CHARACTERS[0]);

  console.log(`Season cutoff: ${cutoff ?? "unknown"}`);

  for (const character of CHARACTERS) {
    console.log("");
    console.log(
      `===== ${character.name}-${character.realm} =====`
    );

    try {
      const { score } = await fetchCharacterData(character);

      console.log(`Score: ${score}`);

      await updateScoreHistory(
        scoreHistory,
        character,
        score,
        cutoff,
        timestamp
      );

      const recentRuns = await fetchRecentRuns(character);

      console.log(
        `Recent runs returned: ${recentRuns.length}`
      );

      await updateRuns(
        runsHistory,
        character,
        recentRuns
      );

    } catch (error) {
      console.error(
        `FAILED: ${character.name}-${character.realm}`
      );

      console.error(error);

      // Don't stop the other characters from updating.
    }
  }

  scoreHistory.sort((a, b) => {
    if (a.date !== b.date) {
      return a.date.localeCompare(b.date);
    }

    return a.characterId.localeCompare(b.characterId);
  });

  runsHistory.sort((a, b) => {
    const aTime = a.completedAt ?? "";
    const bTime = b.completedAt ?? "";

    return aTime.localeCompare(bTime);
  });

  await writeJson(SCORE_FILE, scoreHistory);
  await writeJson(RUNS_FILE, runsHistory);

  console.log("");
  console.log("========================================");
  console.log("Update complete");
  console.log(`Score history entries: ${scoreHistory.length}`);
  console.log(`Run history entries: ${runsHistory.length}`);
  console.log("========================================");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});