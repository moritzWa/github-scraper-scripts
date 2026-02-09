import { Octokit } from "@octokit/core";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import { UserData } from "../../types.js";
import { rateUserV3 } from "../core/llm-rating.js";
import { scrapeUser } from "../core/scraper-helpers/scrape-user.js";
import { DbGraphUser } from "../types.js";

dotenv.config();

const args = process.argv.slice(2);
const forceFresh = args.includes("--fresh");
const username = args.find((a) => !a.startsWith("--"));

if (!username) {
  console.error("Usage: npm run scrape-one <username> [--fresh]");
  console.error("  --fresh  Force re-fetch from GitHub (default: use DB data if available)");
  process.exit(1);
}

const client = new MongoClient(process.env.MONGODB_URI!);
await client.connect();
const db = client.db(process.env.MONGODB_DB);
const usersCol = db.collection<DbGraphUser>("users");

let user: UserData | null = null;

// Check DB first unless --fresh
const dbUser = !forceFresh ? await usersCol.findOne({ _id: username }) : null;
const hasScrapedData = dbUser && dbUser.contributions && dbUser.recentRepositories;

if (hasScrapedData) {
  // Use stored data, just re-rate
  const userData: UserData = {
    ...dbUser,
    login: dbUser._id,
    repoInteractionScraped: [],
    recentRepositories: dbUser.recentRepositories || null,
  };

  const webResearchInfo = {
    openAI: {
      promptText: userData.webResearchPromptText || "",
      researchResult: userData.webResearchInfoOpenAI || null,
    },
    gemini: userData.webResearchInfoGemini
      ? {
          promptText: userData.webResearchPromptText || "",
          researchResult: userData.webResearchInfoGemini,
        }
      : null,
  };

  console.log(`Re-rating ${username} from stored data (use --fresh to re-fetch from GitHub)...`);
  const ratingResult = await rateUserV3(userData, webResearchInfo);

  userData.rating = ratingResult.score;
  userData.ratingReasoning = ratingResult.reasoning;
  userData.criteriaScores = ratingResult.criteriaScores;
  userData.criteriaReasonings = ratingResult.criteriaReasonings;
  userData.engineerArchetype = ratingResult.engineerArchetype;
  userData.inferredLocation = ratingResult.inferredLocation;
  userData.ratedAt = new Date();

  user = userData;
} else {
  // No DB data (or --fresh) - full scrape from GitHub
  const octokit = new Octokit({ auth: process.env.GITHUB_ACCESS_TOKEN });
  console.log(`Scraping ${username} from GitHub...`);
  const result = await scrapeUser(octokit, username, 1, false, usersCol);
  user = result.user;
}

if (!user) {
  console.log("Scrape failed or filtered out");
  await client.close();
  process.exit(1);
}

console.log(`\n=== ${username} ===`);
console.log(`Rating: ${user.rating} / ${(await import("../../config/company.js")).companyConfig.maxTierSum}`);
console.log(`Archetype: ${user.engineerArchetype}`);
console.log(`Location: ${user.inferredLocation}`);

if (user.criteriaScores) {
  console.log(`\nCriteria:`);
  for (const [k, v] of Object.entries(user.criteriaScores)) {
    console.log(`  ${k}: ${v}/3 - ${user.criteriaReasonings?.[k] || ""}`);
  }
}

await usersCol.updateOne(
  { _id: username } as any,
  { $set: { ...user as any, status: "processed", ratedAt: new Date() } },
  { upsert: true }
);
console.log("\nSaved to DB");
await client.close();
