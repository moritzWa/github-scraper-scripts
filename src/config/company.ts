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

      tiers: {
        0: 'No startup experience or non-technical startup roles',
        1: 'Worked at a startup in a hands-on engineering role',
        2: 'Founding engineer or early engineer at a startup with some validation',
        3: 'Founded or co-founded a productivity/AI/fintech startup with strong validation (funding, acquisition, significant traction)',
      },
    },
    {
      key: 'ai_agent_experience',
      label: 'AI / Agent Experience',

      tiers: {
        0: 'No AI/ML experience',
        1: 'General interest, courses, or minor AI/ML projects',
        2: 'Built AI-powered tools or applied ML/LLMs in a real product',
        3: 'Shipped AI agents, RAG systems, text-to-SQL, document processing, or research automation in production',
      },
    },
    {
      key: 'productivity_software',
      label: 'Productivity Software / Dev Tools',

      tiers: {
        0: 'No relevant experience',
        1: 'Minor projects or interest in productivity tools, dev tools, or automation',
        2: 'Built developer tools, document processing, or data pipeline software',
        3: 'Deep experience building productivity software, research tools, or workflow automation platforms',
      },
    },
    {
      key: 'financial_services',
      label: 'Financial Services Domain',

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
        0: 'No university degree or unknown',
        1: 'Degree from a good university',
        2: 'Degree from a top-tier CS/engineering program (e.g., Waterloo, Georgia Tech, UIUC, ETH Zurich, TU Munich)',
        3: 'Degree from a tier-1 university (MIT, Stanford, Harvard, CMU, Berkeley, Princeton, Caltech, Oxbridge)',
      },
    },
    {
      key: 'location',
      label: 'Location',

      tiers: {
        0: 'Asia, Africa, or other regions where relocation to NYC is unlikely. Also use for unknown location.',
        1: 'Western world (Europe, Canada, Australia, Latin America) - regions where relocation to NYC is plausible',
        2: 'In the US (not NYC)',
        3: 'New York City area (NYC, NJ, CT commutable)',
      },
    },
    {
      key: 'builder_signal',
      label: 'Builder Signal',

      tiers: {
        0: 'No signal of shipping or building products',
        1: 'Some open source contributions or side projects',
        2: 'Clearly ships real products, active builder with curiosity-driven projects',
        3: 'Exceptional track record of shipping - multiple successful products, strong OSS portfolio, or clear hustler/builder mentality',
      },
    },
    {
      key: 'company_pedigree',
      label: 'Company Pedigree',

      tiers: {
        0: 'Most recent role is at a non-venture-backed company (agency, consultancy, government, unknown startup with no funding). Or no meaningful work experience.',
        1: 'Most recent role is at a venture-backed startup or a known tech company, but not a standout name',
        2: 'Most recent role is at a well-known tech company (e.g. FAANG, Stripe, Databricks) or a startup backed by strong investors',
        3: 'Most recent role is at a company backed by tier-1 VCs (Sequoia, Thrive Capital, Founders Fund, Benchmark, Khosla Ventures, a16z, Accel) or at a top-tier tech company known for engineering excellence',
      },
    },
    {
      key: 'seniority_fit',
      label: 'Seniority / Hireability',
      weight: 2,
      tiers: {
        0: 'CEO/co-founder of a startup that is clearly growing (positive headcount growth, >10 employees, or raised significant funding). Also: VP/C-suite at a well-known or large company, famous tech leader, tenured professor. Use company insights data if available to verify growth.',
        1: 'CTO/co-founder at a funded growing startup (use company insights to check), director at a large company, or student/new grad with < 2 years experience and no top-tier university',
        2: 'Founder of a small/stagnating/early-stage company (<5 employees, no growth or negative growth in company insights), new grad from top university with internship experience',
        3: 'IC engineer (mid through staff/principal), tech lead, or early-stage startup employee (not founder) - the ideal hire for a Series B startup',
      },
    },
    {
      key: 'role_fit',
      label: 'Role Fit',
      weight: 2,
      tiers: {
        0: 'Not a relevant engineering role (PM, designer, researcher only, or no engineering background)',
        1: 'Adjacent engineering role (data engineer, DevOps, ML researcher, mobile-only)',
        2: 'Partial overlap (backend-only or frontend-only engineer)',
        3: 'Full-stack engineer or full-stack + AI engineer - the ideal archetype for the team',
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
    'https://github.com/moritzWa',
    'https://github.com/wuweiweiwu',
    'https://github.com/AJNandi',
    'https://github.com/jan-wilhelm',
    'https://github.com/JGalbss',
    'https://github.com/JimmyGreaser',
    'https://github.com/virattt',
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
* Use all available info (GitHub, LinkedIn, X, web research) to determine location.

For each criterion, first reason about the evidence, then assign a tier score (0-3). Be honest and consistent - don't inflate.

{CRITERIA}

Example 1:
---
GitHub Profile:
Name: Jan Wilhelm
Company: @rogodata
Location: New York, NY
Recent Repos:
- text-to-sql-engine
- financial-data-parser
- react-dashboard
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
seniority_fit: "Software engineer IC at a Series B startup." -> 3
role_fit: "Full-stack and AI engineer, directly matches ideal archetype." -> 3
---
Example 2:
---
GitHub Profile:
Name: Alex Kumar
Company: Chief Scientist @ AI Lab
Recent Repos:
- ml-model-serving (5 years ago)
- distributed-training (6 years ago)
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
seniority_fit: "Chief Scientist at a large AI lab - famous tech leader, not a realistic hire." -> 0
role_fit: "AI researcher/scientist, not an engineering role with hands-on coding." -> 0
---
Example 3:
---
GitHub Profile:
Name: Priya Gupta
Company: Founder @ DocuAI
Location: Brooklyn, NY
Recent Repos:
- docuai-platform
- pdf-parser-ml
- agent-workflow-engine
Web Research: Founded DocuAI (AI document processing for legal/finance, $2M seed) in NYC. Previously SE at Notion working on editor infrastructure. BSc from Waterloo.

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
seniority_fit: "Founder of a small seed-stage startup, previously IC at Notion - realistic hire." -> 3
role_fit: "Full-stack and AI engineer, builds across the stack." -> 3
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
