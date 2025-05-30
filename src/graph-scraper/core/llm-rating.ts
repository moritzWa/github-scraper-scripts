import { Octokit } from "@octokit/core";
import { config } from "dotenv";
import fs from "fs";
import { MongoClient } from "mongodb";
import path from "path";
import { UserData } from "../../types.js";
import { fetchRecentRepositories } from "../../utils/profile-data-fetchers.js";
import { DbGraphUser } from "../types.js";
import openai from "./openai.js";

config();

const octokit = new Octokit({
  auth: process.env.GITHUB_ACCESS_TOKEN,
});

const getUserName = (user: UserData) =>
  `${user.name || user.login} ${user.xName ? `(${user.xName})` : ""}`;

// Helper function to format relative time
function formatRelativeTime(
  dateString: string | null | undefined
): string | null {
  if (!dateString) {
    return null;
  }
  try {
    const pushedDate = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - pushedDate.getTime();

    // Check for invalid date
    if (isNaN(diffMs)) {
      return null; // Or some indicator of invalid date
    }

    const diffYears = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 365.25));
    const diffMonths = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 30.44)); // Approx
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffYears > 0) {
      return `${diffYears} year${diffYears > 1 ? "s" : ""} ago`;
    } else if (diffMonths > 0) {
      return `${diffMonths} month${diffMonths > 1 ? "s" : ""} ago`;
    } else if (diffDays > 0) {
      return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
    } else {
      return "today"; // Or 'less than a day ago'
    }
  } catch (e) {
    console.error("Error formatting relative time:", e);
    return null; // Return null on error
  }
}

export const EngineerArchetypes = [
  "full-stack",
  "ML engineer",
  "AI engineer",
  "AI researcher/scientist",
  "backend/infra",
  "frontend",
  "protocol/crypto",
  "data engineer",
  "low-level systems",
  "Other",
  "None",
];

// Function to format the dynamic part of the prompt for a user
const formatEngineerInQuestion = (
  user: UserData,
  webResearchInfoOpenAI: string | null,
  webResearchInfoGemini: string | null
) => {
  const reposText = user.recentRepositories
    ?.slice(0, 3)
    .map((repo) => {
      const repoName = `${repo.is_fork ? "[Fork] " : ""}${repo.name}${
        repo.description ? ` (${repo.description.slice(0, 100)})` : ""
      }`;
      const relativeTime = formatRelativeTime(repo.last_pushed_at);
      const timeInfo = relativeTime ? ` (pushed ${relativeTime})` : "";
      return `- ${repoName}${timeInfo}`;
    })
    .join("\n");

  // Group profile information together
  const profileSections = [
    `Name: ${getUserName(user)}`,
    user.company ? `Company: ${user.company}` : null,
    user.xBio ? `X Profile Bio: ${user.xBio}` : null,
    user.websiteContent
      ? `Website Content:\n${user.websiteContent.slice(0, 2000)}${
          user.websiteContent.length > 2000 ? "..." : ""
        }`
      : null,
  ].filter(Boolean);

  // Group technical information together
  const technicalSections = [
    reposText ? `Recent Repos:\n${reposText}` : null,
    user.linkedinExperienceSummary
      ? `Linkedin Summary:\n${user.linkedinExperienceSummary}`
      : null,
  ].filter(Boolean);

  // Group research information together
  const researchSections = [
    webResearchInfoOpenAI
      ? `Web Research (OpenAI): ${webResearchInfoOpenAI}`
      : null,
    webResearchInfoGemini
      ? `Web Research (Gemini): ${webResearchInfoGemini}`
      : null,
  ].filter(Boolean);

  // Combine all sections with appropriate spacing
  const sections = [
    ...profileSections,
    ...technicalSections,
    ...researchSections,
  ].join("\n");

  return `Engineer in question:\n${sections}\n----`;
};

