import { Octokit } from "@octokit/core";
import {
  countProfileFields,
  fetchContributions,
  withRateLimitRetry,
} from "./prime-scraper-api-utils.js";
import {
  isLocationInBadCountries,
  normalizeLocation,
} from "./prime-scraper-location.js";
import {
  fetchProfileReadme,
  fetchWebsiteContent,
  fetchXProfileMetadata,
} from "./prime-scraper-profile-utils.js";
import { CalendarWeek, ContributionData, GraphUser } from "./types.js";

/**
 * Scrapes detailed information for a single GitHub user.
 */
export async function scrapeUser(
  octokit: Octokit,
  username: string,
  depth: number,
  bypassFilters: boolean = false
): Promise<GraphUser | null> {
  try {
    const userData = await withRateLimitRetry(() =>
      octokit.request("GET /users/{username}", {
        username,
      })
    );

    // Apply filtering logic only if bypassFilters is false
    if (!bypassFilters) {
      if (
        userData.data.location &&
        isLocationInBadCountries(userData.data.location)
      ) {
        console.log(
          `Skipping user ${username} - located in banned country (${userData.data.location})`
        );
        return null;
      }

      const createdAt = new Date(userData.data.created_at);
      if (createdAt > new Date("2019-01-01")) {
        console.log(
          `Skipping user ${username} - account too new (${userData.data.created_at})`
        );
        return null;
      }

      if (countProfileFields(userData.data) < 1) {
        console.log(`Skipping user ${username} - not enough profile fields`);
        return null;
      }

      // has more than 3.5k followers
      if (userData.data.followers > 3500) {
        console.log(
          `Skipping user ${username} - too many followers (${userData.data.followers})`
        );
        return null;
      }

      if (userData.data.following > 415) {
        console.log(
          `Skipping user ${username} - following too many people (${userData.data.following})`
        );
        return null;
      }
    }

    // Fetch contributions regardless of filters, but apply contribution filtering only if bypassFilters is false
    let contributions: ContributionData | null | undefined = undefined;
    try {
      contributions = await fetchContributions(username);

      if (!bypassFilters) {
        if (!contributions) {
          // If contributions couldn't be fetched and we are filtering, skip
          console.log(
            `Could not fetch contributions for ${username}, skipping.`
          );
          return null;
        }

        // skip ppl that have less than 30 followers and less than 3k contributions
        if (userData.data.followers <= 35 && contributions.totalSum < 3500) {
          console.log(
            `Skipping user ${username} - low contributions (${contributions.totalSum}) for low followers (${userData.data.followers})`
          );
          return null;
        }

        // medium following (36-60) requires 3000 contributions
        else if (
          userData.data.followers > 35 &&
          userData.data.followers <= 60 &&
          contributions.totalSum < 3000
        ) {
          console.log(
            `Skipping user ${username} - low contributions (${contributions.totalSum}) for medium followers (${userData.data.followers})`
          );
          return null;
        }

        // higher following (>60) requires 2000 contributions
        else if (
          userData.data.followers > 60 &&
          contributions.totalSum < 2000
        ) {
          console.log(
            `Skipping user ${username} - low contributions (${contributions.totalSum}) for higher followers (${userData.data.followers})`
          );
          return null;
        }

        // ---> ADD NEW CHECKS HERE ---
        if (contributions.calendar_weeks) {
          // Check if calendar data exists
          if (!isActiveInEnoughMonths(contributions.calendar_weeks)) {
            console.log(
              `Skipping user ${username} - not active in enough months.`
            );
            return null; // Skip user
          }
          // NOTE: Also remove the console.log from inside isWeekdayCoder if you don't want it in main logs
          if (isWeekdayCoder(contributions.calendar_weeks)) {
            console.log(
              `Skipping user ${username} - primarily a weekday coder.`
            );
            return null; // Skip user
          }
        } else {
          console.warn(
            `Warning: Could not perform contribution pattern checks for ${username} - calendar_weeks data missing.`
          );
          // Decide if you want to skip users if calendar data is missing, or let them pass
          // return null; // Optionally skip if calendar data is crucial
        }
        // --- END OF NEW CHECKS ---
      }
    } catch (error) {
      console.log(
        `Could not fetch contributions for ${username}. Error: ${error}`
      );
      // Only skip if we are filtering, otherwise proceed without contribution data
      if (!bypassFilters) {
        return null;
      }
      // If bypassing filters, we still want the user data even if contributions fail
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
    };
  } catch (error) {
    console.error(`Error scraping user ${username}:`, error);
    return null;
  }
}

export function isActiveInEnoughMonths(
  calendarWeeks: CalendarWeek[],
  minMonths: number = 8
): boolean {
  if (!calendarWeeks) return false;

  const activeMonths = new Set<string>(); // Store "YYYY-MM"

  calendarWeeks.forEach((week) => {
    week.contributionDays.forEach((day) => {
      if (day.contributionCount > 0) {
        // Extract YYYY-MM from the date string (e.g., "2024-10-25")
        const monthKey = day.date.substring(0, 7);
        activeMonths.add(monthKey);
      }
    });
  });

  // console.log(
  //   `  Active months count: ${activeMonths.size} (${Array.from(activeMonths)
  //     .sort()
  //     .join(", ")})`
  // );
  return activeMonths.size >= minMonths;
}

export function isWeekdayCoder(
  calendarWeeks: CalendarWeek[],
  weekdayThreshold: number = 0.9 // e.g., 90%
): boolean {
  if (!calendarWeeks) return false;

  let weekdayContributions = 0;
  let weekendContributions = 0;

  calendarWeeks.forEach((week) => {
    week.contributionDays.forEach((day) => {
      const date = new Date(day.date);
      const dayOfWeek = date.getUTCDay(); // 0 = Sunday, 6 = Saturday

      if (day.contributionCount > 0) {
        if (dayOfWeek >= 1 && dayOfWeek <= 5) {
          // Monday to Friday
          weekdayContributions += day.contributionCount;
        } else {
          // Saturday or Sunday
          weekendContributions += day.contributionCount;
        }
      }
    });
  });

  const totalContributions = weekdayContributions + weekendContributions;
  if (totalContributions === 0) {
    return false; // No contributions, not a weekday coder
  }

  const weekdayRatio = weekdayContributions / totalContributions;
  // console.log(
  //   `  Weekday Contribution Ratio: ${(weekdayRatio * 100).toFixed(
  //     1
  //   )}% (${weekdayContributions} weekday / ${weekendContributions} weekend)`
  // );
  return weekdayRatio >= weekdayThreshold;
}
