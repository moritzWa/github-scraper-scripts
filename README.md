# GitHub Scraper Scripts

A collection of GitHub data collection and analysis tools, featuring a **graph-based developer network scraper** as the primary component.

## 🕸️ Graph Scraper (Main Feature)

The graph scraper discovers and analyzes developer networks by following GitHub connections:

- **Network Discovery**: Recursively crawls GitHub followers/following relationships to build developer graphs ([scraper.ts](src/graph-scraper/core/scraper.ts))
- **AI-Powered Rating**: Uses OpenAI to evaluate developer profiles based on code quality, contributions, and expertise ([llm-rating.ts](src/graph-scraper/core/llm-rating.ts))
- **Graph Scoring**: Implements eigenvector centrality and weighted influence scoring ([graph-scoring.ts](src/graph-scraper/core/graph-scoring.ts))
- **Web Research**: Gathers additional context using OpenAI web search and Google Gemini ([web-research.ts](src/graph-scraper/core/scraper-helpers/web-research.ts))
- **LinkedIn Integration**: Enriches profiles with LinkedIn data via Brave search, RapidAPI, and Perplexity ([linkedin-research.ts](src/graph-scraper/core/scraper-helpers/linkedin-research.ts))
- **MongoDB Storage**: Stores graph data with optimized queries for large-scale analysis

### Key Scripts
- `npm run scrape` - Main graph scraper with connection discovery
- `npm run rate` - AI-powered profile rating system
- `npm run graph-scoring` - Calculate network influence scores
- `npm run best-rated-to-txt` - Export top-rated developers

## 🔧 Additional Tools

The repository also includes several utility scrapers:

- **Repository Interaction Scraper** (`src/repo-interaction-scraper/`) - Analyzes user interactions with specific repositories
- **Organization Scraper** (`src/testing/scrape-repos-from-organizations.ts`) - Extracts repositories and contributors from GitHub organizations
- **Contribution Analyzer** (`src/utils/analyze-contributions.ts`) - Detailed analysis of user contribution patterns

## Setup

1. Copy `.env.example` to `.env` and configure:
   ```
   # Required
   GITHUB_ACCESS_TOKEN=your_github_token
   MONGODB_URI=your_mongodb_connection
   OPENAI_API_KEY=your_openai_key

   # For enhanced LinkedIn research
   RAPIDAPI_KEY=your_rapidapi_key
   GOOGLE_API_KEY=your_google_key
   PERPLEXITY_API_KEY=your_perplexity_key
   BRAVE_API_KEY=your_brave_key
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start scraping:
   ```bash
   npm run scrape
   ```

The graph scraper uses multiple API services for comprehensive data collection:
- **OpenAI**: Profile rating and web research
- **Google Gemini**: Backup web research when OpenAI fails
- **Brave Search**: LinkedIn profile discovery
- **RapidAPI**: LinkedIn profile data extraction
- **Perplexity**: Alternative LinkedIn research method

## Output

Results are exported to the `output/` directory as structured text files with top-rated developer profiles and network analysis.