// Modify RatingPrompt to be only the static part
const RatingPrompt = `Hiring deeply technical engineers for a Series A, Founders Fund-backed, decentralized AI training startup. Maintain a very high bar; we need exceptional 'hustlers'. Err on the side of caution if experience is ambiguous.

Reviewing GitHub profiles to assess fit:
1. Bio & Background: Use GitHub bio, readme, X bio, and web research for career/interest insights.
2. Repositories: Assess for interest in our company's topics (LLMs, decentralized systems, crypto, high-performance computing) or cultural fit.
3. Engineer Archetype: Categorize into one or more: ${EngineerArchetypes.join(
  ", "
)}. Use 'Other' or 'None' if unclear. Base archetypes like 'protocol/crypto', 'AI engineer', or 'backend/infra' on substantial, recent (last 3-5 years) hands-on engineering work (coding, system design, building applications/infrastructure), not solely on research, publications, or theoretical work. 'AI researcher/scientist' is more appropriate for individuals primarily focused on research or research engineering.

Point Guidelines for Reasoning & Score:
*   CRITICAL: Focus on recent (last 5-7 years) hands-on technical contributions (coding, system design, applied research). Use provided dates in LinkedIn Summary to verify recency.
*   Managerial roles (Engineering Manager, Tech Lead, etc.) should be evaluated based on:
    - If they still do hands-on coding/technical work: Count as technical role
    - If primarily management/product focused: Count as non-technical role
    - If unclear: Err on side of caution and count as non-technical
*   Use the Linkedin Summary (including dates) to clarify roles and their duration. If it shows extended non-technical focus or only very old technical roles, temper scores even if GitHub has technical projects.
*   IMPORTANT: Final score MUST be between 0-100. If calculation exceeds 100, cap at 100.
*   For archetype assignment:
    - Only assign technical archetypes (e.g., 'AI engineer', 'backend/infra', 'full-stack', 'protocol/crypto', 'low-level systems') if there is substantial, recent (last 3-5 years) hands-on engineering work in that area. This means demonstrable experience in building, designing, or developing systems, applications, or infrastructure.
    - Research roles, even in AI or systems, without clear evidence of recent hands-on *engineering* work should primarily use 'AI researcher/scientist'. Avoid assigning 'AI engineer' or 'backend/infra' if the work is predominantly theoretical, academic, or research-paper focused without significant implementation or development contributions.
    - Err on the side of caution - if unsure about hands-on work, do not assign technical archetypes like 'AI engineer' or 'backend/infra'.

- Startup Experience:
    - Interest/minor startup project contributions (incl. some OS projects): +5
    - Recently worked hands-on at a startup OR successful bootstrapped SaaS (non-AI/infra focused, or AI/infra focused but lacking strong external validation): +10
    - Co-founded a *commercially focused* startup (non-AI/infra) with clear external validation (e.g., significant funding, high traction, acquisition) OR key founding engineer role at such a startup: +15
    - Recently worked hands-on at an *AI/Infra focused* startup with early signs of validation OR successful bootstrapped *AI/Infra* SaaS: +20
    - Co-founded a *commercially focused AI/Infra* startup with strong external validation (e.g., significant funding, high traction, acquisition) OR key founding engineer role at such an *AI/Infra* startup: +25
    - Note: Non-technical roles (Investors, pure Eng Managers, PMs, Designers) get 0 points. "External validation" is critical for higher scores; ventures without it, in unrelated fields (e.g., general VC tools, non-tech products), or where the candidate's role was non-technical, score lower in this category.
- Crypto Experience/Interest:
    - Interest, conceptual discussions, or minor/dated (older than 3-5 years) projects: +5 (Does not typically warrant 'protocol/crypto' archetype alone)
    - Substantial, recent (last 3-5 years) hands-on engineering work/role at a crypto/web3 company/project: +25 (Strong indicator for 'protocol/crypto' archetype)
- AI Experience:
    - General interest (recent relevant courses/discussions/projects): +5 (Passive/dated signals may not qualify)
    - Significant hands-on AI/ML projects OR AI infra development: +25 (Evaluate leadership roles for technical depth vs. pure management)
- Education:
    - Degree from a globally top-tier/renowned university (e.g., Ivy League, Stanford, MIT, Berkeley, CMU, Oxbridge, Imperial, ETHZ, Tsinghua, Waterloo CS/Eng or equivalent global rank): +5
    - Elite CS/Eng/Math PhD/Master's from *one of these specifically*: +10 (Award 0 if university isn't in this top echelon)
- Other Positive Signals (Discretionary):
    - Impressive OS work (showing skill), clear 'hustler' mentality (shipping tech), relevant public technical achievements: +5 to +15 (Judge). (Weight general community building less)
    - Note: Non-technical roles (Investors, pure Eng Managers, PMs, Designers) get 0 scores.

Help me output a final score (0-100). REASONING_CALCULATION must explicitly reference these categories and points.

Example 1: 
---
GitHub Profile:
Name: Xiangyi Li
Company: AI Research Lead @ Meta
Recent Repos:
- ml-model-serving
- distributed-training
- startup-ideas
Web Research: Lead AI Research Engineer at Meta (2018-present). Previously Research Scientist at Google AI (2015-2018). PhD in CS from Stanford. Published papers on distributed ML. Advised early-stage companies. Ran a small AI consulting business.

REASONING_CALCULATION: Startup Experience (Interest/minor contributions via advising & small sale): +5, AI Experience (Lead AI Research, papers, but less startup-applied): +15, Education (PhD CS Stanford): +10
ENGINEER_ARCHETYPE: AI researcher, ML engineer
SCORE: 30
---
Example 2:
---
GitHub Profile:
Name: Jannik St
Company: @PrimeIntellect-ai
Recent Repos: 
- kubernetes-cluster-utilization
- AI-Scientist
- kinema
Web Research: Co-founded vystem.io (acquired). MS InfoSys from TU Munich. Currently @ PrimeIntellect (our company) building decentralized AI training infrastructure. Work on Kinema (Kubernetes).

REASONING_CALCULATION: Startup Experience (Co-founded vystem.io): +20, AI Experience (AI-Scientist repo, current role in decentralized AI): +25, Crypto Experience/Interest (Decentralized AI interest/current role): +5, Education (MS TU Munich): +5, Other positive hustler signals (vystem.io acquisition): +10
ENGINEER_ARCHETYPE: backend/infra, ML engineer
SCORE: 65
---
Example 3: 
---
GitHub Profile:
Name: Sarah Chen
Company: @Stripe
Recent Repos:
- stripe-api
- stripe-node
- solidity-examples
Web Research: Software engineer at Stripe, previously at Coinbase (2019-2021) where she worked on their token system and smart contract infrastructure. Built and maintained core components of their token platform, including smart contract development and integration with their trading systems. Currently working on Stripe's crypto payment infrastructure.

REASONING_CALCULATION: Crypto Experience/Interest (Hands-on work on token systems and smart contracts at Coinbase, current crypto work at Stripe: +25)
ENGINEER_ARCHETYPE: full-stack, protocol/crypto
SCORE: 25
---
Example 4: 
---
GitHub Profile:
Name: Mitchell Catoen
Company: @Phantom
Recent Repos:
- self-custody
- ai-research-platform
- lms-ranking
Web Research: Staff SE @ Phantom (crypto wallet), building self-custody. Co-founded Phonic (AI platform, acquired). Built ranking systems @ Google. Mechatronics & Robotics from Waterloo. YC W20 alum.

REASONING_CALCULATION: Startup Experience (Co-founded Phonic, YC Alum): +20, Crypto Experience/Interest (Worked at renowned crypto company Phantom - crypto): +25, AI Experience (AI platform Phonic, Google ranking): +25, Education (Waterloo): +5, Other positive hustler signals (YC W20 Alum): +10
ENGINEER_ARCHETYPE: protocol/crypto, backend/infra, ML engineer
SCORE: 85
---
Example 5:
---
GitHub Profile:
Name: Alex Chen
Company: Ex-Lead @ BigTech AI Division
Recent Repos:
- project-management-scripts
- old-uni-project
Web Research: Led a major AI hardware project ("Project X") at BigTech (2019-2024, role: Director of Engineering). Previously Senior Engineering Manager. Co-founded "VCAnalyticsTool" (a CRM for VCs, 2017-2019, some user adoption, no major funding/exit) and "QuickSaaSTool" (general small business SaaS, 2016-2017, moderate revenue). LinkedIn shows primarily management roles for last 7+ years.

REASONING_CALCULATION: Startup Experience (Co-founded VCAnalyticsTool, non-AI/infra, some validation but not strong: +5; QuickSaaSTool, non-AI/infra, some validation: +5), AI Experience (Led major AI hardware project 'Project X' but as Director, primarily managerial, limited recent hands-on coding evidence: +10), Education (Relevant CS degree from a good university: +5)
ENGINEER_ARCHETYPE: Other, backend/infra (historical)
SCORE: 25
---
Example 6:
---
GitHub Profile:
Name: Priya Sharma
Company: Founder @ SaaS Startup | Ex-PM @ BigTech
Recent Repos:
- smart-contract-tutorial (7 years ago)
- product-hunt-scraper
Web Research: Founded "HelpfulSaaS" (customer support tool, profitable, 10k users) 2 years ago. Previously Product Manager at BigTech (2019-2022). LinkedIn mentions current interest in "exploring AI applications" but no specific AI/ML projects or roles detailed. Web search mentions "working on a new AI venture in stealth" but no details.

REASONING_CALCULATION: Startup Experience (Founded HelpfulSaaS, non-AI/infra, some validation: +10), Crypto Experience/Interest (Old smart contract tutorial, very dated, minor: +0), AI Experience (General interest, "stealth venture" lacks verifiable details or hands-on Software Engineering evidence: +5), Other Positive Signals (Entrepreneurial success with HelpfulSaaS: +10)
ENGINEER_ARCHETYPE: full-stack, Other
SCORE: 20
---
Example 7:
---
GitHub Profile:
Name: David Kumar
Company: Chief Scientist @ AI Lab
Recent Repos:
- ml-model-serving (5 years ago)
- distributed-training (6 years ago)
- startup-ideas
Web Research: Chief Scientist at AI Lab (2020-present). Previously Research Engineer at Meta AI (2018-2020). Co-founded "AICommunity" (non-profit AI education platform, 2016-2018). PhD in CS from Stanford. Published papers on distributed ML. Regular speaker at AI conferences. Note: While he has impressive research credentials and past engineering work, his recent roles are research-focused without clear hands-on engineering work.

REASONING_CALCULATION: Startup Experience (Co-founded non-profit AI education platform, no commercial validation: +5), AI Experience (Research role but no clear hands-on engineering: +10), Education (PhD Stanford: +10), Other Positive Signals (Conference speaking, community building - not relevant for hands-on role: +0)
ENGINEER_ARCHETYPE: AI researcher/scientist
SCORE: 25
---
`; // End of static prompt template

