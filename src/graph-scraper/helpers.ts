import { Octokit } from "@octokit/core";
import {
  isLocationInBadCountries,
  normalizeLocation,
} from "../utils/location.js";
import {
  countProfileFields,
  fetchContributions,
  withRateLimitRetry,
} from "../utils/prime-scraper-api-utils.js";
import {
  fetchProfileReadme,
  fetchRecentRepositories,
  fetchWebsiteContent,
  fetchXProfileMetadata,
} from "../utils/profile-data-fetchers.js";
import {
  isActiveInEnoughMonths,
  isWeekdayCoder,
} from "./contribution-patterns.js";
import { rateUserV3 } from "./llm-rating.js";
import { ContributionData, GraphUser, IgnoredReason } from "./types.js";

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

/**
 * Scrapes detailed information for a single GitHub user.
 */
export async function scrapeUser(
  octokit: Octokit,
  username: string,
  depth: number,
  bypassFilters: boolean = false
): Promise<{ user: GraphUser | null }> {
  try {
    const userData = await withRateLimitRetry(() =>
      octokit.request("GET /users/{username}", {
        username,
      })
    );

    // Basic user data that we'll store regardless of filters
    const basicUserData = {
      _id: userData.data.login,
      login: userData.data.login,
      profileUrl: userData.data.html_url || "",
      createdAt: userData.data.created_at,
      followers: userData.data.followers,
      following: userData.data.following,
      name: userData.data.name || null,
      bio: userData.data.bio || null,
      company: userData.data.company || null,
      blog: userData.data.blog || null,
      location: userData.data.location || null,
      normalizedLocation: normalizeLocation(userData.data.location) || null,
      email: userData.data.email || null,
      twitter_username: userData.data.twitter_username || null,
      xUrl: null,
      xBio: null,
      xName: null,
      xLocation: null,
      public_repos: userData.data.public_repos,
      contributions: null,
      profileReadme: null,
      websiteContent: null,
      recentRepositories: null,
      depth,
      repoInteractionScraped: [],
    };

    if (!bypassFilters) {
      if (
        userData.data.location &&
        isLocationInBadCountries(userData.data.location)
      ) {
        return createIgnoredUser(basicUserData, IgnoredReason.BANNED_COUNTRY);
      }

      const createdAt = new Date(userData.data.created_at);
      if (createdAt > new Date("2019-01-01")) {
        return createIgnoredUser(basicUserData, IgnoredReason.ACCOUNT_TOO_NEW);
      }

      if (countProfileFields(userData.data) < 1) {
        return createIgnoredUser(
          basicUserData,
          IgnoredReason.INSUFFICIENT_PROFILE_FIELDS
        );
      }

      if (userData.data.followers > 3500) {
        return createIgnoredUser(
          basicUserData,
          IgnoredReason.TOO_MANY_FOLLOWERS
        );
      }

      if (userData.data.following > 415) {
        return createIgnoredUser(
          basicUserData,
          IgnoredReason.TOO_MANY_FOLLOWING
        );
      }
    }

    let contributions: ContributionData | null | undefined = undefined;
    try {
      contributions = await fetchContributions(username);

      if (!bypassFilters) {
        if (!contributions) {
          return createIgnoredUser(
            basicUserData,
            IgnoredReason.COULD_NOT_FETCH_CONTRIBUTIONS
          );
        }

        if (userData.data.followers <= 35 && contributions.totalSum < 3500) {
          return createIgnoredUser(
            basicUserData,
            IgnoredReason.LOW_CONTRIBUTIONS_LOW_FOLLOWERS,
            contributions
          );
        } else if (
          userData.data.followers > 35 &&
          userData.data.followers <= 60 &&
          contributions.totalSum < 3000
        ) {
          return createIgnoredUser(
            basicUserData,
            IgnoredReason.LOW_CONTRIBUTIONS_MEDIUM_FOLLOWERS,
            contributions
          );
        } else if (
          userData.data.followers > 60 &&
          contributions.totalSum < 2000
        ) {
          return createIgnoredUser(
            basicUserData,
            IgnoredReason.LOW_CONTRIBUTIONS_HIGH_FOLLOWERS,
            contributions
          );
        }

        if (contributions.calendar_weeks) {
          if (!isActiveInEnoughMonths(contributions.calendar_weeks)) {
            return createIgnoredUser(
              basicUserData,
              IgnoredReason.NOT_ACTIVE_ENOUGH_MONTHS,
              contributions
            );
          }
          if (isWeekdayCoder(contributions.calendar_weeks)) {
            return createIgnoredUser(
              basicUserData,
              IgnoredReason.WEEKDAY_CODER,
              contributions
            );
          }
        } else {
          console.warn(
            `Warning: Could not perform contribution pattern checks for ${username} - calendar_weeks data missing.`
          );
        }
      }
    } catch (error) {
      console.log(
        `Could not fetch contributions for ${username}. Error: ${error}`
      );
      if (!bypassFilters) {
        return createIgnoredUser(
          basicUserData,
          IgnoredReason.COULD_NOT_FETCH_CONTRIBUTIONS
        );
      }
      contributions = undefined;
    }

    // If we get here, the user passed all filters or bypassFilters is true
    // Now we can fetch the additional data
    console.log(
      `Scraping user https://github.com/${
        userData.data.login
      } (contributions: ${contributions?.totalSum ?? "N/A"})`
    );

    const [profileReadme, websiteContent, xProfile, recentRepositories] =
      await Promise.all([
        fetchProfileReadme(username),
        userData.data.blog
          ? fetchWebsiteContent(userData.data.blog)
          : Promise.resolve(null),
        userData.data.twitter_username
          ? fetchXProfileMetadata(userData.data.twitter_username)
          : Promise.resolve(null),
        fetchRecentRepositories(username, octokit),
      ]);

    // Create the user object with all the fetched data
    const user: GraphUser = {
      ...basicUserData,
      xUrl: userData.data.twitter_username
        ? `https://x.com/${userData.data.twitter_username}`
        : null,
      xBio: xProfile?.bio || null,
      xName: xProfile?.name || null,
      xLocation: xProfile?.location || null,
      contributions: contributions || null,
      profileReadme: profileReadme || null,
      websiteContent: websiteContent || null,
      recentRepositories: recentRepositories || null,
      status: "processed",
    };

    // Calculate rating for users that passed filters
    if (!bypassFilters) {
      console.log(`[${username}] Calculating rating...`);
      try {
        const ratingData = await rateUserV3(user);
        const roleFitPoints = calculateRoleFitPoints(
          ratingData.engineerArchetype
        );

        // Add rating data to the user object
        user.rating = ratingData.score;
        user.ratingWithRoleFitPoints = ratingData.score + roleFitPoints;
        user.ratingReasoning = ratingData.reasoning;
        user.webResearchInfoOpenAI = ratingData.webResearchInfoOpenAI;
        user.webResearchInfoGemini = ratingData.webResearchInfoGemini;
        user.webResearchPromptText = ratingData.webResearchPromptText;
        user.engineerArchetype = ratingData.engineerArchetype;
        user.ratedAt = new Date();

        console.log(`[${username}] Rating calculated: ${ratingData.score}`);
      } catch (error) {
        console.error(`[${username}] Error calculating rating:`, error);
        // Continue without rating data if there's an error
      }
    }

    return { user };
  } catch (error) {
    console.error(`Error scraping user ${username}:`, error);
    return {
      user: null,
    };
  }
}

// Helper function to calculate role fit points
function calculateRoleFitPoints(archetypes: string[]): number {
  const targetRoles = ["protocol/crypto", "backend/infra", "full-stack"];
  return archetypes.some((archetype) => targetRoles.includes(archetype))
    ? 20
    : 0;
}
