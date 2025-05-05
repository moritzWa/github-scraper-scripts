import { Readability } from "@mozilla/readability";
import { Octokit } from "@octokit/core";
import { JSDOM, VirtualConsole } from "jsdom";
import { withRateLimitRetry } from "./prime-scraper-api-utils.js";
import { GitHubRepo, GitHubUser } from "./types.js";

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

export async function fetchRecentRepositories(
  username: string,
  octokit: Octokit
): Promise<Array<GitHubRepo> | null> {
  try {
    const repos = await withRateLimitRetry(() =>
      octokit.request("GET /users/{username}/repos", {
        username,
        sort: "updated",
        per_page: 10,
      })
    );

    return repos.data.map((repo) => ({
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
    }));
  } catch (error) {
    console.error(`Error fetching repositories for ${username}:`, error);
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