interface WebResearchResult {
  promptText: string;
  researchResult: string | null;
}

export async function rateUserV3(
  user: UserData,
  webResearchInfo: {
    openAI: WebResearchResult;
    gemini: WebResearchResult | null;
  }
): Promise<{
  reasoning: string | undefined;
  score: number;
  engineerArchetype: string[];
  webResearchInfoOpenAI?: string;
  webResearchInfoGemini?: string;
  webResearchPromptText: string;
  ratedAt: Date;
}> {
  // Generate the dynamic part of the prompt
  const engineerInQuestionContent = formatEngineerInQuestion(
    user,
    webResearchInfo.openAI.researchResult || "",
    webResearchInfo.gemini?.researchResult || ""
  );

  // Combine static template and dynamic part for the LLM
  const ratingPromptContent =
    RatingPrompt +
    engineerInQuestionContent +
    `Format response exactly as:
REASONING_CALCULATION: [Populate using the point system above, referencing categories explicitly, e.g., Startup Experience (worked at startup): +15, AI Experience (hands-on ML): +25, etc.]
ENGINEER_ARCHETYPE: [Chosen Archetype(s) from the list: ${EngineerArchetypes.join(
      ", "
    )}. Comma-separated if multiple.]
SCORE: [between 0 and 100, sum of points from calculation]`;

  // Log only the dynamic part
  const logDir = path.join(process.cwd(), "logs");
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
  }
  const logFile = path.join(
    logDir,
    `rating-prompts-${new Date().toISOString().split("T")[0]}.txt`
  );
  fs.appendFileSync(
    logFile,
    `\n\n=== Rating Data for ${
      user.login
    } at ${new Date().toISOString()} ===\n${engineerInQuestionContent}\n`
  );

  console.log(`[${user.login}] Sending rating prompt to OpenAI...`);
  const ratingResult = await openai.chat.completions.create({
    model: "gpt-4.1",
    messages: [{ role: "user", content: ratingPromptContent }],
  });
  console.log(`[${user.login}] Received rating from OpenAI.`);

  // console.log(
  //   "ratingResult.choices[0]?.message?.content (for debuggings)",
  //   ratingResult.choices[0]?.message?.content
  // );

  const response = ratingResult.choices[0]?.message?.content || "";
  const reasoningMatch = response.match(
    /REASONING_CALCULATION: (.*?)(?=\nENGINEER_ARCHETYPE:|$)/s
  );
  const scoreMatch = response.match(/SCORE: (\d+)/);
  const archetypeMatch = response.match(/ENGINEER_ARCHETYPE: (.*)/);

  let parsedArchetypes: string[] = ["None"];
  if (archetypeMatch && archetypeMatch[1]) {
    parsedArchetypes = archetypeMatch[1]
      .split(",")
      .map((s: string) => s.trim())
      .filter((s: string) => EngineerArchetypes.includes(s));
    if (parsedArchetypes.length === 0) {
      parsedArchetypes = ["Other"];
    }
  }

  return {
    reasoning: reasoningMatch ? reasoningMatch[1].trim() : undefined,
    score: scoreMatch ? parseInt(scoreMatch[1]) : 0,
    engineerArchetype: parsedArchetypes,
    webResearchInfoOpenAI: webResearchInfo.openAI.researchResult || undefined,
    webResearchInfoGemini: webResearchInfo.gemini?.researchResult || undefined,
    webResearchPromptText: webResearchInfo.openAI.promptText,
    ratedAt: new Date(),
  };
}

