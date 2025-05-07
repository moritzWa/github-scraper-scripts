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
  fetchWebsiteContent,
  fetchXProfileMetadata,
} from "../utils/profile-data-fetchers.js";
import {
  CalendarWeek,
  ContributionData,
  GraphUser,
  IgnoredReason,
} from "./types.js";

/**
 * Scrapes detailed information for a single GitHub user.
 */
export async function scrapeUser(
  octokit: Octokit,
  username: string,
  depth: number,
  bypassFilters: boolean = false
): Promise<{ user: GraphUser | null; ignoredReason?: IgnoredReason }> {
  try {
    const userData = await withRateLimitRetry(() =>
      octokit.request("GET /users/{username}", {
        username,
      })
    );

    if (!bypassFilters) {
      if (
        userData.data.location &&
        isLocationInBadCountries(userData.data.location)
      ) {
        return {
          user: null,
          ignoredReason: IgnoredReason.BANNED_COUNTRY,
        };
      }

      const createdAt = new Date(userData.data.created_at);
      if (createdAt > new Date("2019-01-01")) {
        return {
          user: null,
          ignoredReason: IgnoredReason.ACCOUNT_TOO_NEW,
        };
      }

      if (countProfileFields(userData.data) < 1) {
        return {
          user: null,
          ignoredReason: IgnoredReason.INSUFFICIENT_PROFILE_FIELDS,
        };
      }

      if (userData.data.followers > 3500) {
        return {
          user: null,
          ignoredReason: IgnoredReason.TOO_MANY_FOLLOWERS,
        };
      }

      if (userData.data.following > 415) {
        return {
          user: null,
          ignoredReason: IgnoredReason.TOO_MANY_FOLLOWING,
        };
      }
    }

    let contributions: ContributionData | null | undefined = undefined;
    try {
      contributions = await fetchContributions(username);

      if (!bypassFilters) {
        if (!contributions) {
          return {
            user: null,
            ignoredReason: IgnoredReason.COULD_NOT_FETCH_CONTRIBUTIONS,
          };
        }

        if (userData.data.followers <= 35 && contributions.totalSum < 3500) {
          return {
            user: null,
            ignoredReason: IgnoredReason.LOW_CONTRIBUTIONS_LOW_FOLLOWERS,
          };
        } else if (
          userData.data.followers > 35 &&
          userData.data.followers <= 60 &&
          contributions.totalSum < 3000
        ) {
          return {
            user: null,
            ignoredReason: IgnoredReason.LOW_CONTRIBUTIONS_MEDIUM_FOLLOWERS,
          };
        } else if (
          userData.data.followers > 60 &&
          contributions.totalSum < 2000
        ) {
          return {
            user: null,
            ignoredReason: IgnoredReason.LOW_CONTRIBUTIONS_HIGH_FOLLOWERS,
          };
        }

        if (contributions.calendar_weeks) {
          if (!isActiveInEnoughMonths(contributions.calendar_weeks)) {
            return {
              user: null,
              ignoredReason: IgnoredReason.NOT_ACTIVE_ENOUGH_MONTHS,
            };
          }
          if (isWeekdayCoder(contributions.calendar_weeks)) {
            return {
              user: null,
              ignoredReason: IgnoredReason.WEEKDAY_CODER,
            };
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
        return {
          user: null,
          ignoredReason: IgnoredReason.COULD_NOT_FETCH_CONTRIBUTIONS,
        };
      }
      contributions = undefined;
    }

    console.log(
      `Scraping user https://github.com/${
        userData.data.login
      } (contributions: ${contributions?.totalSum ?? "N/A"})`
    );

    const [profileReadme, websiteContent, xProfile] = await Promise.all([
      fetchProfileReadme(username),
      userData.data.blog
        ? fetchWebsiteContent(userData.data.blog)
        : Promise.resolve(null),
      userData.data.twitter_username
        ? fetchXProfileMetadata(userData.data.twitter_username)
        : Promise.resolve(null),
    ]);

    const normalizedLocation = normalizeLocation(userData.data.location);

    return {
      user: {
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
        normalizedLocation,
        email: userData.data.email || null,
        twitter_username: userData.data.twitter_username || null,
        xUrl: userData.data.twitter_username
          ? `https://x.com/${userData.data.twitter_username}`
          : null,
        xBio: xProfile?.bio || null,
        xName: xProfile?.name || null,
        xLocation: xProfile?.location || null,
        public_repos: userData.data.public_repos,
        contributions: contributions,
        profileReadme: profileReadme || null,
        websiteContent: websiteContent || null,
        depth,
      },
    };
  } catch (error) {
    console.error(`Error scraping user ${username}:`, error);
    return {
      user: null,
      ignoredReason: IgnoredReason.ERROR_SCRAPING,
    };
  }
}

export function isActiveInEnoughMonths(
  calendarWeeks: CalendarWeek[],
  minMonths: number = 8
): boolean {
  if (!calendarWeeks) return false;

  const activeMonths = new Set<string>();

  calendarWeeks.forEach((week) => {
    week.contributionDays.forEach((day) => {
      if (day.contributionCount > 0) {
        const monthKey = day.date.substring(0, 7);
        activeMonths.add(monthKey);
      }
    });
  });

  return activeMonths.size >= minMonths;
}

export function isWeekdayCoder(
  calendarWeeks: CalendarWeek[],
  weekdayThreshold: number = 0.9
): boolean {
  if (!calendarWeeks) return false;

  let weekdayContributions = 0;
  let weekendContributions = 0;

  calendarWeeks.forEach((week) => {
    week.contributionDays.forEach((day) => {
      const date = new Date(day.date);
      const dayOfWeek = date.getUTCDay();

      if (day.contributionCount > 0) {
        if (dayOfWeek >= 1 && dayOfWeek <= 5) {
          weekdayContributions += day.contributionCount;
        } else {
          weekendContributions += day.contributionCount;
        }
      }
    });
  });

  const totalContributions = weekdayContributions + weekendContributions;
  if (totalContributions === 0) {
    return false;
  }

  const weekdayRatio = weekdayContributions / totalContributions;
  return weekdayRatio >= weekdayThreshold;
}
