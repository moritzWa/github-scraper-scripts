# GitHub Scraper Scripts

A graph-based developer network scraper that discovers and evaluates engineering talent by crawling GitHub connections. Fully configurable for any company's hiring criteria.

## Key Features

- **Best-first graph traversal** - Priority queue (not BFS/DFS) explores the most promising branches first. Priority = `(0.7 * parentRating + 0.3 * grandparentRating) * directionMultiplier / sqrt(depth)`. Strong lineages get explored first. Currently following-only (follower scraping disabled - too noisy).
- **Company insights for hireability** - Fetches real LinkedIn company data (headcount, growth trends, founding year) for all users with LinkedIn data. A founder at a company growing 100% YoY is unhireable; a founder of a stagnating 3-person company might be ready to move. Non-founders at shrinking companies also get a smaller bonus.
- **LinkedIn profile matching** - LLM-generated query to find LinkedIn profiles by searching Brave with queries built from GitHub/X/email/website data. Skips unsearchable profiles (e.g., first-name-only). Verifies fetched profiles against GitHub data and discards mismatches.
- **Contribution pattern filters** - Before expensive LinkedIn/LLM calls, filters out candidates based on GitHub activity: minimum contribution threshold, active in 8+ months of the year, and a weekday-coder detector (>85% weekday-only activity suggests they only code at work, not a passionate builder).
- **Structured LLM scoring** - Configurable weighted criteria scored 0-3 with per-criterion reasoning via OpenAI structured output.

## How It Works

The scraper uses a **priority-queue graph traversal** starting from seed GitHub profiles:

1. **Seed profiles** are added with maximum priority
2. Each user is scraped, enriched with LinkedIn/web data, and rated by an LLM against your criteria
3. High-scoring users' connections are discovered and added to the queue with computed priority
4. Priority formula: `effectiveRating * directionMultiplier / sqrt(depth)`, where `effectiveRating = 0.7 * parentRating + 0.3 * grandparentRating`
   - Currently following-only (follower scraping disabled). Following multiplier: 0.8
   - Lineage blending means a strong grandparent boosts priority even if the parent is mediocre
   - Queue selection also weights by best parent rating: `effectivePriority = priority + maxParentRating`
5. The scraper processes users in priority order, focusing effort on the most promising branches
6. Seed profiles (depth 0) bypass all filters and their connections get boosted priority

MongoDB serves as the persistent priority queue, enabling crash recovery and incremental runs.

## Configuration

All company-specific settings live in [`src/config/company.ts`](src/config/company.ts). To adapt for your company:

1. **Duplicate and edit** `company.ts` with your:
   - Company name, description, and GitHub org
   - **Scoring criteria** - define as many as you want, each scored 0-3 by the LLM with tier descriptions
   - **Engineer archetypes** - categories for classification (e.g., full-stack, backend, ML engineer)
   - **Seed profiles** - starting points for graph traversal
   - **Team members** - excluded from results
   - **Rating prompt** - the full LLM prompt with examples (use `{ARCHETYPES}` and `{CRITERIA}` placeholders)

2. The scoring system is fully dynamic - `maxTierSum` is computed automatically from your criteria count. Add or remove criteria and everything adjusts.

### Example criterion definition:

```typescript
{
  key: 'ai_agent_experience',
  label: 'AI / Agent Experience',
  tiers: {
    0: 'No AI/ML experience',
    1: 'General interest, courses, or minor AI/ML projects',
    2: 'Built AI-powered tools or applied ML/LLMs in a real product',
    3: 'Shipped AI agents, RAG systems, or research automation in production',
  },
}
```

## Setup

1. Copy `.env.example` to `.env` and configure:

   ```
   # Required
   GITHUB_ACCESS_TOKEN=your_github_token
   MONGODB_URI=your_mongodb_connection
   MONGODB_DB=your_db_name
   OPENAI_API_KEY=your_openai_key

   # For LinkedIn enrichment
   RAPIDAPI_KEY=your_rapidapi_key
   BRAVE_API_KEY=your_brave_key

   # Optional (backup web research)
   GOOGLE_API_KEY=your_google_key
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Start scraping:
   ```bash
   npm run scrape
   ```

## Key Scripts

- `npm run scrape` - Main graph scraper (one-shot)
- `npm run dev` - Main graph scraper with hot reload (tsx watch)
- `npm run rate` - Re-rate existing users with updated criteria
- `npm run graph-scoring` - Calculate network influence scores

### Review workflow

- `npm run queue` - Generate `output/review-queue.txt` with top unreviewed profiles
- `npm run review 10` - Open top 10 unreviewed LinkedIn profiles in browser
- `npm run links 10` - Print top 10 unreviewed LinkedIn URLs
- `npm run mark <user1> [user2 ...] --status outreach|discarded [--note 'reason']` - Mark users as reviewed

### Re-rating users

The re-rate script supports CLI flags:

```bash
# Re-rate all processed users
node dist/graph-scraper/scripts/re-rate-users.js

# Re-rate only the top 10 highest-scored users
node dist/graph-scraper/scripts/re-rate-users.js --top 10

