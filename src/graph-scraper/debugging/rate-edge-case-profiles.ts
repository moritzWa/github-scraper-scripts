import { Octokit } from "@octokit/core";
import { config } from "dotenv";
import { MongoClient } from "mongodb";
import { UserData } from "../../types.js";
import {
  fetchUserEmailFromEvents,
  fetchWebsiteContent,
} from "../../utils/profile-data-fetchers.js";
import {
  calculateRoleFitPoints,
  scrapeUser,
} from "../core/scraper-helpers/helpers.js";
import {
  getWebResearchInfoGemini,
  getWebResearchInfoOpenAI,
} from "../core/scraper-helpers/web-research.js";
import {
  fetchLinkedInExperienceViaRapidAPI,
  fetchLinkedInProfileUsingBrave,
  findLinkedInUrlInProfileData,
  generateLinkedInExperienceSummary,
  generateOptimizedSearchQuery,
} from "../core/scraper-helpers/linkedin-research.js";
import { rateUserV3 } from "../core/llm-rating.js";
import { DbGraphUser } from "../types.js";

config(); // Load .env variables

const octokit = new Octokit({
  auth: process.env.GITHUB_ACCESS_TOKEN,
});

const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017";
const dbName = process.env.MONGODB_DB || "githubGraph";
const edgeCaseUsernames: string[] = [
  "hediet_dev",
  "Dicklesworthstone",
  "langalex",
  "GabrielBianconi",
];

// Add type definitions
type OldRating = {
  name: string;
  score: number;
  archetypes: string[];
  reasoning: string;
  reviewerComment: string;
};

type OldRatings = {
  [key: string]: OldRating;
};

// Update OLD_RATINGS with proper type and reviewer comments
const OLD_RATINGS: OldRatings = {
  // n0rlant1s: {
  //   name: "Bani Singh",
  //   score: 65,
  //   archetypes: ["full-stack", "protocol/crypto"],
  //   reasoning:
  //     "Startup Experience (Founded, scaled, and sold several software businesses): +20, AI Experience (Current role working on new AI technologies in stealth mode, interest in AI technologies): +25, Crypto Experience/Interest (Template-Ethereum-Smart-Contract-Interaction repo): +5, Other Positive Signals (Entrepreneurial success and hustle with multiple businesses): +15",
  //   reviewerComment:
  //     "Less impressive than this says. Doesn't deserve protocol/crypto classification just because of a smart contract related repo from 7 years ago. Had a small bootstrapped saas company but big parts of background is as a product manager and hasn't worked at any AI infra related companies",
  // },
};

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
        `[${username}] User not found in DB. Attempting to scrape user data.`
      );
      // Use scrapeUser to fetch and process the user data
      const { user: scrapedUser } = await scrapeUser(
        octokit,
        username,
        0,
        true
      );

      if (!scrapedUser) {
        console.warn(`[${username}] Failed to scrape user data.`);
        return null;
      }

      // Convert the scraped user data to UserData format
      const userData: UserData = {
        ...scrapedUser,
        login: scrapedUser._id,
        repoInteractionScraped: [],
      };

      // Store the scraped user in the database, excluding _id from the update
      const { _id, ...userDataWithoutId } = scrapedUser as DbGraphUser;
      await usersCol.updateOne(
        { _id: username },
        { $set: userDataWithoutId },
        { upsert: true }
      );

      return userData;
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

function compareRatings(
  username: string,
  oldRating: OldRating,
  newRating: any
) {
  console.log(`\n=== Comparison for ${username} ===`);
  console.log(`Profile: https://github.com/${username}`);

  console.log("\nREVIEWER COMMENTS:");
  console.log(oldRating.reviewerComment);

  console.log("\nOLD RATING:");
  console.log(`Score: ${oldRating.score}`);
  console.log(`Archetypes: ${oldRating.archetypes.join(", ")}`);
  console.log(`Reasoning: ${oldRating.reasoning}`);

  console.log("\nNEW RATING:");
  console.log(`Score: ${newRating.score}`);
  console.log(`Archetypes: ${newRating.engineerArchetype.join(", ")}`);
  console.log(`Reasoning: ${newRating.reasoning}`);

  console.log("\nDIFFERENCES:");
  console.log(`Score Change: ${newRating.score - oldRating.score}`);
  console.log(
    `Archetype Changes: ${JSON.stringify(
      {
        removed: oldRating.archetypes.filter(
          (a: string) => !newRating.engineerArchetype.includes(a)
        ),
        added: newRating.engineerArchetype.filter(
          (a: string) => !oldRating.archetypes.includes(a)
        ),
      },
      null,
      2
    )}`
  );
  console.log("----------------------------------------");
}

