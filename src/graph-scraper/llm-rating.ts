import { Octokit } from "@octokit/core";
import { config } from "dotenv";
import fs from "fs";
import { MongoClient } from "mongodb";
import { OpenAI } from "openai";
import path from "path";
import { UserData } from "../types.js";
import {
  fetchRecentRepositories,
  fetchUserEmailFromEvents,
} from "../utils/profile-data-fetchers.js";
import { DbGraphUser } from "./types.js";

config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const octokit = new Octokit({
  auth: process.env.GITHUB_ACCESS_TOKEN,
});

// Types for Google Gemini API Response (simplified)
interface GooglePart {
  text: string;
}

interface GoogleCandidate {
  content?: {
    parts: GooglePart[];
    role?: string;
  };
  // We are ignoring groundingMetadata for now
}

interface GoogleResponse {
  candidates?: GoogleCandidate[];
}

const webResearchInfoPrompt = (user: UserData, email?: string | null) =>
  `In a few bullet points tell me more about the background and skills of ${
    user.name || user.login
  } (Software Engineer)${
    email ? ` (email for disambiguation: ${email})` : ""
  }. ${user.xBio || user.bio ? "Their bio reads:" : ""} ${
    user.xBio ? user.xBio : user.bio ? user.bio : ""
  }${
    user.blog ? `Blog is: ${user.blog}` : ""
  }. If you can't identify the person based on the above information, just say "No additional information found." Focus on most recent job/company experience (i.e. which specific copanies and roles they had most recently), interests, and current role. No need for complete sentences. Max 250 words.`;

async function getWebResearchInfoOpenAI(
  user: UserData,
  email?: string | null
): Promise<{ promptText: string; researchResult: string }> {
  const promptText = webResearchInfoPrompt(user, email);
  try {
    const response = await openai.responses.create({
      model: "gpt-4o",
      tools: [
        {
          type: "web_search_preview",
          search_context_size: "medium",
        },
      ],
      input: promptText,
    });
    return {
      promptText,
      researchResult:
        response.output_text || "No additional information found (OpenAI).",
    };
  } catch (error) {
    console.error("Error performing OpenAI web research:", error);
    return {
      promptText,
      researchResult: "No additional information found (OpenAI).",
    };
  }
}

async function getWebResearchInfoGemini(
  user: UserData,
  email?: string | null
): Promise<{ promptText: string; researchResult: string }> {
  const promptText = webResearchInfoPrompt(user, email);
  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" +
        process.env.GOOGLE_API_KEY,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          system_instruction: {
            parts: [
              {
                text: "You are a helpful assistant performing web research to find background and skills information about a software engineer.",
              },
            ],
          },
          contents: [
            {
              parts: [{ text: promptText }],
            },
          ],
          tools: [
            {
              google_search: {},
            },
          ],
        }),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("Google API Error:", response.status, errorBody);
      throw new Error(
        `Google API request failed with status ${response.status}`
      );
    }

    const completion = (await response.json()) as GoogleResponse;
    const candidate = completion.candidates?.[0];

    if (!candidate?.content?.parts) {
      console.error(
        "Bad completion from Google API",
        JSON.stringify(completion, null, 2)
      );
      return {
        promptText,
        researchResult: "No additional information found (Gemini).",
      };
    }

    const geminiResult = candidate.content.parts
      .map((part: GooglePart) => part.text)
      .join("\n");
    return {
      promptText,
      researchResult:
        geminiResult || "No additional information found (Gemini).",
    };
  } catch (error) {
    console.error("Error performing Gemini web research:", error);
    return {
      promptText,
      researchResult: "No additional information found (Gemini).",
    };
  }
}

const getUserName = (user: UserData) =>
  `${user.name || user.login} ${user.xName ? `(${user.xName})` : ""}`;