# Force refetch LinkedIn data (needed after adding company URL extraction)
node dist/graph-scraper/scripts/re-rate-users.js --top 10 --force-refetch-linkedin
```

`--force-refetch-linkedin` re-fetches LinkedIn profiles, experience summaries, and company insights even if they already exist in the DB. Useful when the LinkedIn data extraction has been updated (e.g., new fields like company URLs).

## Architecture

```
src/config/company.ts                  # Company config, criteria, prompts
src/graph-scraper/
  core/
    scraper.ts                         # Main loop, config, stats (~250 lines)
    llm-rating.ts                      # OpenAI structured output rating
    scraper-helpers/
      process-user.ts                  # Scrape + rate + discover connections
      discover-connections.ts          # Priority computation, edge/user upsert
      linkedin-research.ts             # RapidAPI + Brave LinkedIn lookup
      scrape-user.ts                   # Full user scrape pipeline
      web-research.ts                  # OpenAI/Gemini web research
      fetch-connections.ts             # GitHub API pagination
      filters.ts                       # Contribution/profile filters
  scripts/
    re-rate-users.ts                   # Re-rate with updated criteria
    mark-reviewed.ts                   # Mark users as outreach/discarded
    review-batch.ts                    # Open LinkedIn profiles in browser
    print-links.ts                     # Print LinkedIn URLs
  output-gen/
    best_rated_to_txt.ts               # Export top unreviewed profiles
```

## API Services

- **OpenAI** - Profile rating (structured output with per-criterion reasoning) and web research
- **Brave Search** - LinkedIn profile URL discovery
- **RapidAPI** (Fresh LinkedIn Profile Data) - LinkedIn experience/education extraction and company insights (headcount, growth trends)
- **Google Gemini** - Backup web research

The scraper exits gracefully when RapidAPI credits are exhausted (HTTP 402/429).

## Output

Results are exported to `output/` as text files with ranked profiles, per-criterion scores, and reasoning.

## Iteration History

This section documents the key improvements made to the scraper over time, what problems they solved, and why. Useful context for anyone continuing work on this.

### Scoring improvements

**Criteria weight rebalancing** - Initial uniform weights didn't match actual hiring preferences. Rebalanced to heavily weight startup_experience (5x) and company_pedigree (4x), while disabling experience_level (0x) since it wasn't predictive.

**Profile bonus (computed, no LLM)** - Added bonus points for having a Twitter account (+3), high GitHub followers (+2 for >=200), and high follower/following ratio (+1 for >=5). These are strong signals the LLM can't assess from profile text alone. Max 6 points.

**Stagnation bonus** - Founders of old, non-growing companies are more hireable. Fetches company insights (headcount, growth, founding year) from RapidAPI's company insights endpoint. Founders get up to 6 bonus points (company age + shrinking headcount + tiny team). Later expanded to non-founders (max 3). Uses LinkedIn `start_year` as fallback when `founded_on.year` isn't available from the API.

**Queue post-rating filters** - Added minimum score requirements for specific criteria (startup_experience >= 1, hireability >= 1, builder_signal >= 2) to filter out profiles that pass overall but miss key requirements.

### Queue/priority improvements

**Following-only scraping** - Disabled follower scraping after analysis showed followers are too noisy. Anyone can follow a high-scorer, but who someone chooses to follow is a deliberate signal. This was the single biggest quality improvement.

**Parent rating gating** - The original `MIN_PRIORITY = 5` floor let ~1.1M users through. Analysis showed higher priority actually predicted WORSE quality because the multi-parent bonus was broken. Replaced with `MIN_BEST_PARENT_RATING = 50` - require at least one parent who scored well.

**Multi-parent bonus removed** - Initially boosted priority for users discovered by multiple parents. Data showed this predicted worse quality (users followed by many mediocre people are just popular). Replaced with max-parent-weighted effective priority: `priority + maxParentRating * weight`.

**Depth 1 free pass** - Direct connections of seed profiles bypass the `MIN_BEST_PARENT_RATING` gate since seeds are manually curated and may not score well on automated criteria.

**Seed priority boost** - Seeds often score low on our specific criteria but their connections are valuable. Depth 0 users now pass `Math.max(rating, 60)` as parent rating when discovering connections, so depth 1 users get priority ~48 instead of ~12 and aren't buried behind the existing queue.

**Re-queue filter** - Processed users with unscraped connections were re-queued regardless of score, wasting batch slots. Added `rating >= minRatingToScrapeConnections` to only re-queue high scorers.

### Reliability improvements

**RapidAPI retry logic** - LinkedIn fetch timeouts used to silently return null, causing users to be rated without LinkedIn context. Added retry logic (3 attempts, 5s delay) for transient errors (timeouts, connection resets). After retries exhausted, throws so the user gets re-queued as pending instead of rated with incomplete data.

**Transient error re-queuing** - `processUserFromBatch` now distinguishes transient errors (network timeouts) from permanent failures. Transient errors reset the user to "pending" for retry; permanent failures mark as "ignored".

**Background index building** - Compound index on `{status, parentRatings.rating, priority}` blocked scraper startup on the 1M+ doc collection. Fixed with `{ background: true }`.

**Socket timeout** - Increased MongoDB socket timeout from 45s to 120s to handle slow queries during DB initialization on large collections.
