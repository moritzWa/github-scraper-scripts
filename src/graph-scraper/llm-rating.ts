import { Octokit } from "@octokit/core";
import { config } from "dotenv";
import fs from "fs";
import { MongoClient } from "mongodb";
import { OpenAI } from "openai";
import path from "path";
import { UserData } from "../types.js";
import { fetchRecentRepositories } from "../utils/profile-data-fetchers.js";
import { DbGraphUser } from "./types.js";

config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const octokit = new Octokit({
  auth: process.env.GITHUB_ACCESS_TOKEN,
});

const webResearchInfoPrompt = (user: UserData) =>
  `In a few bullet points tell me more about the background and skills of ${
    user.name
  } (Software Engineer). ${user.xBio || user.bio ? "Their bio reads:" : ""} ${
    user.xBio ? user.xBio : user.bio ? user.bio : ""
  }${
    user.blog ? `Blog is: ${user.blog}` : ""
  }. If you can't identify the person based on the above information, just say "No additional information found." Focus on previous company and job experience (i.e. which specific copanies and roles they had), interests, and current role. No need for complete sentences. Max 250 words.`;

async function getWebResearchInfo(user: UserData) {
  try {
    const response = await openai.responses.create({
      model: "gpt-4o",
      tools: [
        {
          type: "web_search_preview",
          search_context_size: "medium", // balanced context and cost
        },
      ],
      input: webResearchInfoPrompt(user),
    });

    return response.output_text;
  } catch (error) {
    console.error("Error performing web research:", error);
    return "No additional information found.";
  }
}

const getUserName = (user: UserData) =>
  `${user.name || user.login} ${user.xName ? `(${user.xName})` : ""}`;

const RatingPrompt = (
  webResearchInfo: string,
  user: UserData
) => `I'm hiring for several roles for my series A Founders Fund-backed decentralised AI training startup.

We are reviewing GitHub profiles and making educated guesses (using a point system) about how good of a fit these engineers are.
1. Bio & Background: We'll use the github bio, readme, and twitter profile information to learn about their background and interest. 
2. Repositories: There are often helpful to asses if a user has shown interest in topics related to our company or is a potential cultural fit. 
3. Web Research: We want startup hustlers, NOT big-tech-wagies or academics, people that are excited about startups, crypto, and LLMs.
4. Role Fit: We are hiring for Full-Stack, SRE/Infra, AI Agent Engineers. Give negative points for Investors, Eng Managers, PMs, designers, etc. 

Help me output a final score between -100 and 100 for the user.

Example 1: 
---
GitHub Profile:
Name: Xiangyi Li
Company: AI Consultant
Recent Repos:
- deep-learning-papers (Collection of academic ML papers)
- tensorflow-experiments (Research implementations)
- consulting-projects (Enterprise ML solutions)
Web Research: Principal Research Scientist at Meta AI (2010-2022). PhD in Computer Science from Stanford (2005). Previously Research Staff at IBM Watson. Currently independent consultant for AI companies on ML/AI implementation. Published 10+ papers in top ML conferences.

REASONING CALCULATION: purely academic (-10), big tech background (-15), likely older than 30 and thus less hard working (-20), senior management/consulting focus (-10), no startup (-10) or crypto experience (-15), displayed intellectual interest in AI (+5)
SCORE: -50
---
Example 2:
---
GitHub Profile:
Name: Jannik St
Company: @PrimeIntellect-ai
Recent Repos: 
- python-nomad (Client library Hashicorp Nomad)
- AI-Scientist (The AI Scientist: Towards Fully Automated Open-Ended Scientific Discovery 🧑‍🔬)
- kinema (Holistic rescheduling system for Kubernetes to optimize cluster utilization)
- react-big-calendar (gcal/outlook like calendar component
Web Research: Founded vystem.io (acquired 2023), a WebRTC-based video platform scaling to 10K+ concurrent users. MS in Information Systems from TU Munich, thesis on Kubernetes scheduling. Previously at IBM in USA/Germany dual program. Strong background in distributed systems, cloud infrastructure, and AI compute orchestration. Currently building decentralized AI training infrastructure at Prime Intellect.

REASONING CALCULATION: prev co-founder of startup and now at Prime Intellect i.e. ai startup (+20), displayed interest in Agentic AI (AI Scientist), decentralized AI (current role at Prime) (+20), and infra (Kubernetes cluster utilization) (+20)
SCORE: 85
---
Example 3: 
---
GitHub Profile:
Name: Mitchell Catoen
Company: @Phantom
Recent Repos:
- self-custody (Building self-custody for the masses)
- ai-research-platform (AI-enabled research platform)
- lms-ranking (Google LMS ranking systems)
Web Research: Staff Software Engineer at Phantom building self-custody solutions. Previously co-founded Phonic (acquired by Infillion), an AI-enabled research platform for qualitative research at scale. Built ranking systems at Google under LMS team. Mechatronics & Robotics background from Waterloo. YC W20 alum.

REASONING CALCULATION: YC founder with successful exit (+25), building self-custody/crypto infrastructure (+20), AI platform experience (+15), elite tech background (Google + Waterloo) (+10)
SCORE: 90
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
    .join("\n") || ""
}
Web Research: ${webResearchInfo}
----
Format response exactly as:
REASONING CALCULATION: [mimic caclulation like Example above here. Use the same format with numbers in parenthesis]
SCORE: [between -100 and 100]
`;