const RatingPrompt = (
  webResearchInfoOpenAI: string,
  webResearchInfoGemini: string,
  user: UserData
) => `I'm hiring for several roles for my series A Founders Fund-backed decentralised AI training startup.

We are reviewing GitHub profiles and making educated guesses (using a point system) about how good of a fit these engineers are.
1. Bio & Background: We'll use the github bio, readme, X bio, and web research information to learn about their career and interest. 
2. Repositories: There are often helpful to asses if a user has shown interest in topics related to our company or is a potential cultural fit. 
3. Desired Traits: We are looking for startup hustlers and individuals excited about startups, crypto, and LLMs. Award points for these attributes. Note if experience leans heavily towards large corporations or primarily academic research in the reasoning, but focus the score on positive indicators.
4. Role Fit: We are primarily hiring for Full-Stack, SRE/Infra, and AI Agent Engineers. Focus on awarding points for skills and experience aligning with these roles. No points here for Eng Managers, PMs, designers, etc.

Help me output a final score between 0 and 100 for the user. The score should primarily reflect the accumulation of positive points for desired attributes.

Example 1: 
---
GitHub Profile:
Name: Xiangyi Li
Company: AI Research Lead @ TechCorp
Recent Repos:
- ml-model-serving (Production ML model deployment framework)
- distributed-training (Distributed ML training infrastructure)
- startup-ideas (Collection of AI startup concepts)
Web Research: Lead AI Research Engineer at TechCorp (2018-present). Previously Research Scientist at Google AI (2015-2018). PhD in Computer Science from Stanford. Published several papers on distributed ML systems. Active in AI startup community, advising early-stage companies. Built and sold a small AI consulting business in 2020.

REASONING CALCULATION: startup experience but not co-founder or similar (+5), big tech background (+0), academic focus (+0), no crypto experience (+0), strong infra engineering skills (+20)
SCORE: 25
---
Example 2:
---
GitHub Profile:
Name: Jannik St
Company: @PrimeIntellect-ai
Recent Repos: 
- kubernetes-cluster-utilization (Kubernetes cluster utilization)
- AI-Scientist (The AI Scientist: Towards Fully Automated Open-Ended Scientific Discovery 🧑‍🔬)
- kinema (Holistic rescheduling system for Kubernetes to optimize cluster utilization)
- react-big-calendar (gcal/outlook like calendar component
Web Research: Founded vystem.io (acquired 2023), a WebRTC-based video platform scaling to 10K+ concurrent users. MS in Information Systems from TU Munich, thesis on Kubernetes scheduling. Previously at IBM in USA/Germany dual program. Strong background in distributed systems, cloud infrastructure, and AI compute orchestration. Currently building decentralized AI training infrastructure at Prime Intellect.

REASONING CALCULATION: prev co-founder of startup (+20) and now at Prime Intellect i.e. ai startup (+20), displayed interest in Agentic AI (AI Scientist) and decentralized AI (+25), and infra (Kubernetes cluster utilization) (+20)
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
Example 4:
---
GitHub Profile:
Name: Sarah Chen
Company: @Stripe
Recent Repos:

SCORE: 30
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
Web Research (OpenAI): ${webResearchInfoOpenAI}
Web Research (Gemini): ${webResearchInfoGemini}
${user.xBio && `X Profile Bio: ${user.xBio}`}
----
Format response exactly as:
REASONING CALCULATION: [mimic caclulation like Example above here. Use the same format with numbers in parenthesis]
SCORE: [between 0 and 100]
`;

export async function rateUserV3(user: UserData): Promise<{
  reasoning: string;
  score: number;
  webResearchInfoOpenAI: string;
  webResearchInfoGemini: string;
  webResearchPromptText: string;
}> {
  const userEmail = await fetchUserEmailFromEvents(user.login, octokit);

  const [openAIResult, geminiResult] = await Promise.all([
    getWebResearchInfoOpenAI(user, userEmail),
    getWebResearchInfoGemini(user, userEmail),
  ]);

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

  const ratingResult = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: ratingPromptContent }],
  });
  const response = ratingResult.choices[0]?.message?.content || "";
  const reasoningMatch = response.match(/REASONING CALCULATION: (.*)/);
  const scoreMatch = response.match(/SCORE: (\d+)/);

  return {
    reasoning: reasoningMatch
      ? reasoningMatch[1].trim()
      : "No reasoning provided",
    score: scoreMatch ? parseInt(scoreMatch[1]) : 0,
    webResearchInfoOpenAI: openAIResult.researchResult,
    webResearchInfoGemini: geminiResult.researchResult,
    webResearchPromptText: webResearchPrompt,
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
    const ONLY_RATE_NEW_USERS = false;

    const query: any = {
      status: "processed",
    };

    if (ONLY_RATE_NEW_USERS) {
      query.rating = { $exists: false };
      query.ratedAt = { $exists: false };
    }

    const processedUsers = await usersCol.find(query).toArray();

    console.log(`Found ${processedUsers.length} processed users to rate`);

    for (const user of processedUsers) {
      try {
        console.log(`Rating user: ${user._id}`);

        let recentRepositories = user.recentRepositories;
        if (!recentRepositories) {
          console.log(`Fetching recent repositories for ${user.profileUrl}`);
          recentRepositories = await fetchRecentRepositories(user._id, octokit);
          if (recentRepositories) {
            await usersCol.updateOne(
              { _id: user._id },
              { $set: { recentRepositories } }
            );
          }
        }

        const userData: UserData = {
          ...user,
          login: user._id,
          repoInteractionScraped: [],
          recentRepositories: recentRepositories || null,
        };

        const ratingData = await rateUserV3(userData);

        await usersCol.updateOne(
          { _id: user._id },
          {
            $set: {
              rating: ratingData.score,
              ratingReasoning: ratingData.reasoning,
              webResearchInfoOpenAI: ratingData.webResearchInfoOpenAI,
              webResearchInfoGemini: ratingData.webResearchInfoGemini,
              webResearchPromptText: ratingData.webResearchPromptText,
              ratedAt: new Date(),
            },
          }
        );

        console.log(
          `Successfully rated ${user._id} with score: ${ratingData.score}`
        );
      } catch (error) {
        console.error(`Error rating user ${user._id}:`, error);
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

if (import.meta.url === `file://${process.argv[1]}`) {
  rateAllProcessedUsers().catch(console.error);
}
