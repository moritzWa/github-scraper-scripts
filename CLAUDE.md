# GitHub Scraper - Project Guide

## Build & Run

- `npm run build` - compile TypeScript
- `npm run dev` - run scraper with hot reload (tsx watch)
- `npm run scrape` - run scraper once (no watch)

## Review Workflow

After the scraper has processed users, review top-rated profiles:

1. `npm run queue` - generate `output/review-queue.txt` with top unreviewed profiles
2. `npm run review 10` - open top 10 unreviewed LinkedIn profiles in browser
3. `npm run links 10` - print top 10 unreviewed LinkedIn URLs (no browser)
4. `npm run mark <user1> [user2 ...] --status outreach|discarded [--note 'reason']` - mark users as reviewed

**When the user asks to see the next batch of profiles, always open them directly in the browser (using `open` or `npm run review`). Never just copy URLs to clipboard.**

Re-rate existing users with updated criteria:
- `node dist/graph-scraper/scripts/re-rate-users.js --top 20` - re-rate top 20
- `node dist/graph-scraper/scripts/re-rate-users.js --top 20 --force-refetch-linkedin` - also refetch LinkedIn data

## Stuck Users

If the scraper is interrupted (Ctrl+C, crash, quota error), some users may get stuck in "processing" status. Reset them:

```js
// Run from project root:
node -e 'require("dotenv").config(); const { MongoClient } = require("mongodb"); (async () => { const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const r = await c.db(process.env.MONGODB_DB).collection("users").updateMany({ status: "processing" }, { $set: { status: "pending" } }); console.log(`Reset ${r.modifiedCount} users`); await c.close(); })()'
```

## Prompt/Criteria Changes

When the user gives feedback about a profile being ranked too high or too low, update the scoring criteria/prompt in `src/config/company.ts`. After making changes, **always verify by re-rating the profile that triggered the feedback**:

1. Edit criteria/prompt in `src/config/company.ts`
2. Run `npx tsc --noEmit` to verify it compiles
3. Run `npm run scrape-one <username>` to re-rate the specific user
4. Compare old vs new score and check that the problematic criteria changed as expected
5. If the score didn't change enough, iterate on the prompt

Test one specific user: `npm run scrape-one <username>`

## Google Sheets API

Auth via `gcloud` (requires prior `gcloud auth login` with a Google account that has sheet access). Then use Sheets API v4:
```bash
TOKEN=$(gcloud auth print-access-token)

# Read
curl -s "https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}/values/{SHEET_NAME}" \
  -H "Authorization: Bearer $TOKEN"

# Write (batch update)
curl -s -X POST "https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}/values:batchUpdate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"valueInputOption":"RAW","data":[{"range":"{SHEET_NAME}!A1","values":[["value"]]}]}'

# Append row
curl -s -X POST "https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}/values/{SHEET_NAME}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"values":[["col1","col2","col3"]]}'
```

## Key Config

- `src/config/company.ts` - scoring criteria, prompts, seed profiles, target archetypes
- `src/graph-scraper/core/scraper.ts` - scraper constants (batch size, depth, priority thresholds)
- Scoring: 13 criteria, weighted (startup_experience 5x, company_pedigree 4x, hireability/location/ai_agent_experience 3x, role_fit/financial_services/builder_signal 2x, seniority_fit 1x, experience_level 0x, rest 1x) + profile bonus (max 6: Twitter +3, followers>=200 +2, ratio>=5 +1) + stagnation bonus (max 6 for founders at old non-growing companies, max 3 for employees), max score 96
- Queue filters: linkedin required, startup_experience>=1, hireability>=1, builder_signal>=2
- Recompute scores after weight changes: `npx tsx src/graph-scraper/scripts/re-rate-users.ts --recompute-weights`
