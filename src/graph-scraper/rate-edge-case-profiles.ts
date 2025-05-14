import { Octokit } from "@octokit/core";
import { config } from "dotenv";
import { MongoClient } from "mongodb";
import { UserData } from "../types.js";
import { calculateRoleFitPoints } from "./helpers.js";
import {
  fetchLinkedInExperienceViaRapidAPI,
  fetchLinkedInProfileUsingBrave,
  findLinkedInUrlInProfileData,
  generateLinkedInExperienceSummary,
  generateOptimizedSearchQuery,
} from "./linkedin-research.js";
import { rateUserV3 } from "./llm-rating.js"; // Assuming llm-rating.ts will be updated
import { DbGraphUser } from "./types.js";

config(); // Load .env variables

const octokit = new Octokit({
  auth: process.env.GITHUB_ACCESS_TOKEN,
});

const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017";
const dbName = process.env.MONGODB_DB || "githubGraph";

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
  // mjafri118: {
  //   name: "Mohib Jafri",
  //   score: 75,
  //   archetypes: ["ML engineer", "backend/infra", "Other"],
  //   reasoning: "No reasoning provided",
  //   reviewerComment:
  //     "No real software engineering experience. Was engineer manager at Tesla and did some embedded systems engineering",
  // },
  mhw32: {
    name: "Mike Wu",
    score: 70,
    archetypes: ["ML engineer", "AI researcher", "protocol/crypto"],
    reasoning: "No reasoning provided",
    reviewerComment:
      "Most recent roles were all research heavy so not sure why he got the protocol/crypto classification",
  },
  // RaghavSood: {
  //   name: "Raghav Sood",
  //   score: 60,
  //   archetypes: ["backend/infra", "protocol/crypto", "frontend"],
  //   reasoning:
  //     "Startup Experience (CEO/Founder of Appaholics): +20, Crypto Experience/Interest (Engineer at Coinhako in blockchain): +25, Education (Attended Carnegie Mellon University): +5, Other Positive Signals (Authored 'Pro Android Augmented Reality' at age 15, founded HackIndia): +10",
  //   reviewerComment:
  //     "No AI interest, very old (ideally we find people that are younger) and Singapore based",
  // },
  // edgarriba: {
  //   name: "Edgar Riba",
  //   score: 60,
  //   archetypes: ["AI researcher", "ML engineer", "backend/infra"],
  //   reasoning:
  //     "Startup Experience (Co-founded Kornia.org, involvement in multiple entrepreneurial projects): +20, AI Experience (Significant contributions to AI through Kornia library, hands-on ML projects): +25, Education (PhD in Computer Science from Universitat Autònoma de Barcelona): +5, Other Positive Signals (Notable for open-source contributions, community building in AI and CV): +10",
  //   reviewerComment:
  //     "Founded company which is not successful at all. Shouldn't be +20. +5 for low tier (Universitat Autònoma de Barcelona) PhD - don't give points for universities that nobody has heard of. Community building is not relevant for our very technical senior engineering role",
  // },
};

// List of edge-case GitHub usernames to re-evaluate
const edgeCaseUsernames: string[] = [
  "JannikSt",
  // "n0rlant1s", // Bani Singh
  // "mjafri118", // Mohib Jafri
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
  await client.connect();
  const db = client.db(dbName);
  const regenerateLinkedInExperience = true; // Flag to force regeneration
  const refetchLinkedInExperience = true; // Flag to force refetch

  try {
    await client.connect();
    console.log("Connected to MongoDB (for fetching user data).");

    for (const username of edgeCaseUsernames) {
      console.log(`\nProcessing: ${username}`);
      const userData = await fetchUserDataForRating(username, client);

      if (!userData) {
        console.log(
          `[${username}] Could not retrieve or construct user data. Skipping.`
        );
        continue;
      }

      try {
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

        console.log(`[${username}] Calling rateUserV3...`);
        const ratingResult = await rateUserV3(userData);

        // Compare with old rating
        if (OLD_RATINGS[username]) {
          compareRatings(username, OLD_RATINGS[username], ratingResult);
        }

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
              linkedinUrl: userData.linkedinUrl,
              linkedinExperience: userData.linkedinExperience,
              linkedinExperienceSummary: userData.linkedinExperienceSummary,
              // Include rating fields as well, in case they need updating based on new summary
              rating: ratingResult.score,
              ratingWithRoleFitPoints: ratingResult.score + roleFitPoints,
              ratingReasoning: ratingResult.reasoning,
              engineerArchetype: ratingResult.engineerArchetype,
              webResearchInfoOpenAI: ratingResult.webResearchInfoOpenAI,
              webResearchInfoGemini: ratingResult.webResearchInfoGemini,
              webResearchPromptText: ratingResult.webResearchPromptText,
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