function calculateRoleFitPoints(archetypes: string[]): number {
  const targetRoles = ["protocol/crypto", "backend/infra", "full-stack"];
  return archetypes.some((archetype) => targetRoles.includes(archetype))
    ? 20
    : 0;
}

// SCRIPT
// TODO this is partly duplicated in re-rate-users.ts
async function rateAllProcessedUsers() {
  const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017";
  const dbName = process.env.MONGODB_DB;
  const BATCH_SIZE = 10;

  const client = new MongoClient(mongoUri);
  try {
    await client.connect();
    const db = client.db(dbName);
    const usersCol = db.collection<DbGraphUser>("users");
    const ONLY_RATE_NEW_USERS = true;

    const query: any = {
      status: "processed",
    };

    if (ONLY_RATE_NEW_USERS) {
      query.rating = { $exists: false };
      query.ratedAt = { $exists: false };
    }

    const processedUsers = await usersCol.find(query).toArray();

    console.log(`Found ${processedUsers.length} processed users to rate`);

    for (let i = 0; i < processedUsers.length; i += BATCH_SIZE) {
      const batch = processedUsers.slice(i, i + BATCH_SIZE);
      console.log(
        `Processing batch of ${batch.length} users (starting from index ${i})`
      );

      await Promise.all(
        batch.map(async (user) => {
          try {
            console.log(`[${user._id}] Starting rating process.`);

            let recentRepositories = user.recentRepositories;
            if (!recentRepositories) {
              console.log(
                `[${user._id}] Fetching recent repositories for ${user.profileUrl}`
              );
              recentRepositories = await fetchRecentRepositories(
                user._id,
                octokit
              );
              console.log(`[${user._id}] Fetched recent repositories.`);
              if (recentRepositories) {
                console.log(
                  `[${user._id}] Updating user with recent repositories in DB...`
                );
                await usersCol.updateOne(
                  { _id: user._id },
                  { $set: { recentRepositories } }
                );
                console.log(
                  `[${user._id}] Updated user with recent repositories in DB.`
                );
              }
            }

            const userData: UserData = {
              ...user,
              login: user._id,
              repoInteractionScraped: [],
              recentRepositories: recentRepositories || null,
            };

            console.log(`[${user._id}] Calling rateUserV3...`);
            const ratingData = await rateUserV3(userData, {
              openAI: {
                promptText: "",
                researchResult: "",
              },
              gemini: null,
            });
            console.log(`[${user._id}] Received data from rateUserV3.`);
            const roleFitPoints = calculateRoleFitPoints(
              ratingData.engineerArchetype
            );

            console.log(`[${user._id}] Updating user rating in DB...`);
            await usersCol.updateOne(
              { _id: user._id },
              {
                $set: {
                  rating: ratingData.score,
                  ratingWithRoleFitPoints: ratingData.score + roleFitPoints,
                  ratingReasoning: ratingData.reasoning,
                  webResearchInfoOpenAI: ratingData.webResearchInfoOpenAI,
                  webResearchInfoGemini: ratingData.webResearchInfoGemini,
                  webResearchPromptText: ratingData.webResearchPromptText,
                  engineerArchetype: ratingData.engineerArchetype,
                  ratedAt: new Date(),
                },
              }
            );
            console.log(`[${user._id}] Updated user rating in DB.`);

            console.log(
              `[${user._id}] Successfully rated https://github.com/${user._id} with score: ${ratingData.score}`
            );
          } catch (error) {
            console.error(
              `[${user._id}] Error rating user ${user._id}:`,
              error
            );
            // Continue with the next user in the batch
          }
        })
      );
      console.log(`Finished processing batch (starting from index ${i})`);
    }

    console.log("Finished rating all processed users");
  } catch (error) {
    console.error("Error in rating job:", error);
  } finally {
    await client.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  rateAllProcessedUsers().catch(console.error);
}