async function rateAndLogEdgeCases() {
  console.log("Starting rating process for edge case profiles...");

  const client = new MongoClient(mongoUri);
  const regenerateLinkedInExperience = true; // Flag to force regeneration
  const refetchLinkedInExperience = true; // Flag to force refetch
  const refetchWebsiteContent = true; // Flag to force refetch website content

  try {
    await client.connect();
    const db = client.db(dbName);
    console.log("Connected to MongoDB (for fetching user data).");

    for (const username of edgeCaseUsernames) {
      console.log(`\nProcessing: ${username}`);
      const userData = await fetchUserDataForRating(username, client);

      console.log("Old score: ", userData?.rating);

      if (!userData) {
        console.log(
          `[${username}] Could not retrieve or construct user data. Skipping.`
        );
        continue;
      }

      try {
        // First, fetch email if not already present
        if (!userData.email) {
          console.log(`[${username}] Fetching email...`);
          const email = await fetchUserEmailFromEvents(username, octokit);
          if (email) {
            userData.email = email;
            console.log(`[${username}] Found email: ${email}`);
          }
        }

        // Refetch website content if missing or if refetchWebsiteContent is true
        if (
          (!userData.websiteContent || refetchWebsiteContent) &&
          userData.blog
        ) {
          console.log(
            `[${username}] Refetching website content from ${userData.blog}...`
          );
          const websiteContent = await fetchWebsiteContent(userData.blog);

          console.log("websiteContent (10k): ", websiteContent);

          if (websiteContent) {
            userData.websiteContent = websiteContent;
            console.log(`[${username}] Refetched website content.`);
          }
        }

        if (!userData.linkedinUrl || refetchLinkedInExperience) {
          console.log(`[${username}] Attempting to find LinkedIn URL...`);

          // First check if URL exists in profile data
          const linkedinUrlFromProfile = findLinkedInUrlInProfileData(userData);
          if (linkedinUrlFromProfile) {
            console.log(
              `[${username}] Found LinkedIn URL in profile data: ${linkedinUrlFromProfile}`
            );
            userData.linkedinUrl = linkedinUrlFromProfile;
          } else {
            console.log(`[${username}] Generating optimized search query...`);
            const optimizedQuery = await generateOptimizedSearchQuery(userData);
            console.log(`[${username}] Optimized query: ${optimizedQuery}`);

            const linkedinUrl = await fetchLinkedInProfileUsingBrave(
              userData,
              optimizedQuery
            );
            if (linkedinUrl) {
              console.log(
                `[${username}] Found LinkedIn URL via Brave: ${linkedinUrl}`
              );
              userData.linkedinUrl = linkedinUrl;
            } else {
              console.log(`[${username}] Could not find LinkedIn URL.`);
            }
          }
        }

        if (!userData.linkedinExperience || regenerateLinkedInExperience) {
          console.log(`[${username}] Fetching LinkedIn experience...`);
          if (userData.linkedinUrl) {
            const linkedinExperience = await fetchLinkedInExperienceViaRapidAPI(
              userData.linkedinUrl
            );
            userData.linkedinExperience = linkedinExperience;

            // Generate summary immediately after fetching new experience
            if (linkedinExperience) {
              console.log(
                `[${username}] Generating LinkedIn experience summary...`
              );
              const linkedinExperienceSummary =
                await generateLinkedInExperienceSummary(linkedinExperience);
              userData.linkedinExperienceSummary = linkedinExperienceSummary;
              console.log(`[${username}] Generated LinkedIn summary.`);
            }
          }
        }

        // Get web research results
        console.log(`[${username}] Checking web research status...`);

        let webResearchInfo: {
          openAI: { promptText: string; researchResult: string | null };
          gemini: { promptText: string; researchResult: string | null } | null;
        };

        // Only fetch new data if we don't have any
        if (
          !userData.webResearchInfoOpenAI &&
          !userData.webResearchInfoGemini
        ) {
          console.log(
            `[${username}] No web research found, performing OpenAI web research...`
          );
          const openAIResult = await getWebResearchInfoOpenAI(
            userData,
            userData.email
          );

          // Only use Gemini if OpenAI returned null
          let geminiResult = null;
          if (!openAIResult.researchResult) {
            console.log(`[${username}] OpenAI returned null, trying Gemini...`);
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
          console.log(`[${username}] Using existing web research data`);
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

        console.log(`[${username}] Calling rateUserV3...`);
        const ratingResult = await rateUserV3(userData, webResearchInfo);

        // log new score
        console.log("New score: ", ratingResult.score);
        console.log("New score reasoning: ", ratingResult.reasoning);

        // Compare with old rating
        // if (OLD_RATINGS[username]) {
        //   compareRatings(username, OLD_RATINGS[username], ratingResult);
        // }

        const roleFitPoints = calculateRoleFitPoints(
          ratingResult.engineerArchetype
        );

        // Update the user object in the database (including potentially updated LinkedIn data)
        console.log(`[${username}] Updating user data in DB...`);
        const usersCol = db.collection<DbGraphUser>("users");
        // Make sure to update all potentially modified fields
        await usersCol.updateOne(
          { _id: username },
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
              webResearchInfoOpenAI: userData.webResearchInfoOpenAI,
              webResearchInfoGemini: userData.webResearchInfoGemini,
              webResearchPromptText: userData.webResearchPromptText,
              ratedAt: ratingResult.ratedAt,
            },
          }
        );
        console.log(`[${username}] Updated user data in DB.`);
      } catch (error) {
        console.error(`[${username}] Error during rating:`, error);
        console.log("----------------------------------------");
      }
    }
  } catch (error) {
    console.error("Error in rateAndLogEdgeCases script:", error);
  } finally {
    await client.close();
    console.log("\nMongoDB connection closed. Edge case processing finished.");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  rateAndLogEdgeCases().catch(console.error);
}
