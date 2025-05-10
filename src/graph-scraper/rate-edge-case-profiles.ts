import { Octokit } from "@octokit/core";
import { config } from "dotenv";
import { MongoClient } from "mongodb";
import { UserData } from "../types.js";
import { fetchRecentRepositories } from "../utils/profile-data-fetchers.js";
import { rateUserV3 } from "./llm-rating.js"; // Assuming llm-rating.ts will be updated
import { DbGraphUser } from "./types.js";

config(); // Load .env variables

const octokit = new Octokit({
  auth: process.env.GITHUB_ACCESS_TOKEN,
});

const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017";
const dbName = process.env.MONGODB_DB || "githubGraph";

// List of edge-case GitHub usernames to re-evaluate
const edgeCaseUsernames: string[] = [
  "mjafri118", // Mohib Jafri
  "mhw32", // Mike Wu
  "n0rlant1s", // Bani Singh
  "RaghavSood", // Raghav Sood
  "edgarriba", // Edgar Riba
];

async function fetchUserDataForRating(
  username: string,
  client: MongoClient
): Promise<UserData | null> {
  const db = client.db(dbName);
  const usersCol = db.collection<DbGraphUser>("users");

  try {
    const userFromDb = await usersCol.findOne({ _id: username });

    if (!userFromDb) {
      console.warn(
        `[${username}] User not found in DB. Attempting to construct partial UserData.`
      );
      // For users not in DB, we might only have login.
      // rateUserV3 needs more, but we can try with what we can guess or fetch.
      // In a real scenario, these users should ideally be processed and in the DB.
      const recentRepositories = await fetchRecentRepositories(
        username,
        octokit
      );
      return {
        login: username,
        name: null, // Will be fetched by web research if possible
        company: null,
        bio: null,
        blog: null,
        profileUrl: `https://github.com/${username}`,
        location: null,
        normalizedLocation: null,
        email: null,
        twitter_username: null, // userData.xUsername might map to this if available elsewhere
        xBio: null,
        xName: null,
        xUrl: null,
        xLocation: null,
        public_repos: 0,
        followers: 0,
        following: 0,
        createdAt: new Date().toISOString(),
        contributions: null,
        profileReadme: null,
        websiteContent: null, // If you scrape website content
        linkedinUrl: null,
        repoInteractionScraped: [],
        recentRepositories: recentRepositories || null,
      };
    }

    // Ensure recent repositories are fetched if not already present
    let recentRepositories = userFromDb.recentRepositories;
    if (!recentRepositories) {
      console.log(
        `[${username}] Fetching recent repositories for ${
          userFromDb.profileUrl || username
        }`
      );
      recentRepositories = await fetchRecentRepositories(username, octokit);
      // Note: Not updating the DB in this script, just using for current run
    }

    const userData: UserData = {
      ...userFromDb,
      login: userFromDb._id, // Ensure login is set from _id
      repoInteractionScraped: userFromDb.repoInteractionScraped || [],
      recentRepositories: recentRepositories || null,
    };

    return userData;
  } catch (error) {
    console.error(`[${username}] Error fetching data:`, error);
    return null;
  }
}

async function rateAndLogEdgeCases() {
  console.log("Starting rating process for edge case profiles...");

  const client = new MongoClient(mongoUri);

  try {
    await client.connect();
    console.log("Connected to MongoDB (for fetching user data).");

    for (const username of edgeCaseUsernames) {
      console.log(`--- Processing: ${username} ---`);
      const userData = await fetchUserDataForRating(username, client);

      if (!userData) {
        console.log(
          `[${username}] Could not retrieve or construct user data. Skipping.`
        );
        continue;
      }

      try {
        console.log(
          `[${username}] Calling rateUserV3 (with updated prompt logic)..."`
        );
        // Ensure that rateUserV3 uses the refined prompt we discussed.
        // The actual modification of rateUserV3\'s prompt is outside this script\'s direct action,
        // but this script is designed to test those changes.
        const ratingResult = await rateUserV3(userData);

        console.log(`[${username}] Rating Complete:`);
        console.log(`  Profile: https://github.com/${username}`);
        console.log(`  Score: ${ratingResult.score}`);
        // Note: ratingWithRoleFitPoints is calculated inside rateAllProcessedUsers,
        // we might want to replicate that logic here or add it to rateUserV3 if needed for this script.
        // For now, focusing on the direct output of rateUserV3.
        console.log(
          `  Archetypes: ${ratingResult.engineerArchetype.join(", ")}`
        );
        console.log(`  Reasoning: ${ratingResult.reasoning}`);
        console.log(
          `  Web Research (OpenAI): ${ratingResult.webResearchInfoOpenAI}`
        );
        console.log(
          `  Web Research (Gemini): ${ratingResult.webResearchInfoGemini}`
        );
        // console.log(\`  Web Research Prompt Used: ${ratingResult.webResearchPromptText}\`);
        console.log("----------------------------------------");
      } catch (error) {
        console.error(`[${username}] Error during rating:`, error);
        console.log("----------------------------------------");
      }
    }
  } catch (error) {
    console.error("Error in rateAndLogEdgeCases script:", error);
  } finally {
    await client.close();
    console.log("\\nMongoDB connection closed. Edge case processing finished.");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  rateAndLogEdgeCases().catch(console.error);
}
