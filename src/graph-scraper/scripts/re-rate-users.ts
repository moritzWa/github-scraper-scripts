import { Octokit } from "@octokit/core";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import { UserData } from "../../types.js";
import { fetchUserEmailFromEvents } from "../../utils/profile-data-fetchers.js";
import { withRateLimitRetry } from "../../utils/prime-scraper-api-utils.js";
import { rateUserV3 } from "../core/llm-rating.js";
import {
  fetchCurrentEmployerInsights,
  fetchLinkedInExperienceViaRapidAPI,
  fetchLinkedInProfileUsingBrave,
  findLinkedInUrlInProfileData,
  generateLinkedInExperienceSummary,
  generateOptimizedSearchQuery,
} from "../core/scraper-helpers/linkedin-research.js";
import {
  getWebResearchInfoGemini,
  getWebResearchInfoOpenAI,
} from "../core/scraper-helpers/web-research.js";
import { DbGraphUser } from "../types.js";

dotenv.config();

const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017";
const dbName = process.env.MONGODB_DB;

const octokit = new Octokit({
  auth: process.env.GITHUB_ACCESS_TOKEN,
});

// Parse CLI args
function parseArgs() {
  const args = process.argv.slice(2);
  let topN: number | null = null;
  let forceRefetchLinkedin = false;
  let scoresOnly = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--top" && args[i + 1]) {
      topN = parseInt(args[i + 1], 10);
      i++;
    }
    if (args[i] === "--force-refetch-linkedin") {
      forceRefetchLinkedin = true;
    }
    if (args[i] === "--scores-only") {
      scoresOnly = true;
    }
  }

  return { topN, forceRefetchLinkedin, scoresOnly };
}

/** Fetch LinkedIn URL from GitHub social accounts API (cheap, one call) */
async function fetchLinkedInUrlFromGitHub(
  username: string
): Promise<string | null> {
  try {
    const socialAccounts = await withRateLimitRetry(() =>
      octokit.request("GET /users/{username}/social_accounts", { username })
    );
    const linkedinSocial = socialAccounts.data.find(
      (a: { provider: string; url: string }) =>
        a.provider === "linkedin" || a.url?.includes("linkedin.com")
    );
    return linkedinSocial?.url || null;
  } catch {
    return null;
  }
}