// Export a new async function rateUserV2 that takes a UserData object and returns a Promise<{ reasoning: string; score: number }>
export async function rateUserV3(
  user: UserData
): Promise<{ reasoning: string; score: number; webResearchInfo: string }> {
  const webResearchInfo = await getWebResearchInfo(user);
  const ratingPrompt = RatingPrompt(webResearchInfo, user);

  // Log the prompt to a file
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
    `\n\n=== Rating Prompt for ${
      user.login
    } at ${new Date().toISOString()} ===\n${ratingPrompt}\n`
  );

  const ratingResult = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: ratingPrompt }],
  });
  const response = ratingResult.choices[0]?.message?.content || "";
  const reasoningMatch = response.match(/REASONING CALCULATION: (.*)/);
  const scoreMatch = response.match(/SCORE: (\d+)/);
  return {
    reasoning: reasoningMatch
      ? reasoningMatch[1].trim()
      : "No reasoning provided",
    score: scoreMatch ? parseInt(scoreMatch[1]) : 0,
    webResearchInfo: webResearchInfo,
  };
}

async function rateAllProcessedUsers() {
  const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017";
  const dbName = process.env.MONGODB_DB || "githubGraph";

  const client = new MongoClient(mongoUri);
  try {
    await client.connect();
    const db = client.db(dbName);
    const usersCol = db.collection<DbGraphUser>("users");

    // Find all processed users that don't have a rating yet
    const processedUsers = await usersCol
      .find({
        status: "processed",
        rating: { $exists: false },
      })
      .toArray();

    console.log(`Found ${processedUsers.length} processed users to rate`);

    for (const user of processedUsers) {
      try {
        console.log(`Rating user: ${user._id}`);

        // Fetch recent repositories if not already present
        let recentRepositories = user.recentRepositories;
        if (!recentRepositories) {
          console.log(`Fetching recent repositories for ${user.profileUrl}`);
          recentRepositories = await fetchRecentRepositories(user._id, octokit);
          // Update the user document with the fetched repositories
          if (recentRepositories) {
            await usersCol.updateOne(
              { _id: user._id },
              { $set: { recentRepositories } }
            );
          }
        }

        // Convert DbGraphUser to UserData
        const userData: UserData = {
          ...user,
          login: user._id,
          repoInteractionScraped: [],
          recentRepositories: recentRepositories || null,
        };

        const rating = await rateUserV3(userData);

        // Update the user document with the rating information
        await usersCol.updateOne(
          { _id: user._id },
          {
            $set: {
              rating: rating.score,
              ratingReasoning: rating.reasoning,
              webResearchInfo: rating.webResearchInfo,
              ratedAt: new Date(),
            },
          }
        );

        console.log(
          `Successfully rated ${user._id} with score: ${rating.score}`
        );
      } catch (error) {
        console.error(`Error rating user ${user._id}:`, error);
        // Continue with next user even if one fails
        continue;
      }
    }

    console.log("Finished rating all processed users");
  } catch (error) {
    console.error("Error in rating job:", error);
  } finally {
    await client.close();
  }
}

// Run the rating job if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  rateAllProcessedUsers().catch(console.error);
}
