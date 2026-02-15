# Outreach Agent Guide

## Overview

Help Moritz reach out to engineering candidates found by the GitHub scraper. For each candidate: fetch their data, draft a personalized connection message, track in the Google Sheet, and send via LinkedIn/X/email.

## 1. Fetch Candidate Data

```bash
npm run lookup <github-username-or-linkedin-slug>
```

Returns JSON with: name, email, company, bio, location, rating, archetype, links (LinkedIn, X, blog), linkedinSummary, currentCompanyInsights, webResearch, criteriaScores, criteriaReasonings, and graph discovery data (discoveredVia, parentRatings, depth).

Key fields for message drafting:

- `linkedinSummary` - full career history, companies, roles, dates
- `criteriaReasonings` - per-criterion analysis (startup_experience, ai_agent_experience, builder_signal, etc.)
- `webResearch` - web research summary about the person
- `currentCompanyInsights` - company headcount, growth trends (useful for hireability context)
- `bio` / `xBio` - GitHub and X bios
- `blog` - personal website
- `topReferrer` - the highest-rated person who led us to this candidate in the GitHub graph, with their full name already resolved. Use this to mention a shared connection, e.g. "I noticed you follow Ishaan Dey on GitHub - small world!"
- `discoveredVia` - "following" (parent follows them) or "followers" (they follow the parent)
- `parentRatings` - all parents in the graph (topReferrer is the best one)

## 2. Web Search

Before drafting, do a quick web search for the person to find recent news, blog posts, or projects not captured in the DB. This helps personalize the message.

## 3. Draft Connection Message

**LinkedIn connection requests have a 300 character limit.** Always verify the exact character count programmatically (`echo -n "message" | wc -c`) - never estimate. LLMs are bad at counting characters.

Guidelines:

- Reference something specific and real about their work - check their actual website/repos, don't make claims you can't verify
- Mention Rogo is backed by Sequoia and Thrive Capital
- Keep it concise and to the point - no fluff or buzzwordsused th
- End with a soft ask to chat with Gabe (Rogo CEO)
- Never use emojis
- Fetch existing outreach messages from the Google Sheet (column B) and match the tone and style. Do NOT use hardcoded examples - always pull real ones from the sheet.

Personalization ideas (use what's relevant):

- A specific project/product they built with a concrete metric (e.g. "40k+ installs")
- Their founding/startup experience ("many ex-founders like yourself here")
- Number of mutual LinkedIn connections ("I noticed we have X mutuals")
- How they were discovered via the graph ("I noticed you follow [person] on GitHub")
- Their career background if relevant to Rogo (finance, AI, productivity tools)

## 4. Google Sheet Tracking

**Sheet ID**: `1HJeeQiF0KBf-S5PNLHMJhtdVbN6qoPjG6qUtvFuwgrA`
**Sheet name**: `Tabellenblatt1`
**Auth**: `gcloud auth print-access-token`

Current columns (A-O):

- A: Name
- B: Outreach Messages (the message sent to this person)
- C: Current/past companies
- D: Why interesting / potential role
- E: Scraper Score
- F: LinkedIn DM Moritz (date)
- G: X DM Moritz (date)
- H: Email Moritz (date)
- I: Status
- J: Location
- K: Email Address
- L: LinkedIn
- M: GitHub
- N: Twitter
- O: Other links

### Read sheet

```bash
curl -s "https://sheets.googleapis.com/v4/spreadsheets/1HJeeQiF0KBf-S5PNLHMJhtdVbN6qoPjG6qUtvFuwgrA/values/Tabellenblatt1" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)"
```

### Append a row

```bash
curl -s -X POST \
  "https://sheets.googleapis.com/v4/spreadsheets/1HJeeQiF0KBf-S5PNLHMJhtdVbN6qoPjG6qUtvFuwgrA/values/Tabellenblatt1:append?valueInputOption=USER_ENTERED" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d '{"values": [["Name", "outreach msg", "Companies", "Why interesting", "Score", "Feb 13", "", "", "reached out", "Location", "email@example.com", "https://linkedin.com/in/slug", "https://github.com/user", "@handle", ""]]}'
```

Always refetch the sheet before adding rows to check current layout and avoid duplicates.

## 5. Email Outreach

Email can be sent from moritz@rogo.ar via MCP (setup in progress - check if the email MCP server is available before attempting).

## 6. Company Context

Rogo is a Series C AI startup backed by Sequoia and Thrive Capital. We build productivity software for investment banking and private equity: AI-powered presentation generation, Excel automation, research agents, and financial data tools. CEO is Gabe Stengel (@GabeStengel). Based in NYC.
