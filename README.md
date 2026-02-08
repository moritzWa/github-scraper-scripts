# GitHub Scraper Scripts

A graph-based developer network scraper that discovers and evaluates engineering talent by crawling GitHub connections. Fully configurable for any company's hiring criteria.

## How It Works

The scraper uses a **priority-queue graph traversal** starting from seed GitHub profiles:

1. **Seed profiles** are added with maximum priority
2. Each user is scraped, enriched with LinkedIn/web data, and rated by an LLM against your criteria
3. High-scoring users' connections are discovered and added to the queue with computed priority
4. Priority formula: `parentRating * directionMultiplier / sqrt(depth)`
   - "Following" edges get 1.5x (parent vouches for this user - strong signal)
   - "Follower" edges get 0.7x (weaker signal - anyone can follow)
5. The scraper processes users in priority order, focusing effort on the most promising branches

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

- `npm run scrape` - Main graph scraper with priority-based connection discovery
- `npm run best-rated-to-txt` - Export top-rated profiles to `output/`
- `npm run rate` - Re-rate existing users with updated criteria
- `npm run graph-scoring` - Calculate network influence scores

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
  output-gen/
    best_rated_to_txt.ts               # Export top profiles
```

## API Services

- **OpenAI** - Profile rating (structured output with per-criterion reasoning) and web research
- **Brave Search** - LinkedIn profile URL discovery
- **RapidAPI** (Fresh LinkedIn Profile Data) - LinkedIn experience/education extraction and company insights (headcount, growth trends)
- **Google Gemini** - Backup web research

The scraper exits gracefully when RapidAPI credits are exhausted (HTTP 402/429).

## Output

Results are exported to `output/` as text files with ranked profiles, per-criterion scores, and reasoning.
