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
  fetchUserEmailFromEvents,
  fetchWebsiteContent,
  fetchXProfileMetadata,
} from "../utils/profile-data-fetchers.js";
import {
  isActiveInEnoughMonths,
  isWeekdayCoder,
} from "./contribution-patterns.js";
import {
  fetchLinkedInExperienceViaRapidAPI,
  fetchLinkedInProfileUsingBrave,
  findLinkedInUrlInProfileData,
  generateLinkedInExperienceSummary,
  generateOptimizedSearchQuery,
} from "./linkedin-research.js";
import { rateUserV3 } from "./llm-rating.js";
import { ContributionData, GraphUser, IgnoredReason } from "./types.js";
import {
  getWebResearchInfoGemini,
  getWebResearchInfoOpenAI,
} from "./web-research.js";

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

async function fetchBasicUserData(
  octokit: Octokit,
  username: string,
  depth: number
) {
  const userData = await withRateLimitRetry(() =>
    octokit.request("GET /users/{username}", {
      username,
    })
  );

  return {
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
}

async function checkUserFilters(
  userData: any,
  contributions: ContributionData | null | undefined
): Promise<{ shouldIgnore: boolean; reason?: IgnoredReason }> {
  if (userData.location && isLocationInBadCountries(userData.location)) {
    return { shouldIgnore: true, reason: IgnoredReason.BANNED_COUNTRY };
  }

  const createdAt = new Date(userData.created_at);
  if (createdAt > new Date("2019-01-01")) {
    return { shouldIgnore: true, reason: IgnoredReason.ACCOUNT_TOO_NEW };
  }

  if (countProfileFields(userData) < 1) {
    return {
      shouldIgnore: true,
      reason: IgnoredReason.INSUFFICIENT_PROFILE_FIELDS,
    };
  }

  if (userData.followers > 3500) {
    return { shouldIgnore: true, reason: IgnoredReason.TOO_MANY_FOLLOWERS };
  }

  if (userData.following > 415) {
    return { shouldIgnore: true, reason: IgnoredReason.TOO_MANY_FOLLOWING };
  }

  if (!contributions) {
    return {
      shouldIgnore: true,
      reason: IgnoredReason.COULD_NOT_FETCH_CONTRIBUTIONS,
    };
  }

  if (userData.followers <= 35 && contributions.totalSum < 3500) {
    return {
      shouldIgnore: true,
      reason: IgnoredReason.LOW_CONTRIBUTIONS_LOW_FOLLOWERS,
    };
  } else if (
    userData.followers > 35 &&
    userData.followers <= 60 &&
    contributions.totalSum < 3000
  ) {
    return {
      shouldIgnore: true,
      reason: IgnoredReason.LOW_CONTRIBUTIONS_MEDIUM_FOLLOWERS,
    };
  } else if (userData.followers > 60 && contributions.totalSum < 2000) {
    return {
      shouldIgnore: true,
      reason: IgnoredReason.LOW_CONTRIBUTIONS_HIGH_FOLLOWERS,
    };
  }

  if (contributions.calendar_weeks) {
    if (!isActiveInEnoughMonths(contributions.calendar_weeks)) {
      return {
        shouldIgnore: true,
        reason: IgnoredReason.NOT_ACTIVE_ENOUGH_MONTHS,
      };
    }
    if (isWeekdayCoder(contributions.calendar_weeks)) {
      return { shouldIgnore: true, reason: IgnoredReason.WEEKDAY_CODER };
    }
  }

  return { shouldIgnore: false };
}

async function fetchAdditionalUserData(
  username: string,
  userData: any,
  octokit: Octokit
) {
  const [profileReadme, websiteContent, xProfile, recentRepositories] =
    await Promise.all([
      fetchProfileReadme(username),
      userData.blog
        ? fetchWebsiteContent(userData.blog)
        : Promise.resolve(null),
      userData.twitter_username
        ? fetchXProfileMetadata(userData.twitter_username)
        : Promise.resolve(null),
      fetchRecentRepositories(username, octokit),
    ]);

  return {
    profileReadme,
    websiteContent,
    xProfile,
    recentRepositories,
  };
}

async function fetchLinkedInData(user: GraphUser) {
  console.log(`[${user.login}] Attempting to find LinkedIn URL...`);

  // First try to find LinkedIn URL in profile data
  const linkedinUrl = findLinkedInUrlInProfileData(user);
  console.log(`[${user.login}] linkedinUrl from profile data:`, linkedinUrl);

  // If not found in profile data, try Brave search with optimized query
  if (!linkedinUrl) {
    console.log(`[${user.login}] Generating optimized search query...`);
    const optimizedQuery = await generateOptimizedSearchQuery(user);
    console.log(`[${user.login}] Optimized query:`, optimizedQuery);

    const braveLinkedinUrl = await fetchLinkedInProfileUsingBrave(
      user,
      optimizedQuery
    );
    if (braveLinkedinUrl) {
      user.linkedinUrl = braveLinkedinUrl;
      console.log(
        `[${user.login}] Found LinkedIn URL via Brave: ${braveLinkedinUrl}`
      );
    } else {
      console.log(`[${user.login}] Could not find LinkedIn URL.`);
    }
  } else {
    user.linkedinUrl = linkedinUrl;
    console.log(
      `[${user.login}] Found LinkedIn URL in profile data: ${linkedinUrl}`
    );
  }

  if (user.linkedinUrl && !user.linkedinExperience) {
    console.log(`[${user.login}] Fetching LinkedIn experience...`);
    const linkedinExperience = await fetchLinkedInExperienceViaRapidAPI(
      user.linkedinUrl
    );
    user.linkedinExperience = linkedinExperience;
  }

  if (user.linkedinExperience && !user.linkedinExperienceSummary) {
    console.log(`[${user.login}] Generating LinkedIn experience summary...`);
    const linkedinExperienceSummary = await generateLinkedInExperienceSummary(
      user.linkedinExperience
    );
    user.linkedinExperienceSummary = linkedinExperienceSummary;
  }
}

async function fetchWebResearchInfo(user: GraphUser) {
  console.log(`[${user.login}] Checking web research status...`);
  let webResearchInfo: {
    openAI: { promptText: string; researchResult: string | null };
    gemini: {
      promptText: string;
      researchResult: string | null;
    } | null;
  };

  // Only fetch new data if we don't have any
  if (!user.webResearchInfoOpenAI && !user.webResearchInfoGemini) {
    console.log(
      `[${user.login}] No web research found, performing OpenAI web research...`
    );
    const openAIResult = await getWebResearchInfoOpenAI(user, user.email);

    // Only use Gemini if OpenAI returned null
    let geminiResult = null;
    if (!openAIResult.researchResult) {
      console.log(`[${user.login}] OpenAI returned null, trying Gemini...`);
      geminiResult = await getWebResearchInfoGemini(user, user.email);
    }

    webResearchInfo = {
      openAI: openAIResult,
      gemini: geminiResult,
    };

    // Update user with new results
    user.webResearchInfoOpenAI = openAIResult.researchResult || undefined;
    user.webResearchInfoGemini = geminiResult?.researchResult || undefined;
    user.webResearchPromptText = openAIResult.promptText;
  } else {
    console.log(`[${user.login}] Using existing web research data`);
    webResearchInfo = {
      openAI: {
        promptText: user.webResearchPromptText || "",
        researchResult: user.webResearchInfoOpenAI || null,
      },
      gemini: user.webResearchInfoGemini
        ? {
            promptText: user.webResearchPromptText || "",
            researchResult: user.webResearchInfoGemini,
          }
        : null,
    };
  }

  return webResearchInfo;
}

async function calculateUserRating(user: GraphUser, webResearchInfo: any) {
  console.log(`[${user.login}] Calling rateUserV3...`);
  const ratingData = await rateUserV3(user, webResearchInfo);
  const roleFitPoints = calculateRoleFitPoints(ratingData.engineerArchetype);

  // Add rating data to the user object
  user.rating = ratingData.score;
  user.ratingWithRoleFitPoints = ratingData.score + roleFitPoints;
  user.ratingReasoning = ratingData.reasoning;
  user.webResearchInfoOpenAI = ratingData.webResearchInfoOpenAI;
  user.webResearchInfoGemini = ratingData.webResearchInfoGemini;
  user.webResearchPromptText = ratingData.webResearchPromptText;
  user.engineerArchetype = ratingData.engineerArchetype;
  user.ratedAt = new Date();

  console.log(`[${user.login}] Rating calculated: ${ratingData.score}`);
}

export async function scrapeUser(
  octokit: Octokit,
  username: string,
  depth: number,
  bypassFilters: boolean = false
): Promise<{ user: GraphUser | null }> {
  try {
    // Fetch basic user data
    const basicUserData = await fetchBasicUserData(octokit, username, depth);

    // Fetch contributions
    let contributions: ContributionData | null | undefined = undefined;
    try {
      contributions = await fetchContributions(username);
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
    }

    // Check filters if not bypassing
    if (!bypassFilters) {
      const filterResult = await checkUserFilters(basicUserData, contributions);
      if (filterResult.shouldIgnore && filterResult.reason) {
        return createIgnoredUser(
          basicUserData,
          filterResult.reason,
          contributions
        );
      }
    }

    // If we get here, the user passed all filters or bypassFilters is true
    console.log(
      `Scraping user https://github.com/${
        basicUserData.login
      } (contributions: ${contributions?.totalSum ?? "N/A"})`
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
export function calculateRoleFitPoints(archetypes: string[]): number {
  const targetRoles = ["protocol/crypto", "backend/infra", "full-stack"];
  return archetypes.some((archetype) => targetRoles.includes(archetype))
    ? 20
    : 0;
}
