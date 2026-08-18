# Mythic+ Score Tracker

Tracks a WoW character's Raider.IO Mythic+ score against the current season's
title cutoff for their region, and plots both over time.

Data source: the public [Raider.IO API](https://raider.io/api) — no API key required.

## How it works

- `fetch-data.mjs` — Node script that calls raider.io, reads the character's
  current score and the region's current title cutoff, and appends a
  timestamped point to `data/data.json`.
- `.github/workflows/update-data.yml` — GitHub Action that runs the script
  once a day (cron) and commits the updated `data.json` back to the repo.
- `index.html` — static page that reads `data/data.json` and renders a chart
  with [Chart.js](https://www.chartjs.org/).

## Setup

1. **Create a new GitHub repo** and push these files to it.

2. **Edit the config in `fetch-data.mjs`:**
   ```js
   const REGION = "us";
   const REALM = "area-52";
   const CHARACTER_NAME = "YourFriendsCharName";
   const SEASON = "season-mn-1";
   ```
   - `REALM` is the realm slug (lowercase, spaces become hyphens — e.g. "Area 52" → `area-52`).
   - `SEASON` should match the slug raider.io uses on its cutoffs page, e.g.
     `https://raider.io/mythic-plus/cutoffs/season-mn-1-cutoffs/us` → `season-mn-1`.
     This changes each new season, so update it when a new season starts.

3. **First run — verify the response shape.** Raider.io's exact JSON field
   names can shift between seasons. Run once locally to confirm before you
   rely on the automation:
   ```bash
   node fetch-data.mjs
   ```
   If it errors saying it can't find the score or cutoff field, uncomment the
   `console.log(JSON.stringify(json, null, 2))` line in the relevant function
   in `fetch-data.mjs`, re-run, and adjust the property path to match what
   comes back.

4. **Enable GitHub Pages:**
   - Repo → Settings → Pages
   - Source: "Deploy from a branch"
   - Branch: `main`, folder: `/ (root)`
   - Save. Your site will be live at `https://<username>.github.io/<repo-name>/`

5. **Enable the scheduled fetch:**
   - The workflow in `.github/workflows/update-data.yml` runs daily at 12:00 UTC
     and needs no extra setup — GitHub Actions is enabled by default on public
     repos, and the `permissions: contents: write` line lets it commit back to
     the repo.
   - You can trigger it manually anytime from the repo's **Actions** tab →
     "Update Raider.IO data" → **Run workflow** (this is how you can force
     the first data point in without waiting a day).

## Adjusting the schedule

Edit the cron line in the workflow file. Cron time is UTC. Examples:
- Every 6 hours: `0 */6 * * *`
- Twice daily: `0 6,18 * * *`

## Notes

- Raider.io's rate limits are generous for this kind of low-frequency,
  single-character polling — daily or even hourly is well within bounds.
- No secrets or API keys are needed anywhere in this project.
