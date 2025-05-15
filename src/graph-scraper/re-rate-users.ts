import { Octokit } from "@octokit/core";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import { UserData } from "../types.js";
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
import {
  getWebResearchInfoGemini,
  getWebResearchInfoOpenAI,
} from "./web-research.js";

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
    const ALWAYS_RE_FETCH_LINKEDIN_URL = false;

    // Find all processed users
    const processedUsers = await usersCol
      .find({
        status: "processed",
      })
      .toArray();

    console.log(`Found ${processedUsers.length} processed users to re-rate`);

    // Process users in batches of 1
    const BATCH_SIZE = 5;
    for (let i = 0; i < processedUsers.length; i += BATCH_SIZE) {
      const batch = processedUsers.slice(i, i + BATCH_SIZE);
      console.log(
        `Processing batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(
          processedUsers.length / BATCH_SIZE
        )}`
      );

      for (const user of batch) {
        try {
          const previousRating = user.rating; // Store previous rating

          console.log(`\nProcessing user: https://github.com/${user._id}`);

          const userData: UserData = {
            ...user,
            login: user._id,
            repoInteractionScraped: [],
            recentRepositories: user.recentRepositories || null,
          };

          // First, ensure we have the email
          if (!userData.email) {
            console.log(`[${userData.login}] Fetching email...`);
            const userEmail = await fetchUserEmailFromEvents(
              userData.login,
              octokit
            );
            userData.email = userEmail;
            console.log(
              `[${userData.login}] Fetched email: ${userEmail || "not found"}`
            );
          }

          // Then, ensure we have LinkedIn information
          if (!userData.linkedinUrl || ALWAYS_RE_FETCH_LINKEDIN_URL) {
            console.log(
              `[${userData.login}] Attempting to find LinkedIn URL...`
            );

            // First try to find LinkedIn URL in profile data
            const linkedinUrl = findLinkedInUrlInProfileData(userData);
            console.log(
              `[${userData.login}] linkedinUrl from profile data:`,
              linkedinUrl
            );

            // If not found in profile data, try Brave search with optimized query
            if (!linkedinUrl) {
              console.log(
                `[${userData.login}] Generating optimized search query...`
              );
              const optimizedQuery = await generateOptimizedSearchQuery(
                userData
              );
              console.log(
                `[${userData.login}] Optimized query:`,
                optimizedQuery
              );

              const braveLinkedinUrl = await fetchLinkedInProfileUsingBrave(
                userData,
                optimizedQuery
              );
              if (braveLinkedinUrl) {
                userData.linkedinUrl = braveLinkedinUrl;
                console.log(
                  `[${userData.login}] Found LinkedIn URL via Brave: ${braveLinkedinUrl}`
                );
              } else {
                console.log(`[${userData.login}] Could not find LinkedIn URL.`);
              }
            } else {
              userData.linkedinUrl = linkedinUrl;
              console.log(
                `[${userData.login}] Found LinkedIn URL in profile data: ${linkedinUrl}`
              );
            }
          }

          if (userData.linkedinUrl && !userData.linkedinExperience) {
            console.log(`[${userData.login}] Fetching LinkedIn experience...`);
            const linkedinExperience = await fetchLinkedInExperienceViaRapidAPI(
              userData.linkedinUrl
            );
            userData.linkedinExperience = linkedinExperience;
          }

          if (
            userData.linkedinExperience &&
            !userData.linkedinExperienceSummary
          ) {
            console.log(
              `[${userData.login}] Generating LinkedIn experience summary...`
            );
            const linkedinExperienceSummary =
              await generateLinkedInExperienceSummary(
                userData.linkedinExperience
              );
            userData.linkedinExperienceSummary = linkedinExperienceSummary;
          }

          // Get web research results first
          console.log(`[${userData.login}] Checking web research status...`);

          let webResearchInfo: {
            openAI: { promptText: string; researchResult: string | null };
            gemini: {
              promptText: string;
              researchResult: string | null;
            } | null;
          };

          // Only fetch new data if we don't have any
          if (
            !userData.webResearchInfoOpenAI &&
            !userData.webResearchInfoGemini
          ) {
            console.log(
              `[${userData.login}] No web research found, performing OpenAI web research...`
            );
            const openAIResult = await getWebResearchInfoOpenAI(
              userData,
              userData.email
            );

            // Only use Gemini if OpenAI returned null
            let geminiResult = null;
            if (!openAIResult.researchResult) {
              console.log(
                `[${userData.login}] OpenAI returned null, trying Gemini...`
              );
              geminiResult = await getWebResearchInfoGemini(
                userData,
                userData.email
              );
            }

            webResearchInfo = {
              openAI: openAIResult,
              gemini: geminiResult,
            };

            // Update userData with new results
            userData.webResearchInfoOpenAI =
              openAIResult.researchResult || undefined;
            userData.webResearchInfoGemini =
              geminiResult?.researchResult || undefined;
            userData.webResearchPromptText = openAIResult.promptText;
          } else {
            console.log(`[${userData.login}] Using existing web research data`);
            webResearchInfo = {
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
          }

          console.log(`[${userData.login}] Calling rateUserV3...`);
          const ratingResult = await rateUserV3(userData, webResearchInfo);

          // Update the user in the database
          console.log(`[${userData.login}] Updating user data in DB...`);

          const roleFitPoints = calculateRoleFitPoints(
            ratingResult.engineerArchetype
          );

          console.log(
            `[${userData.login}] Previous rating result:`,
            "score: ",
            previousRating,
            "scoreWithRoleFitPoints: ",
            ratingResult.score + roleFitPoints
          );

          const updateData: any = {
            email: userData.email,
            linkedinUrl: userData.linkedinUrl,
            linkedinExperience: userData.linkedinExperience,
            linkedinExperienceSummary: userData.linkedinExperienceSummary,
            rating: ratingResult.score,
            ratingWithRoleFitPoints: ratingResult.score + roleFitPoints,
            ratingReasoning: ratingResult.reasoning,
            engineerArchetype: ratingResult.engineerArchetype,
            webResearchPromptText: userData.webResearchPromptText,
            ratedAt: new Date(),
          };

          // Only include web research results if they're not null
          if (userData.webResearchInfoOpenAI) {
            updateData.webResearchInfoOpenAI = userData.webResearchInfoOpenAI;
          }
          if (userData.webResearchInfoGemini) {
            updateData.webResearchInfoGemini = userData.webResearchInfoGemini;
          }

          // log rating result
          console.log(
            `[${userData.login}] Rating result:`,
            "score: ",
            ratingResult.score,
            "scoreWithRoleFitPoints: ",
            ratingResult.score + roleFitPoints
          );

          try {
            await usersCol.updateOne(
              { _id: userData.login },
              { $set: updateData }
            );
          } catch (error) {
            console.error(`[${userData.login}] Error updating user:`, error);
          }
        } catch (error) {
          console.error(`[${user._id}] Error processing user:`, error);
        }
      }

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
