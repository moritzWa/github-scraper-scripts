import { Octokit } from "@octokit/core";
import { fetchContributions } from "../../../utils/prime-scraper-api-utils.js";
import { fetchUserEmailFromEvents } from "../../../utils/profile-data-fetchers.js";
import { ContributionData, GraphUser, IgnoredReason } from "../../types.js";
import { rateUserV3 } from "../llm-rating.js";
import {
  fetchAdditionalUserData,
  fetchBasicUserData,
} from "./fetch-user-data.js";
import { checkUserFilters } from "./filters.js";
import {
  fetchLinkedInData,
  RapidAPICreditsExhaustedError,
} from "./linkedin-research.js";
import { fetchWebResearchInfo } from "./web-research.js";

function createIgnoredUser(
  basicUserData: Omit<GraphUser, "status" | "ignoredReason">,
  reason: IgnoredReason,
  contributions?: ContributionData | null
): { user: GraphUser } {
  return {
    user: {
      ...basicUserData,
      contributions: contributions ?? null,
      status: "ignored",
      ignoredReason: reason,
    },
  };
}

async function calculateUserRating(user: GraphUser, webResearchInfo: any) {
  console.log(`[${user.login}] Calling rateUserV3...`);
  const ratingData = await rateUserV3(user, webResearchInfo);

  // Add rating data to the user object
  user.rating = ratingData.score;
  user.ratingReasoning = ratingData.reasoning;
  user.criteriaScores = ratingData.criteriaScores;
  user.criteriaReasonings = ratingData.criteriaReasonings;
  user.webResearchInfoOpenAI = ratingData.webResearchInfoOpenAI;
  user.webResearchInfoGemini = ratingData.webResearchInfoGemini;
  user.webResearchPromptText = ratingData.webResearchPromptText;
  user.engineerArchetype = ratingData.engineerArchetype;
  user.inferredLocation = ratingData.inferredLocation;
  user.ratedAt = new Date();

  console.log(`[${user.login}] Rating: ${ratingData.score}/${ratingData.criteriaScores ? Object.keys(ratingData.criteriaScores).length * 3 : "?"}${ratingData.inferredLocation ? ` (${ratingData.inferredLocation})` : ""}`);
}

export async function scrapeUser(
  octokit: Octokit,
  username: string,
  depth: number,
  bypassFilters: boolean = false
): Promise<{ user: GraphUser | null }> {
  try {
    console.log(
      `[ScrapeUser] Starting scrape for ${username} (depth: ${depth}, bypassFilters: ${bypassFilters})`
    );

    // Fetch basic user data
    const basicUserData = await fetchBasicUserData(octokit, username, depth);
    console.log(`[ScrapeUser] Fetched basic data for ${username}`);

    // Fetch contributions
    let contributions: ContributionData | null | undefined = undefined;
    try {
      contributions = await fetchContributions(username);
      console.log(
        `[ScrapeUser] Fetched contributions for ${username}: ${
          contributions?.totalSum ?? "N/A"
        }`
      );
    } catch (error) {
      console.log(
        `[ScrapeUser] Could not fetch contributions for ${username}. Error: ${error}`
      );
      if (!bypassFilters) {
        console.log(
          `[ScrapeUser] ${username} rejected due to missing contributions (bypassFilters: ${bypassFilters})`
        );
        return createIgnoredUser(
          basicUserData,
          IgnoredReason.COULD_NOT_FETCH_CONTRIBUTIONS
        );
      }
    }

    // Check filters if not bypassing
    if (!bypassFilters) {
      console.log(`[ScrapeUser] Running filter check for ${username}`);
      const filterResult = await checkUserFilters(basicUserData, contributions);
      if (filterResult.shouldIgnore && filterResult.reason) {
        console.log(
          `[ScrapeUser] ${username} rejected by filters: ${filterResult.reason}`
        );
        return createIgnoredUser(
          basicUserData,
          filterResult.reason,
          contributions
        );
      }
    } else {
      console.log(
        `[ScrapeUser] Skipping filters for ${username} (bypassFilters: true)`
      );
    }

    // If we get here, the user passed all filters or bypassFilters is true
    console.log(
      `[ScrapeUser] Proceeding with full scrape for ${username} (contributions: ${
        contributions?.totalSum ?? "N/A"
      })`
    );

    // Only fetch additional data if user passed filters
    const additionalData = await fetchAdditionalUserData(
      username,
      basicUserData,
      octokit
    );

    // Create the user object with all the fetched data
    const user: GraphUser = {
      ...basicUserData,
      xUrl: basicUserData.twitter_username
        ? `https://x.com/${basicUserData.twitter_username}`
        : null,
      xBio: additionalData.xProfile?.bio || null,
      xName: additionalData.xProfile?.name || null,
      xLocation: additionalData.xProfile?.location || null,
      contributions: contributions || null,
      profileReadme: additionalData.profileReadme || null,
      websiteContent: additionalData.websiteContent || null,
      recentRepositories: additionalData.recentRepositories || null,
      status: "processed",
    };

    // Calculate rating for users that passed filters
    if (!bypassFilters) {
      try {
        // First, ensure we have the email
        if (!user.email) {
          console.log(`[${username}] Fetching email...`);
          const userEmail = await fetchUserEmailFromEvents(username, octokit);
          user.email = userEmail;
          console.log(
            `[${username}] Fetched email: ${userEmail || "not found"}`
          );
        }

        // Fetch LinkedIn data
        await fetchLinkedInData(user);

        // Get web research info
        const webResearchInfo = await fetchWebResearchInfo(user);

        // Calculate rating
        await calculateUserRating(user, webResearchInfo);
      } catch (error) {
        if (error instanceof RapidAPICreditsExhaustedError) throw error;
        console.error(`[${username}] Error calculating rating:`, error);
        // Continue without rating data if there's an error
      }
    } else if (depth === 0) {
      // If bypassing filters (typically for depth 0 seed users), assign a default high rating.
      console.log(
        `[${username}] Bypassing filters and assigning default rating as it is a seed user (depth 0).`
      );
      user.rating = 15; // Default high rating for seed users
      user.ratedAt = new Date();
      user.ratingReasoning = "Seed user (depth 0) - default rating";
    }

    return { user };
  } catch (error) {
    if (error instanceof RapidAPICreditsExhaustedError) throw error;
    console.error(`Error scraping user ${username}:`, error);
    return {
      user: null,
    };
  }
}
