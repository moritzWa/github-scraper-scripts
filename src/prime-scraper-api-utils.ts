import { ContributionData } from "./types.js";

function isLinkedInDomain(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname.includes("linkedin.com") || hostname.endsWith("lnkd.in");
  } catch {
    return false;
  }
}

export async function fetchContributions(
  username: string
): Promise<ContributionData | null> {
  try {
    const toDate = new Date();
    const fromDate = new Date(toDate);
    fromDate.setFullYear(toDate.getFullYear() - 1);

    const query = `
      query {
        user(login: "${username}") {
          name
          contributionsCollection(from: "${fromDate.toISOString()}", to: "${toDate.toISOString()}") {
            contributionCalendar {
              totalContributions
              weeks {
                contributionDays {
                  date
                  contributionCount
                }
              }
            }
            totalCommitContributions
            totalIssueContributions
            totalPullRequestContributions
            restrictedContributionsCount
          }
        }
      }
    `;

    const response = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `bearer ${process.env.GITHUB_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    });

    const data = await response.json();

    if (data.errors) {
      console.error(`GraphQL errors for ${username}:`, data.errors);
      return null;
    }

    // Check if user exists in the response
    if (!data.data || !data.data.user) {
      console.error(`User ${username} not found in GitHub API response`);
      return null;
    }

    const contributions = data.data.user.contributionsCollection;
    const calendarWeeks = contributions.contributionCalendar.weeks;
    const totalContributions = {
      total_commits: contributions.totalCommitContributions,
      total_issues: contributions.totalIssueContributions,
      total_prs: contributions.totalPullRequestContributions,
      restricted_contributions: contributions.restrictedContributionsCount,
      calendar_total: contributions.contributionCalendar.totalContributions,
      totalSum:
        contributions.contributionCalendar.totalContributions +
        contributions.restrictedContributionsCount,
      calendar_weeks: calendarWeeks,
    };

    // Single concise log line for contributions
    // console.log(
    //   `${username}: ${totalContributions.calendar_total} public + ${totalContributions.restricted_contributions} restricted = ${totalContributions.totalSum} total contributions`
    // );

    return totalContributions;
  } catch (error) {
    console.error(`Error fetching contributions for ${username}:`, error);
    return null;
  }
}

export function countProfileFields(userData: any): number {
  // Only count optional/meaningful fields
  const fields = {
    bio: !!userData.bio,
    company: !!userData.company,
    blog: !!userData.blog,
    location: !!userData.location,
    email: !!userData.email,
    twitter_username: !!userData.twitter_username,
  };

  // Count how many optional fields are filled
  return Object.values(fields).filter(Boolean).length;
}

export class RateLimitError extends Error {
  resetDate: Date;
  waitTimeMs: number;

  constructor(resetTimestamp: number) {
    const resetDate = new Date(resetTimestamp * 1000);
    const waitTimeMs = resetDate.getTime() - Date.now();
    super(
      `Rate limit exceeded. Reset at ${resetDate.toLocaleString()}. Wait time: ${Math.ceil(
        waitTimeMs / 1000
      )} seconds`
    );
    this.resetDate = resetDate;
    this.waitTimeMs = waitTimeMs;
  }
}

export class ServerError extends Error {
  status: number;
  retryAfter: number;

  constructor(status: number, retryAfter: number) {
    super(`Server error (${status}). Retrying after ${retryAfter} seconds`);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export async function withRateLimitRetry<T>(
  fn: () => Promise<{ data: T }>,
  maxRetries: number = 5
): Promise<{ data: T }> {
  // Check if the function is a fetch request and contains a LinkedIn URL
  const fnString = fn.toString();
  if (fnString.includes("fetch") && fnString.match(/url: ["']([^"']+)["']/)) {
    const urlMatch = fnString.match(/url: ["']([^"']+)["']/);
    const url = urlMatch ? urlMatch[1] : "";
    if (isLinkedInDomain(url)) {
      console.log(`Skipping LinkedIn domain request: ${url}`);
      return { data: null as T };
    }
  }

  let retryCount = 0;
  let lastError: Error | null = null;

  while (retryCount < maxRetries) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      // If we hit the rate limit
      if (
        error.status === 403 &&
        error.response?.headers["x-ratelimit-remaining"] === "0"
      ) {
        const resetTimestamp = parseInt(
          error.response.headers["x-ratelimit-reset"] as string
        );
        const waitTimeMs = resetTimestamp * 1000 - Date.now();

        console.log(
          `Rate limit exceeded. Reset in minutes: ${waitTimeMs / 60000} minutes`
        );
        // Wait until reset time
        await new Promise((resolve) => setTimeout(resolve, waitTimeMs + 1000));
        continue;
      }

      // Handle server errors (5xx) with exponential backoff
      if (error.status >= 500 && error.status < 600) {
        const retryAfter = Math.min(Math.pow(2, retryCount), 30);
        console.log(
          `Server error (${
            error.status
          }). Retrying in ${retryAfter} seconds... (Attempt ${
            retryCount + 1
          }/${maxRetries})`
        );
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
        retryCount++;
        continue;
      }

      // If it's not a rate limit or server error, throw it
      throw error;
    }
  }

  // If we've exhausted all retries, throw the last error
  throw new Error(
    `Max retries (${maxRetries}) exceeded. Last error: ${lastError?.message}`
  );
}
