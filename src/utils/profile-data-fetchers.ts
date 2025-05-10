import { Readability } from "@mozilla/readability";
import { Octokit } from "@octokit/core";
import { JSDOM, VirtualConsole } from "jsdom";
import { OpenAI } from "openai";
import { GitHubUser } from "../graph-scraper/types.js";
import { GitHubRepo } from "../types.js";
import { withRateLimitRetry } from "./prime-scraper-api-utils.js";

export async function fetchWebsiteContent(url: string): Promise<string | null> {
  if (!url) return null;

  try {
    // Clean and validate the URL
    let cleanUrl = url.trim();

    // Skip invalid URLs or common non-website values
    if (
      cleanUrl === "/dev/null" ||
      cleanUrl === "null" ||
      cleanUrl === "undefined"
    ) {
      return null;
    }

    // Try to create a valid URL object (will throw if invalid)
    try {
      // Add protocol if missing
      if (!cleanUrl.startsWith("http")) {
        cleanUrl = "https://" + cleanUrl;
      }
      new URL(cleanUrl);
    } catch (e) {
      console.error(`Invalid URL: ${url}`);
      return null;
    }

    const response = await fetch(cleanUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; PrimeIntellectBot/1.0;)",
      },
      // Add timeout to avoid hanging
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.error(`Error fetching website ${cleanUrl}: ${response.status}`);
      return null;
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
      console.error(`Not an HTML page: ${cleanUrl} (${contentType})`);
      return null;
    }

    const html = await response.text();
    let doc;
    try {
      doc = new JSDOM(html, {
        url: cleanUrl,
        runScripts: "outside-only",
        resources: "usable",
        virtualConsole: new VirtualConsole().sendTo(console, {
          omitJSDOMErrors: true,
        }),
        pretendToBeVisual: false,
      });
    } catch (error) {
      // If JSDOM fails, try to create a minimal document
      doc = new JSDOM(html, {
        url: cleanUrl,
        runScripts: "outside-only",
        resources: "usable",
        virtualConsole: new VirtualConsole().sendTo(console, {
          omitJSDOMErrors: true,
        }),
        pretendToBeVisual: false,
      });
    }
    const reader = new Readability(doc.window.document);
    const article = reader.parse();

    if (!article) {
      // console.error(`Could not parse content from ${cleanUrl}`);
      return null;
    }

    // Combine title and content, limit length
    const content = `${article.title}\n\n${article.textContent}`
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 2000);

    return content;
  } catch (error) {
    // More specific error logging
    if (error instanceof TypeError && error.message.includes("fetch failed")) {
      console.error(
        `Network error fetching ${url}: ${
          (error as any).cause || error.message
        }`
      );
    } else {
      console.error(`Error processing website ${url}:`, error);
    }
    return null;
  }
}

export function countProfileFields(userData: GitHubUser): number {
  let count = 0;
  if (userData.bio) count++;
  if (userData.twitter_username) count++;
  if (userData.blog) count++;
  if (userData.location) count++;
  return count;
}

export async function fetchProfileReadme(
  username: string
): Promise<string | null> {
  try {
    const response = await fetch(
      `https://raw.githubusercontent.com/${username}/${username}/main/README.md`
    );
    if (response.ok) {
      return await response.text();
    }
    return null;
  } catch (error) {
    console.error(`Error fetching README for ${username}:`, error);
    return null;
  }
}

function calculateRepoScore(repo: GitHubRepo): number {
  // Base score from stars
  const starScore = repo.stargazers_count * 2;

  // Activity score based on last update
  const lastUpdate = repo.updated_at ? new Date(repo.updated_at).getTime() : 0;
  const now = Date.now();
  const daysSinceUpdate = (now - lastUpdate) / (1000 * 60 * 60 * 24);
  const activityScore = Math.max(0, 100 - daysSinceUpdate); // Decay score over time

  // Fork score
  const forkScore = repo.forks_count;

  // Combined score with weights
  return starScore + activityScore * 0.5 + forkScore * 0.3;
}

export async function fetchRecentRepositories(
  username: string,
  octokit: Octokit
): Promise<Array<GitHubRepo> | null> {
  try {
    const repos = await withRateLimitRetry(() =>
      octokit.request("GET /users/{username}/repos", {
        username,
        sort: "updated", // Always fetch by updated to get recent activity
        per_page: 100, // Fetch more repos to have a better sample for sorting
      })
    );

    const mappedRepos = repos.data.map((repo) => ({
      id: repo.id,
      name: repo.name,
      full_name: repo.full_name,
      description: repo.description,
      language: repo.language || null,
      created_at: repo.created_at || null,
      updated_at: repo.updated_at || null,
      pushed_at: repo.pushed_at || null,
      stargazers_count: repo.stargazers_count || 0,
      forks_count: repo.forks_count || 0,
      topics: repo.topics || [],
      is_fork: repo.fork, // Include fork information
    }));

    // Always use combined sorting
    mappedRepos.sort((a, b) => calculateRepoScore(b) - calculateRepoScore(a));

    // Return top 10 after sorting
    return mappedRepos.slice(0, 10);
  } catch (error) {
    console.error(`Error fetching repositories for ${username}:`, error);
    return null;
  }
}

