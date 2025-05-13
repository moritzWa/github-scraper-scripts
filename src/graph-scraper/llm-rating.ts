import { Octokit } from "@octokit/core";
import { config } from "dotenv";
import fs from "fs";
import { MongoClient } from "mongodb";
import path from "path";
import { UserData } from "../types.js";
import {
  fetchRecentRepositories,
  fetchUserEmailFromEvents,
} from "../utils/profile-data-fetchers.js";
import openai from "./openai.js";
import { DbGraphUser } from "./types.js";
import {
  getWebResearchInfoGemini,
  getWebResearchInfoOpenAI,
} from "./web-research.js";

config();

const octokit = new Octokit({
  auth: process.env.GITHUB_ACCESS_TOKEN,
});

const getUserName = (user: UserData) =>
  `${user.name || user.login} ${user.xName ? `(${user.xName})` : ""}`;

export const EngineerArchetypes = [
  "full-stack",
  "ML engineer",
  "AI researcher",
  "backend/infra",
  "frontend",
  "protocol/crypto",
  "data engineer",
  "low-level systems",
  "Other",
  "None",
];

const RatingPrompt = (
  webResearchInfoOpenAI: string,
  webResearchInfoGemini: string,
  user: UserData
) => `Hiring for roles at a Series A, Founders Fund-backed, decentralized AI training startup.

Reviewing GitHub profiles to assess user fit using a point system.
1. Bio & Background: Use GitHub bio, readme, X bio, and web research for career/interest insights.
2. Repositories: Assess for interest in our company's topics or cultural fit.
3. Engineer Archetype: Based on all available information, categorize the engineer into one or more of the following archetypes: ${EngineerArchetypes.join(
  ", "
)}. If multiple apply, list them separated by a comma. If none seem to fit well or it's unclear, use "Other" or "None".

We prioritize startup hustlers excited about startups, crypto, and LLMs. 

Point Guidelines for Reasoning & Score:
- Startup Experience: (Focus on demonstrated startup drive; extensive big corp/academic-only experience will naturally receive fewer points in this specific category)
    - Interest/minor startup project contributions: +5
    - Recently worked at a startup or bootstraped saas company (clear role): +10
    - Co-founded a startup OR founding engineer at notable and relevant startup: +20
- Crypto Experience/Interest:
    - Expressed interest or minor projects in crypto/decentralized tech: +5
    - Substantial work/role at a crypto/web3 focused company/project: +25
- AI Experience:
    - Interest in AI/ML (courses, conceptual discussions): +5
    - Significant hands-on AI/ML projects OR AI infrastructure development: +25
- Education:
    - Degree from a globally top-tier/renowned university: +5
    - Elite CS (or highly relevant engineering/math) degree from such a university: +10
- Other Positive Signals (Discretionary):
    - e.g., Impressive open-source work, clear 'hustler' mentality, notable relevant public achievements/awards: +5 to +15 (Judge)
    - Note: Non-engineering roles (e.g., Investors, pure Eng Managers, PMs, designers) should receive 0-scores as we're looking for extremely technical talent.

Help me output a final score (0-100). The score should primarily reflect accumulated positive points from the guidelines. REASONING_CALCULATION must explicitly reference these categories.

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
Web Research: Software engineer at Stripe, previously at Coinbase.

REASONING_CALCULATION: Crypto Experience/Interest (Coinbase): +10
ENGINEER_ARCHETYPE: full-stack, protocol/crypto
SCORE: 10
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
Engineer in question:
Name: ${getUserName(user)}
${user.company ? `Company: ${user.company}` : ""}
Recent Repos: ${
  user.recentRepositories
    ?.slice(0, 3)
    .map(
      (repo) =>
        `- ${repo.is_fork ? "[Fork] " : ""}${repo.name}${
          repo.description ? ` (${repo.description})` : ""
        }`
    )
    .join("\\n") || ""
}
Linkedin Summary: 
${user.linkedinExperienceSummary}
Web Research (OpenAI): ${webResearchInfoOpenAI} 
Web Research (Gemini): ${webResearchInfoGemini}
${user.xBio && `X Profile Bio: ${user.xBio}`}
----
Format response exactly as:
REASONING_CALCULATION: [Populate using the point system above, referencing categories explicitly, e.g., Startup Experience (worked at startup): +15, AI Experience (hands-on ML): +25, etc.]
ENGINEER_ARCHETYPE: [Chosen Archetype(s) from the list: ${EngineerArchetypes.join(
  ", "
)}. Comma-separated if multiple.]
SCORE: [between 0 and 100, sum of points from calculation]
`;

