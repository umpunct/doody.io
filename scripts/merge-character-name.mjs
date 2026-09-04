import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';

const SCORE_FILE = path.join(process.cwd(), 'data', 'score-history.json');
const RUNS_FILE = path.join(process.cwd(), 'data', 'runs.json');

function normalizeId(region, realm, name){
  return `${region}-${realm}-${name}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function readJson(file){
  try{ const raw = await readFile(file, 'utf8'); return JSON.parse(raw); }catch(e){ return []; }
}

async function writeJsonAtomic(file, data){
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  await writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  await writeFile(tmp, '', { flag: 'a' });
  await rename(tmp, file);
}

async function main(){
  const fromName = 'Klittaurus';
  const toName = 'Doodyysoup';

  const score = await readJson(SCORE_FILE);
  const runs = await readJson(RUNS_FILE);

  let scoreChanged = 0;
  let runsChanged = 0;
  let runsDeduped = 0;

  // Process score-history
  const scoreMap = new Map(); // key: date + characterId

  for(const entry of score){
    let character = entry.character;
    let realm = entry.realm || 'mal-ganis';
    let region = entry.region || 'us';

    if(character === fromName){
      character = toName;
      entry.character = toName;
      entry.characterId = normalizeId(region, realm, toName);
      scoreChanged++;
    }

    const key = `${entry.date}::${entry.characterId}`;
    const existing = scoreMap.get(key);
    if(!existing){
      scoreMap.set(key, entry);
    } else {
      // Keep the entry with the later timestamp
      const tExisting = new Date(existing.timestamp || 0).getTime();
      const tEntry = new Date(entry.timestamp || 0).getTime();
      if(tEntry > tExisting){
        scoreMap.set(key, entry);
      }
    }
  }

  const mergedScore = [...scoreMap.values()].sort((a,b)=>{
    const c = a.characterId.localeCompare(b.characterId);
    if(c!==0) return c;
    return a.date.localeCompare(b.date);
  });

  // Process runs: change character name and characterId, dedupe by run id
  const runMap = new Map(); // key runId

  for(const r of runs){
    const runOwner = r.character;
    let realm = r.realm || 'mal-ganis';
    let region = r.region || 'us';
    let character = runOwner;

    if(runOwner === fromName){
      character = toName;
      r.character = toName;
      r.characterId = normalizeId(region, realm, toName);
      runsChanged++;
    }

    const runId = r.id ?? (r.run && (r.run.keystone_run_id ?? r.run.id)) ?? null;
    if(runId == null){
      // keep as-is, create a random key
      const key = `__noid_${Math.random().toString(36).slice(2)}`;
      runMap.set(key, r);
      continue;
    }

    if(runMap.has(String(runId))){
      runsDeduped++;
      continue;
    }
    runMap.set(String(runId), r);
  }

  const mergedRuns = [...runMap.values()].sort((a,b)=>{
    const aTime = a.run?.completed_at ?? '';
    const bTime = b.run?.completed_at ?? '';
    return aTime.localeCompare(bTime);
  });

  await writeJsonAtomic(SCORE_FILE, mergedScore);
  await writeJsonAtomic(RUNS_FILE, mergedRuns);

  console.log('Score entries before:', score.length);
  console.log('Score entries after:', mergedScore.length);
  console.log('Score changed (renamed):', scoreChanged);
  console.log('Runs before:', runs.length);
  console.log('Runs after:', mergedRuns.length);
  console.log('Runs changed (renamed):', runsChanged);
  console.log('Runs deduped:', runsDeduped);
}

main().catch(err=>{ console.error(err); process.exit(1); });