export async function fetchUserEmailFromEvents(
  username: string,
  octokit: Octokit
): Promise<string | null> {
  let mostRecentNoreplyEmail: string | null = null;
  const MAX_PAGES_TO_CHECK = 3;

  try {
    for (let page = 1; page <= MAX_PAGES_TO_CHECK; page++) {
      const events = await withRateLimitRetry(() =>
        octokit.request("GET /users/{username}/events/public", {
          username,
          per_page: 30, // Fetch 30 events per page
          page: page,
        })
      );

      if (events.data && events.data.length > 0) {
        for (const event of events.data) {
          if (event.type === "PushEvent" && event.payload) {
            const payload = event.payload as any;
            if (payload.commits && payload.commits.length > 0) {
              for (const commit of payload.commits) {
                if (commit.author && commit.author.email) {
                  const email = commit.author.email as string;
                  // Prefer non-noreply emails
                  if (!email.endsWith("@users.noreply.github.com")) {
                    return email; // Found a non-noreply email, return immediately
                  }
                  // Keep track of the first noreply email encountered (which will be the most recent)
                  if (!mostRecentNoreplyEmail) {
                    mostRecentNoreplyEmail = email;
                  }
                }
              }
            }
          }
        }
      } else {
        // No more events to fetch for this user
        break;
      }
    }
    // If loop finishes, it means no non-noreply email was found.
    // Return the most recent noreply email found, or null if none.
    return mostRecentNoreplyEmail;
  } catch (error) {
    console.error(
      `Error fetching user email from events for ${username}:`,
      error
    );
    return null;
  }
}

export async function fetchXProfileMetadata(username: string): Promise<{
  bio: string | null;
  name: string | null;
  location: string | null;
} | null> {
  if (!username) return null;

  try {
    const url = `https://x.com/${username}`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; PrimeIntellectBot/1.0;)",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.error(`Error fetching X profile ${username}: ${response.status}`);
      return null;
    }

    const html = await response.text();
    const doc = new JSDOM(html);
    const meta = doc.window.document.getElementsByTagName("meta");

    const metadata: {
      bio: string | null;
      name: string | null;
      location: string | null;
    } = {
      bio: null,
      name: null,
      location: null,
    };

    // Extract OpenGraph metadata
    for (const tag of meta) {
      const property = tag.getAttribute("property");
      const content = tag.getAttribute("content");

      if (!content) continue;

      switch (property) {
        case "og:description":
          metadata.bio = content;
          break;
        case "og:title":
          metadata.name = content;
          break;
        case "og:site_name":
          if (content.includes("X (formerly Twitter)")) {
            // Try to find location in the page content
            const locationElement = doc.window.document.querySelector(
              '[data-testid="UserLocation"]'
            );
            if (locationElement) {
              metadata.location = locationElement.textContent;
            }
          }
          break;
      }
    }

    // console.log(JSON.stringify(metadata, null, 2));

    return metadata;
  } catch (error) {
    console.error(`Error fetching X profile for ${username}:`, error);
    return null;
  }
}

export async function fetchLinkedInProfile(
  user: {
    name: string | null;
    login: string;
    company: string | null;
    bio: string | null;
    xBio: string | null;
    email: string | null;
  },
  openai: OpenAI
): Promise<string | null> {
  try {
    const prompt = `Find the LinkedIn profile URL for ${
      user.name || user.login
    } (GitHub username: ${user.login}). 
    Additional context:
    - Current company: ${user.company || "Unknown"}
    - Bio: ${user.bio || user.xBio || "No bio available"}
    - Email: ${user.email || "No email available"}
    
    Return ONLY the full LinkedIn profile URL. If you cannot find the LinkedIn profile, return null.`;

    const response = await openai.responses.create({
      model: "gpt-4o",
      tools: [
        {
          type: "web_search_preview",
          search_context_size: "medium",
        },
      ],
      input: prompt,
    });

    const result = response.output_text?.trim() || null;
    return result === "null" ? null : result;
  } catch (error) {
    console.error(`Error fetching LinkedIn profile for ${user.login}:`, error);
    return null;
  }
}
