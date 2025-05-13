import { Octokit } from "@octokit/core";
import { config } from "dotenv";
import { MongoClient } from "mongodb";
import { UserData } from "../types.js";
import {
  fetchLinkedInExperienceViaRapidAPI,
  fetchLinkedInProfileUsingBrave,
  generateLinkedInExperienceSummary,
} from "./linkedin-research.js";
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
  "n0rlant1s", // Bani Singh
  "mjafri118", // Mohib Jafri
  // "mhw32", // Mike Wu
  // "RaghavSood", // Raghav Sood
  // "edgarriba", // Edgar Riba
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
      return null;
    }
    const userData: UserData = {
      ...userFromDb,
      login: userFromDb._id,
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
  await client.connect();
  const db = client.db(dbName);

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

        // fetch linkedin url if not part of blog url
        const linkedinUrl = userData.blog?.includes("linkedin.com")
          ? userData.blog
          : await fetchLinkedInProfileUsingBrave(userData);

        if (linkedinUrl) {
          userData.linkedinUrl = linkedinUrl;
        }

        console.log("userData.linkedinUrl", userData.linkedinUrl);

        // fetch linkedin experience if not part of userData
        // if (userData.linkedinUrl && !userData.linkedinExperience) {
        if (userData.linkedinUrl) {
          console.log("fetching linkedin experience");
          const linkedinExperience = await fetchLinkedInExperienceViaRapidAPI(
            userData.linkedinUrl
          );
          userData.linkedinExperience = linkedinExperience;
        } else {
          userData.linkedinExperience = null;
        }

        // generate linkedinExperienceSummary if not part of userData
        // if (userData.linkedinUrl && !userData.linkedinExperienceSummary) {
        if (userData.linkedinUrl) {
          console.log("generating linkedin experience summary");
          if (userData.linkedinExperience) {
            const linkedinExperienceSummary =
              await generateLinkedInExperienceSummary(
                userData.linkedinExperience
              );
            userData.linkedinExperienceSummary = linkedinExperienceSummary;
          } else {
            userData.linkedinExperienceSummary = null;
          }
        }

        console.log(
          "userData.linkedinExperienceSummary",
          userData.linkedinExperienceSummary
        );

        const ratingResult = await rateUserV3(userData);

        // update the object in the database
        const usersCol = db.collection<DbGraphUser>("users");
        await usersCol.updateOne({ _id: username }, { $set: userData });

        // log the results
        console.log(`[${username}] Rating Complete:`);
        console.log(`  Profile: https://github.com/${username}`);
        console.log(`  Score: ${ratingResult.score}`);
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
        // log linkedin experience summary
        console.log(
          `  LinkedIn Experience Summary: ${userData.linkedinExperienceSummary}`
        );

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
