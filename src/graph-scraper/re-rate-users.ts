import { Octokit } from "@octokit/core";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import { fetchUserEmailFromEvents } from "../utils/profile-data-fetchers.js";
import { calculateRoleFitPoints } from "./helpers.js";
import {
  fetchLinkedInExperienceViaRapidAPI,
  fetchLinkedInProfileUsingBrave,
  findLinkedInUrlInProfileData,
  generateLinkedInExperienceSummary,
  generateOptimizedSearchQuery,
} from "./linkedin-research.js";
import { rateUserV3 } from "./llm-rating.js";
import { DbGraphUser } from "./types.js";

dotenv.config();

const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017";
const dbName = process.env.MONGODB_DB || "githubGraph";

const octokit = new Octokit({
  auth: process.env.GITHUB_ACCESS_TOKEN,
});

async function reRateUsers() {
  const client = new MongoClient(mongoUri);
  try {
    await client.connect();
    const db = client.db(dbName);
    const usersCol = db.collection<DbGraphUser>("users");
    const ALWAYS_RE_FETCH_LINKEDIN_URL = true;

    // Find all processed users
    const processedUsers = await usersCol
      .find({
        status: "processed",
      })
      .toArray();

    console.log(`Found ${processedUsers.length} processed users to re-rate`);

    // Process users in batches of 10
    const BATCH_SIZE = 1;
    for (let i = 0; i < processedUsers.length; i += BATCH_SIZE) {
      const batch = processedUsers.slice(i, i + BATCH_SIZE);
      console.log(
        `Processing batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(
          processedUsers.length / BATCH_SIZE
        )}`
      );

      await Promise.all(
        batch.map(async (user) => {
          try {
            console.log(`\nProcessing user: ${user._id}`);

            // Add login property to match UserData type
            const userData = {
              ...user,
              login: user._id,
            };

            // First, ensure we have the email
            if (!userData.email) {
              console.log(`[${userData._id}] Fetching email...`);
              const userEmail = await fetchUserEmailFromEvents(
                userData.login,
                octokit
              );
              userData.email = userEmail;
              console.log(
                `[${userData._id}] Fetched email: ${userEmail || "not found"}`
              );
            }

            // Then, ensure we have LinkedIn information
            if (!userData.linkedinUrl || ALWAYS_RE_FETCH_LINKEDIN_URL) {
              console.log(
                `[${userData._id}] Attempting to find LinkedIn URL...`
              );

              // First try to find LinkedIn URL in profile data
              const linkedinUrl = findLinkedInUrlInProfileData(userData);
              console.log(
                `[${userData._id}] linkedinUrl from profile data:`,
                linkedinUrl
              );

              // If not found in profile data, try Brave search with optimized query
              if (!linkedinUrl) {
                console.log(
                  `[${userData._id}] Generating optimized search query...`
                );
                const optimizedQuery = await generateOptimizedSearchQuery(
                  userData
                );
                console.log(
                  `[${userData._id}] Optimized query:`,
                  optimizedQuery
                );

                const braveLinkedinUrl = await fetchLinkedInProfileUsingBrave(
                  userData,
                  optimizedQuery
                );
                if (braveLinkedinUrl) {
                  userData.linkedinUrl = braveLinkedinUrl;
                  console.log(
                    `[${userData._id}] Found LinkedIn URL via Brave: ${braveLinkedinUrl}`
                  );
                } else {
                  console.log(`[${userData._id}] Could not find LinkedIn URL.`);
                }
              } else {
                userData.linkedinUrl = linkedinUrl;
                console.log(
                  `[${userData._id}] Found LinkedIn URL in profile data: ${linkedinUrl}`
                );
              }
            }

            if (userData.linkedinUrl && !userData.linkedinExperience) {
              console.log(`[${userData._id}] Fetching LinkedIn experience...`);
              const linkedinExperience =
                await fetchLinkedInExperienceViaRapidAPI(userData.linkedinUrl);
              userData.linkedinExperience = linkedinExperience;
            }

            if (
              userData.linkedinExperience &&
              !userData.linkedinExperienceSummary
            ) {
              console.log(
                `[${userData._id}] Generating LinkedIn experience summary...`
              );
              const linkedinExperienceSummary =
                await generateLinkedInExperienceSummary(
                  userData.linkedinExperience
                );
              userData.linkedinExperienceSummary = linkedinExperienceSummary;
            }

            // Re-rate the user
            console.log(`[${userData._id}] Calling rateUserV3...`);
            const ratingResult = await rateUserV3(userData);

            // Update the user in the database
            console.log(`[${userData._id}] Updating user data in DB...`);

            const roleFitPoints = calculateRoleFitPoints(
              ratingResult.engineerArchetype
            );

            await usersCol.updateOne(
              { _id: userData._id },
              {
                $set: {
                  email: userData.email,
                  linkedinUrl: userData.linkedinUrl,
                  linkedinExperience: userData.linkedinExperience,
                  linkedinExperienceSummary: userData.linkedinExperienceSummary,
                  rating: ratingResult.score,
                  ratingWithRoleFitPoints: ratingResult.score + roleFitPoints,
                  ratingReasoning: ratingResult.reasoning,
                  engineerArchetype: ratingResult.engineerArchetype,
                  webResearchInfoOpenAI: ratingResult.webResearchInfoOpenAI,
                  webResearchInfoGemini: ratingResult.webResearchInfoGemini,
                  webResearchPromptText: ratingResult.webResearchPromptText,
                  ratedAt: new Date(),
                },
              }
            );

            console.log(
              `[${userData._id}] Successfully re-rated with score: ${ratingResult.score}`
            );
          } catch (error) {
            console.error(`[${user._id}] Error processing user:`, error);
          }
        })
      );

      console.log(
        `Finished processing batch ${Math.floor(i / BATCH_SIZE) + 1}`
      );
    }

    console.log("\nCompleted re-rating all processed users!");
  } catch (error) {
    console.error("Error in re-rating job:", error);
  } finally {
    await client.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  reRateUsers().catch(console.error);
}