async function reRateUsers() {
  const { topN, forceRefetchLinkedin, scoresOnly } = parseArgs();
  const client = new MongoClient(mongoUri);
  try {
    await client.connect();
    const db = client.db(dbName);
    const usersCol = db.collection<DbGraphUser>("users");

    // Find processed users, optionally limited to top N by rating
    let query = usersCol.find({ status: "processed" });
    if (topN) {
      query = query.sort({ rating: -1 }).limit(topN);
    }
    const processedUsers = await query.toArray();

    console.log(
      `Found ${processedUsers.length} processed users to re-rate${topN ? ` (top ${topN})` : ""}`
    );
    if (scoresOnly) {
      console.log(
        "Scores-only mode: using stored data + GitHub social accounts for LinkedIn URLs"
      );
    }
    if (forceRefetchLinkedin) {
      console.log("Force refetching LinkedIn data enabled");
    }

    const BATCH_SIZE = 10;
    for (let i = 0; i < processedUsers.length; i += BATCH_SIZE) {
      const batch = processedUsers.slice(i, i + BATCH_SIZE);
      console.log(
        `\nProcessing batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(
          processedUsers.length / BATCH_SIZE
        )} (users ${i + 1}-${Math.min(i + BATCH_SIZE, processedUsers.length)})`
      );

      await Promise.all(batch.map(async (user) => {
        try {
          const previousRating = user.rating;

          console.log(`\n[${user._id}] Processing... (prev rating: ${previousRating})`);

          const userData: UserData = {
            ...user,
            login: user._id,
            repoInteractionScraped: [],
            recentRepositories: user.recentRepositories || null,
          };

          if (scoresOnly) {
            // --scores-only: re-verify LinkedIn URLs using improved search logic
            // 1. GitHub social accounts API (most reliable, free)
            // 2. Brave search with improved company-name queries
            // If URL changes → re-fetch LinkedIn experience via RapidAPI
            const oldLinkedinUrl = userData.linkedinUrl;

            // Normalize LinkedIn URL for comparison (strip www, lowercase, trailing slash)
            const normalizeLinkedinUrl = (url: string | null | undefined) =>
              url?.toLowerCase().replace("www.", "").replace(/\/+$/, "") || null;

            // Try GitHub social accounts first
            let newLinkedinUrl =
              (await fetchLinkedInUrlFromGitHub(userData.login)) ||
              findLinkedInUrlInProfileData(userData);

            // If no URL from social accounts/profile data, re-run Brave search with improved queries
            if (!newLinkedinUrl) {
              const optimizedQuery = await generateOptimizedSearchQuery(userData);
              console.log(`[${userData.login}] Brave search query: ${optimizedQuery}`);
              newLinkedinUrl = await fetchLinkedInProfileUsingBrave(userData, optimizedQuery);
            }

            const urlActuallyChanged =
              normalizeLinkedinUrl(newLinkedinUrl) !== normalizeLinkedinUrl(oldLinkedinUrl);

            if (!newLinkedinUrl) {
              console.log(`[${userData.login}] No LinkedIn URL found`);
            } else if (urlActuallyChanged) {
              console.log(
                `[${userData.login}] LinkedIn URL updated: ${oldLinkedinUrl || "none"} -> ${newLinkedinUrl}`
              );
              userData.linkedinUrl = newLinkedinUrl;

              // Re-fetch LinkedIn experience since URL changed
              console.log(`[${userData.login}] Fetching LinkedIn experience for new URL...`);
              const linkedinExperience = await fetchLinkedInExperienceViaRapidAPI(newLinkedinUrl);
              userData.linkedinExperience = linkedinExperience;
              if (linkedinExperience) {
                const summary = await generateLinkedInExperienceSummary(linkedinExperience);
                userData.linkedinExperienceSummary = summary;
              }

              // Fetch company insights if applicable
              if (linkedinExperience) {
                const companyInsights = await fetchCurrentEmployerInsights(userData);
                userData.currentCompanyInsights = companyInsights;
              }
            }
          } else {
            // Full mode: fetch email, LinkedIn, web research as needed

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
            if (!userData.linkedinUrl || forceRefetchLinkedin) {
              console.log(
                `[${userData.login}] Attempting to find LinkedIn URL...`
              );

              const linkedinUrl = findLinkedInUrlInProfileData(userData);
              console.log(
                `[${userData.login}] linkedinUrl from profile data:`,
                linkedinUrl
              );

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
                  console.log(
                    `[${userData.login}] Could not find LinkedIn URL.`
                  );
                }
              } else {
                userData.linkedinUrl = linkedinUrl;
                console.log(
                  `[${userData.login}] Found LinkedIn URL in profile data: ${linkedinUrl}`
                );
              }
            }

            if (
              userData.linkedinUrl &&
              (!userData.linkedinExperience || forceRefetchLinkedin)
            ) {
              console.log(
                `[${userData.login}] Fetching LinkedIn experience...`
              );
              const linkedinExperience =
                await fetchLinkedInExperienceViaRapidAPI(userData.linkedinUrl);
              userData.linkedinExperience = linkedinExperience;

              // Regenerate summary when we refetch experience
              if (linkedinExperience) {
                console.log(
                  `[${userData.login}] Generating LinkedIn experience summary...`
                );
                const linkedinExperienceSummary =
                  await generateLinkedInExperienceSummary(linkedinExperience);
                userData.linkedinExperienceSummary = linkedinExperienceSummary;
              }
            } else if (
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

            // Fetch company insights for founders/CEOs
            if (
              userData.linkedinExperience &&
              (!userData.currentCompanyInsights || forceRefetchLinkedin)
            ) {
              const companyInsights =
                await fetchCurrentEmployerInsights(userData);
              userData.currentCompanyInsights = companyInsights;
            }
          }

          // Build web research info from stored data (both modes)
          let webResearchInfo: {
            openAI: { promptText: string; researchResult: string | null };
            gemini: {
              promptText: string;
              researchResult: string | null;
            } | null;
          };

          if (
            !scoresOnly &&
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

            userData.webResearchInfoOpenAI =
              openAIResult.researchResult || undefined;
            userData.webResearchInfoGemini =
              geminiResult?.researchResult || undefined;
            userData.webResearchPromptText = openAIResult.promptText;
          } else {
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

          const ratingResult = await rateUserV3(userData, webResearchInfo);

          console.log(
            `[${userData.login}] ${previousRating} -> ${ratingResult.score}`
          );

          const updateData: any = {
            linkedinUrl: userData.linkedinUrl,
            linkedinExperience: userData.linkedinExperience,
            linkedinExperienceSummary: userData.linkedinExperienceSummary,
            currentCompanyInsights: userData.currentCompanyInsights ?? null,
            rating: ratingResult.score,
            ratingReasoning: ratingResult.reasoning,
            criteriaScores: ratingResult.criteriaScores,
            criteriaReasonings: ratingResult.criteriaReasonings,
            engineerArchetype: ratingResult.engineerArchetype,
            inferredLocation: ratingResult.inferredLocation,
            webResearchPromptText: userData.webResearchPromptText,
            ratedAt: new Date(),
          };

          if (userData.email) {
            updateData.email = userData.email;
          }
          if (userData.webResearchInfoOpenAI) {
            updateData.webResearchInfoOpenAI = userData.webResearchInfoOpenAI;
          }
          if (userData.webResearchInfoGemini) {
            updateData.webResearchInfoGemini = userData.webResearchInfoGemini;
          }

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
      }));

      console.log(
        `Finished batch ${Math.floor(i / BATCH_SIZE) + 1}`
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
