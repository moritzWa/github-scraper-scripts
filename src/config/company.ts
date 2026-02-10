// Company-specific configuration for the GitHub scraper.
// To adapt this scraper for a different company, duplicate this file and update the values.
//

export interface CriterionDefinition {
  key: string;
  label: string;
  tiers: { [tier: number]: string };
  weight?: number; // Default 1. Higher weight = more impact on total score.
}

export const companyConfig: {
  name: string;
  description: string;
  githubOrg: string;
  engineerArchetypes: string[];
  criteria: CriterionDefinition[];
  // Maximum possible sum of tier scores (for normalization if needed)
  maxTierSum: number;
  teamMembers: string[];
  seedProfiles: string[];
  ratingPrompt: string;
} = {
  name: 'Rogo',
  description:
    'AI platform for investment banking and private equity - presentation generation, Excel automation, and investment research',
  githubOrg: 'rogodata',

  // Engineer archetypes used for classification
  engineerArchetypes: [
    'full-stack',
    'frontend',
    'backend/infra',
    'ML engineer',
    'AI engineer',
    'AI researcher/scientist',
    'data engineer',
    'Other',
    'None',
  ],

  // Scoring criteria with tier definitions.
  // Each criterion is scored 0-3 by the LLM.
  // The final score is the simple sum of all criterion scores.
  criteria: [
    {
      key: 'startup_experience',
      label: 'Startup Experience',
      weight: 3,
      tiers: {
        0: 'No startup experience or non-technical startup roles',
        1: 'Worked at a startup in a hands-on engineering role, but not a well-known or fast-growing one. Indie hackers and solo SaaS builders without significant traction also fall here.',
        2: 'Founding engineer or early engineer at a startup with some validation (known investors, meaningful revenue, or growing team)',
        3: 'Founded or co-founded a productivity/AI/fintech startup with strong validation (tier-1 VC funding, acquisition, significant traction)',
      },
    },
    {
      key: 'ai_agent_experience',
      label: 'AI / Agent Experience',

      tiers: {
        0: 'No AI or agent experience',
        1: 'General interest, courses, or minor AI or agent projects',
        2: 'Built AI-powered tools or applied AI or agent in a real product',
        3: 'Shipped AI agents, RAG systems, text-to-SQL, document processing, or research automation in production',
      },
    },
    {
      key: 'productivity_software',
      label: 'Productivity Software',

      tiers: {
        0: 'No relevant experience building productivity software. Simple/non-innovative tools (calculators, basic CRUD apps, static sites, portfolio pages) do not count.',
        1: 'Minor or dated experience - a single old project (3+ years ago), or generic dev tools (CLIs, linters, frameworks, libraries) that are not knowledge-work productivity tools',
        2: 'Has built productivity software that helps people get work done faster: document editing, note-taking, workflow automation, BI tools, text-to-SQL, AI-assisted coding tools, search engines, data analysis platforms, or domain-specific workflow tools (e.g. IB deal flow, legal research). Shipped at a company or as a side project with real users.',
        3: 'Deep, recent experience (last 2-3 years) building innovative productivity tools. Examples: core features of Notion, Figma, Linear, Cursor/Claude Code, Superhuman, Airtable; or building text-to-SQL engines, AI research automation, or complex domain-specific workflow software.',
      },
    },
    {
      key: 'financial_services',
      label: 'Financial Services Domain',
      weight: 2,
      tiers: {
        0: 'No exposure to financial services',
        1: 'Minor exposure or interest in finance, banking, or trading',
        2: 'Worked at a financial services company or built financial tools',
        3: 'Deep hands-on engineering for investment banking, private equity, trading, or hedge fund software',
      },
    },
    {
      key: 'education',
      label: 'Education',

      tiers: {
        0: 'Degree from an unknown or low-reputation university with no notable CS/engineering program',
        1: 'No degree / dropped out, OR degree from a decent but unremarkable university',
        2: 'Degree from a top-tier CS/engineering program (e.g., Waterloo, Georgia Tech, UIUC, ETH Zurich, TU Munich)',
        3: 'Degree from a tier-1 university (MIT, Stanford, Harvard, CMU, Berkeley, Princeton, Caltech, Oxbridge)',
      },
    },
    {
      key: 'location',
      label: 'Location',
      weight: 3,
      tiers: {
        0: 'Asia, Africa, or other regions where relocation to NYC is unlikely.',
        1: 'Western world (Europe, Canada, Australia, Latin America) - regions where relocation to NYC is plausible. Also use for US-based people who have been in the same non-NYC city for 5+ years (check LinkedIn experience locations) - long tenure in SF/Seattle/etc. makes relocation unlikely.',
        2: 'In the US (not NYC), with some indication of mobility (moved cities in the last few years, or less than 5 years in current city)',
        3: 'New York City area (NYC, NJ, CT commutable)',
      },
    },
    {
      key: 'builder_signal',
      label: 'Builder Signal',

      tiers: {
        0: 'No signal of shipping or building products. Also use for pattern of many short-lived micro-SaaS or side projects (few months each) without meaningful traction or users - this signals lack of follow-through, not building ability.',
        1: 'Some open source contributions or side projects, but nothing with significant adoption or impact',
        2: 'Clearly ships real products, active builder with curiosity-driven projects that have real users or meaningful adoption',
        3: 'Exceptional track record of shipping - successful products with significant traction, strong OSS portfolio with real adoption (1000+ stars), or clear hustler/builder mentality with demonstrated follow-through',
      },
    },
    {
      key: 'company_pedigree',
      label: 'Reputable Company',
      weight: 4,
      tiers: {
        0: 'Most recent role is at a non-tech/traditional company (media, publishing, banking, insurance, government, consulting, agency - e.g. NYT, Bank of America, McKinsey, Deloitte), a non-venture-backed company, an unknown startup with no funding, or no meaningful work experience.',
        1: 'Most recent role is at a venture-backed startup or a known tech company, but not a standout name. Large established tech companies that are not known for exceptional engineering (e.g., LinkedIn, Adobe, Etsy, Salesforce, Oracle) fall here.',
        2: 'Most recent role is at a well-known tech company with strong engineering culture (e.g. Google, Meta, Stripe, Databricks, Vercel) or a startup backed by strong investors',
        3: 'Most recent role is at a top-tier AI/tech startup backed by tier-1 VCs (Sequoia, Thrive Capital, Founders Fund, Benchmark, Khosla Ventures, a16z, Accel) or at a company known for exceptional engineering talent density (e.g., Anthropic, OpenAI, Jane Street)',
      },
    },
    {
      key: 'seniority_fit',
      label: 'Seniority Fit',
      weight: 1,
      tiers: {
        0: 'VP/C-suite at a well-known or large company, famous tech leader, tenured professor - way too senior for a Series B startup',
        1: 'Director at a large company, engineering manager whose recent roles are primarily people management. Staff/tech lead at a big company with managerial responsibilities also falls here - they may struggle to go back to pure IC work.',
        2: 'Junior engineer with 1-3 years experience, or tech lead at a startup who still codes hands-on',
        3: 'IC engineer (mid through staff/principal) who is clearly still hands-on coding, or early-stage startup engineer - the ideal seniority for a Series B startup',
      },
    },
    {
      key: 'experience_level',
      label: 'Experience Level',
      weight: 1,
      tiers: {
        0: 'Current student or no professional engineering experience at all. Only has personal/university projects.',
        1: 'Current student or recent grad (<1 year out) BUT has founded startups, had high-status internships at venture-backed/tier-1 startups, or has significant open-source/side project output. Also: new grad with <2 years of professional experience.',
        2: '2-4 years of professional engineering experience. Has held at least one full-time engineering role beyond internships.',
        3: '4+ years of professional engineering experience across one or more full-time roles. Seasoned engineer with real production experience.',
      },
    },
    {
      key: 'hireability',
      label: 'Hireability',
      weight: 4,
      tiers: {
        0: 'CEO/CTO/co-founder/VP at a company that is clearly growing (positive headcount growth, >10 employees, or raised significant funding recently). Use company insights data if available. Also: anyone in a senior position (Principal, Staff, Distinguished, Director+) at a rocket-ship AI company (Anthropic, OpenAI, Thinking Machines, Cursor, etc.) - these people are extremely well-compensated and will not leave. These people will not leave their company.',
        1: 'Co-founder/exec at a funded startup with moderate or unknown growth, or C-suite at an established company. Also: junior/mid-level IC engineer at a rocket-ship AI company (Anthropic, OpenAI, Cursor, etc.) where leaving would be irrational. Also: someone who just started a new role or company (<6 months ago) - they are in the honeymoon phase and very unlikely to leave.',
        2: 'Founder of a small/stagnating/early-stage company (<5 employees, no/negative growth in company insights), recently exited founder, someone whose company shut down. Also use for someone stuck at a tiny company (1-3 employees, no growth) for 3+ years - this signals they may be comfortable/complacent rather than ambitious. Serial indie hackers/bootstrappers who have been running their own small projects for 5+ years are also unlikely to join a venture-backed startup.',
        3: 'Employee (not founder/exec), IC engineer at a normal company, or someone clearly between roles and open to new opportunities. Not at a rocket-ship company. Not stuck at a stagnant company for years. Not a serial indie hacker.',
      },
    },
    {
      key: 'role_fit',
      label: 'Role Fit',
      weight: 1,
      tiers: {
        0: 'Not a relevant engineering role (PM, designer, researcher only, or no engineering background). Also: robotics, embedded systems, hardware, computer vision, or other non-web engineering.',
        1: 'Adjacent engineering role (data engineer, DevOps, ML researcher, mobile-only, or primarily ML/CV engineer who does some web work on the side)',
        2: 'Partial overlap (backend-only or frontend-only engineer)',
        3: 'Full-stack web engineer or full-stack + AI engineer building web products - the ideal archetype for the team',
      },
    },
    {
      key: 'tech_stack_fit',
      label: 'Tech Stack Fit',
      tiers: {
        0: 'No TypeScript/JavaScript experience evident. Primarily uses other languages (Python-only, Go-only, Rust-only, etc.)',
        1: 'Some JavaScript/TypeScript usage but primarily works in other languages',
        2: 'Regular TypeScript/JavaScript user with web development experience',
        3: 'Heavy TypeScript usage, React/Next.js experience, full-stack web development as primary stack',
      },
    },
  ],

  // Team members to exclude from scraping results (GitHub URLs)
  teamMembers: [
    'https://github.com/AJNandi',
    'https://github.com/AmitRoopnarineRogo',
    'https://github.com/catherine-rogo',
    'https://github.com/chasegoulet-rogo',
    'https://github.com/chaserogo',
    'https://github.com/itstheonlychris',
    'https://github.com/connerlambden',
    'https://github.com/curtjanssen',
    'https://github.com/deepak-rogo',
    'https://github.com/edmund-sec',
    'https://github.com/wieandteduard',
    'https://github.com/erictu22',
    'https://github.com/exu24',
    'https://github.com/flornkm',
    'https://github.com/gabrielstengel',
    'https://github.com/gmeinhardt-rogo',
    'https://github.com/gradients-rogo',
    'https://github.com/jamespolemeni-afk',
    'https://github.com/jan-wilhelm',
    'https://github.com/jbedard',
    'https://github.com/jchecca',
    'https://github.com/JGalbss',
    'https://github.com/JimmyGreaser',
    'https://github.com/jkim-rogo',
    'https://github.com/johnwillett7',
    'https://github.com/johnheintschel-ops',
    'https://github.com/johnmann-rogo',
    'https://github.com/joseph-mccombs',
    'https://github.com/xeniyandkn',
    'https://github.com/lennydong-rogo',
    'https://github.com/martin-rogo',
    'https://github.com/MichelCarroll',
    'https://github.com/mvickers-rogo',
    'https://github.com/nils-e13',
    'https://github.com/octavien-rogo',
    'https://github.com/pratyush-rogo',
    'https://github.com/RoboTums',
    'https://github.com/Ronan-ACN',
    'https://github.com/rysloan4',
    'https://github.com/sbarreiros',
    'https://github.com/stribwal41',
    'https://github.com/tbui-rogo',
    'https://github.com/thejacobkatz',
    'https://github.com/thomasrogo',
    'https://github.com/tuan-rogo',
    'https://github.com/TumasRackaitis',
    'https://github.com/moritzWa',
  ],

  // Computed below after object definition
  maxTierSum: 0,

  // Seed profiles for graph traversal starting points
  seedProfiles: [
    // Team / original seeds
    'https://github.com/moritzWa',
    'https://github.com/wuweiweiwu',
    'https://github.com/AJNandi',
    'https://github.com/jan-wilhelm',
    'https://github.com/JGalbss',
    'https://github.com/JimmyGreaser',
    'https://github.com/virattt',
    'https://github.com/habanzu',
    // Outreach candidates (validated as strong - explore their connections)
    'https://github.com/timsuchanek',
    'https://github.com/RobertCraigie',
    'https://github.com/NathanFlurry',
    'https://github.com/DeMoorJasper',
    'https://github.com/N2D4',
    'https://github.com/MichaelAlfano',
    'https://github.com/r2d4',
    'https://github.com/dominikmoehrle',
    'https://github.com/edisonqu',
    'https://github.com/rileytomasek',
    'https://github.com/Yonom',
    'https://github.com/kamath',
    'https://github.com/adamcohenhillel',
    'https://github.com/tommoor',
  ],

  // The full LLM rating prompt (static part).
  // {ARCHETYPES} and {CRITERIA} are replaced at runtime.
  ratingPrompt: `Hiring deeply technical full-stack engineers for Rogo, a Series B AI startup building productivity software for investment banking and private equity. The product includes AI-powered presentation generation, Excel automation, research agents, and financial data tools. We need exceptional builders who ship.

Reviewing GitHub profiles to assess fit:
1. Bio & Background: Use GitHub bio, readme, X bio, and web research for career/interest insights.
2. Repositories: Assess for interest in our company's topics (productivity tools, AI agents, document/data processing, financial services, research tools, text-to-SQL, NLP) or cultural fit as a builder.
3. Engineer Archetype: Categorize into one or more: {ARCHETYPES}. Use 'Other' or 'None' if unclear. Base archetypes on substantial, recent (last 3-5 years) hands-on engineering work, not solely on research or theoretical work.

Guidelines:
* Focus on recent (last 5-7 years) hands-on technical contributions. Use LinkedIn dates to verify recency.
* Managerial roles: only count as technical if they still do hands-on coding. If unclear, err on the side of caution.
* Non-technical roles (Investors, pure Eng Managers, PMs, Designers) get tier 0 across the board.
* Use all available info (GitHub, LinkedIn, X, web research) to determine location. Check LinkedIn experience locations to see how long someone has been in their current city - if they've been in the same non-NYC US city (e.g., SF, Seattle) for 5+ years across multiple jobs, relocation is unlikely.
* For builder_signal: distinguish between genuine builders who ship products with real users/traction and people who churn through many micro-SaaS or short-lived projects without meaningful impact.
* For hireability: if someone has been running a 1-3 person company with no growth for 3+ years, that's a negative signal (stuck/complacent), not a positive one. If someone just started a new role or company (<6 months ago), they are in the honeymoon phase and very unlikely to leave - score tier 1. Check LinkedIn start dates carefully.
* For role_fit: we need full-stack WEB engineers who build web applications, not robotics engineers, computer vision researchers, embedded systems engineers, or hardware people. Someone whose career is primarily in robotics/CV/hardware with some minor web projects on the side is NOT a full-stack engineer - score them 0-1.
* For company_pedigree: traditional/non-tech companies (media, banking, insurance, government, consulting) are tier 0 regardless of brand prestige. Distinguish between large established tech companies (LinkedIn, Adobe, Etsy, Salesforce) and companies known for exceptional engineering talent density (Anthropic, Stripe, Jane Street). A career spent entirely at big established tech is a tier 1-2, not tier 3. If you haven't heard of the company, it's tier 0-1.
* For seniority_fit: if someone's recent titles are "Staff Engineer", "Tech Lead", or "Engineering Manager" at a big company, they likely have significant managerial responsibilities and may not be a good fit for a hands-on IC role at a Series B. Look at their GitHub activity to verify they still code.
* For builder_signal and ai_agent_experience: only score high if there is concrete evidence from GitHub repos, stars, or verifiable product launches. Do NOT trust vague web research claims like "10,000 interactions" or "widely used" without corroborating evidence in their repos. A repo with <100 stars is not "significant traction".
* Be skeptical of web research results - they may contain hallucinated or exaggerated claims. Cross-reference with actual GitHub repos and LinkedIn experience. If the LinkedIn data seems inconsistent with the GitHub profile (wrong person, different career focus), trust GitHub over LinkedIn.
* Serial indie hackers/bootstrappers who have been running their own small SaaS projects for many years (without ever joining or founding a venture-backed company) are a poor fit. They are unlikely to join a startup as an employee, and their experience building solo projects doesn't translate to the team/scale dynamics of a Series B. Score them low on startup_experience (tier 0-1) and hireability (tier 1-2).

For each criterion, first reason about the evidence, then assign a tier score (0-3). Be honest and consistent - don't inflate. When evidence is missing (e.g., no LinkedIn profile, no web research results), default to lower tiers rather than assuming the best. Absence of evidence is not evidence of a positive signal.

{CRITERIA}

Example 1:
---
GitHub Profile:
Name: Jan Wilhelm
Company: @rogodata
Location: New York, NY
Recent Repos:
- text-to-sql-engine [TypeScript] (pushed 2 months ago)
- financial-data-parser [TypeScript] (pushed 3 months ago)
- react-dashboard [TypeScript] (pushed 5 months ago)
Web Research: Software Engineer at Rogo in New York. Previously built text-to-SQL tools at a data analytics startup. MS CS from TU Munich.

ENGINEER_ARCHETYPE: full-stack, AI engineer
LOCATION: New York, US
startup_experience: "Currently at Rogo (Series B AI startup) as engineer, previously at data analytics startup." -> 2
ai_agent_experience: "Built text-to-SQL engine in production, hands-on AI agent work at Rogo." -> 3
productivity_software: "Data tools and dashboards, works on productivity features at Rogo." -> 2
financial_services: "Works on financial data products at Rogo for IB/PE clients." -> 2
education: "MS CS from TU Munich (top-tier engineering program)." -> 2
location: "Based in NYC." -> 3
builder_signal: "Ships real products, active contributor to multiple repos." -> 2
company_pedigree: "Currently at Rogo (Series B, backed by strong investors), previously at a data analytics startup." -> 2
seniority_fit: "Software engineer IC at a Series B startup, ideal seniority." -> 3
experience_level: "MS CS + multiple full-time roles, 4+ years of professional experience." -> 3
hireability: "Employee at Rogo, not a founder/exec. Open to opportunities." -> 3
role_fit: "Full-stack and AI engineer, directly matches ideal archetype." -> 3
tech_stack_fit: "All repos in TypeScript, React/Next.js stack." -> 3
---
Example 2:
---
GitHub Profile:
Name: Alex Kumar
Company: Chief Scientist @ AI Lab
Recent Repos:
- ml-model-serving [Python] (pushed 5 years ago)
- distributed-training [Python] (pushed 6 years ago)
Web Research: Chief Scientist at AI Lab (2020-present) in London. Previously Research Engineer at Meta AI. PhD in CS from Stanford.

ENGINEER_ARCHETYPE: AI researcher/scientist
LOCATION: London, UK
startup_experience: "No startup experience, large-company research roles only." -> 0
ai_agent_experience: "Research-focused AI role, no production agent/RAG systems." -> 1
productivity_software: "No relevant productivity software experience." -> 0
financial_services: "No financial services exposure." -> 0
education: "Stanford PhD (tier-1 university)." -> 3
location: "Based in London (Western world, relocation plausible)." -> 1
builder_signal: "No evidence of shipping products, repos are 5+ years old." -> 0
company_pedigree: "AI Lab and Meta AI are top-tier companies known for engineering excellence." -> 3
seniority_fit: "Chief Scientist - way too senior, famous tech leader." -> 0
experience_level: "PhD + years as Research Engineer at Meta AI and Chief Scientist. 10+ years." -> 3
hireability: "C-suite at established company, unlikely to leave for Series B." -> 1
role_fit: "AI researcher/scientist, not an engineering role with hands-on coding." -> 0
tech_stack_fit: "Python-only repos, no TypeScript/JavaScript evidence." -> 0
---
Example 3:
---
GitHub Profile:
Name: Priya Gupta
Company: Founder @ DocuAI
Location: Brooklyn, NY
Recent Repos:
- docuai-platform [TypeScript] (pushed 1 month ago)
- pdf-parser-ml [Python] (pushed 2 months ago)
- agent-workflow-engine [TypeScript] (pushed 3 months ago)
Web Research: Founded DocuAI (AI document processing for legal/finance, $2M seed, 3 employees) in NYC. Previously SE at Notion working on editor infrastructure. BSc from Waterloo.
Current Company Insights (from LinkedIn data):
  Company: DocuAI
  Employee Count: 3
  1Y Headcount Growth: 0%
  6M Headcount Growth: 0%

ENGINEER_ARCHETYPE: full-stack, AI engineer
LOCATION: New York, US
startup_experience: "Founded DocuAI with $2M seed funding, strong validation." -> 3
ai_agent_experience: "Built agent workflows and ML document processing in production." -> 3
productivity_software: "Notion editor infrastructure, DocuAI document processing platform." -> 3
financial_services: "DocuAI serves legal/finance, minor exposure." -> 1
education: "BSc from Waterloo (top-tier CS program)." -> 2
location: "NYC-based." -> 3
builder_signal: "Founded company, shipped multiple products, active builder." -> 3
company_pedigree: "DocuAI ($2M seed), previously at Notion (tier-1 VC backed, top eng culture)." -> 3
seniority_fit: "Founder, previously IC at Notion. Would come in at senior/staff level." -> 3
experience_level: "Founded company + SE at Notion, 4+ years of professional experience." -> 3
hireability: "Founder of small stagnating company (3 employees, 0% growth). Likely open to a move." -> 2
role_fit: "Full-stack and AI engineer, builds across the stack." -> 3
tech_stack_fit: "TypeScript as primary language, React/Next.js, with some Python for ML." -> 3
---
`,
};

// Max possible tier sum: each criterion scores 0-3, multiplied by its weight
companyConfig.maxTierSum = companyConfig.criteria.reduce(
  (sum, c) => sum + 3 * (c.weight ?? 1),
  0
);

// Compute total score as weighted sum of tier values.
// Used for ranking: higher sum = better fit.
export function computeTotalScore(
  criteriaScores: Record<string, number>
): number {
  return companyConfig.criteria.reduce((sum, c) => {
    return sum + (criteriaScores[c.key] ?? 0) * (c.weight ?? 1);
  }, 0);
}