export async function rateUserV3(user: UserData): Promise<{
  reasoning: string | undefined;
  score: number;
  engineerArchetype: string[];
  webResearchInfoOpenAI: string;
  webResearchInfoGemini: string;
  webResearchPromptText: string;
  ratedAt: Date;
  email: string | null | undefined;
}> {
  console.log(`[${user.login}] Fetching email...`);
  const userEmail = await fetchUserEmailFromEvents(user.login, octokit);
  console.log(`[${user.login}] Fetched email: ${userEmail || "not found"}`);

  console.log(`[${user.login}] Performing OpenAI web research...`);
  const openAIResultPromise = getWebResearchInfoOpenAI(user, userEmail);
  console.log(`[${user.login}] Performing Gemini web research...`);
  const geminiResultPromise = getWebResearchInfoGemini(user, userEmail);

  const [openAIResult, geminiResult] = await Promise.all([
    openAIResultPromise,
    geminiResultPromise,
  ]);
  console.log(`[${user.login}] OpenAI research done. Gemini research done.`);

  const webResearchPrompt = openAIResult.promptText;

  const ratingPromptContent = RatingPrompt(
    openAIResult.researchResult,
    geminiResult.researchResult,
    user
  );

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
    `\n\n=== Web Research Prompt for ${
      user.login
    } at ${new Date().toISOString()} ===\n${webResearchPrompt}\n` +
      `\n\n=== Rating Prompt for ${
        user.login
      } at ${new Date().toISOString()} ===\n${ratingPromptContent}\n`
  );

  console.log(`[${user.login}] Sending rating prompt to OpenAI...`);
  const ratingResult = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: ratingPromptContent }],
  });
  console.log(`[${user.login}] Received rating from OpenAI.`);
  const response = ratingResult.choices[0]?.message?.content || "";
  const reasoningMatch = response.match(/REASONING_CALCULATION: (.*)/);
  const scoreMatch = response.match(/SCORE: (\d+)/);
  const archetypeMatch = response.match(/ENGINEER_ARCHETYPE: (.*)/);

  let parsedArchetypes: string[] = ["None"];
  if (archetypeMatch && archetypeMatch[1]) {
    parsedArchetypes = archetypeMatch[1]
      .split(",")
      .map((s) => s.trim())
      .filter((s) => EngineerArchetypes.includes(s));
    if (parsedArchetypes.length === 0) {
      parsedArchetypes = ["Other"]; // Default if specified but not matching known, or empty
    }
  }

  return {
    reasoning: reasoningMatch ? reasoningMatch[1].trim() : undefined,
    score: scoreMatch ? parseInt(scoreMatch[1]) : 0,
    engineerArchetype: parsedArchetypes,
    webResearchInfoOpenAI: openAIResult.researchResult,
    webResearchInfoGemini: geminiResult.researchResult,
    webResearchPromptText: webResearchPrompt,
    ratedAt: new Date(),
    email: userEmail,
  };
}

function calculateRoleFitPoints(archetypes: string[]): number {
  const targetRoles = ["protocol/crypto", "backend/infra", "full-stack"];
  return archetypes.some((archetype) => targetRoles.includes(archetype))
    ? 20
    : 0;
}

// SCRIPT
async function rateAllProcessedUsers() {
  const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017";
  const dbName = process.env.MONGODB_DB || "githubGraph";
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
            const ratingData = await rateUserV3(userData);
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
