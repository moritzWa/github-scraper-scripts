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

## Key Config

- `src/config/company.ts` - scoring criteria, prompts, seed profiles, target archetypes
- `src/graph-scraper/core/scraper.ts` - scraper constants (batch size, depth, priority thresholds)
- Scoring: 12 criteria, weighted (location 3x, seniority/hireability/role_fit 2x, rest 1x), max score 51
