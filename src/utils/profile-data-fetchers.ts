import { Octokit } from "@octokit/core";
import { JSDOM } from "jsdom";
import puppeteer, { Browser } from "puppeteer";
import treeKill from "tree-kill";
import { GitHubUser } from "../graph-scraper/types.js";
import { GitHubRepo } from "../types.js";
import { withRateLimitRetry } from "./prime-scraper-api-utils.js";

const MAX_CONTENT_LENGTH = 7500;

// --- Singleton browser management ---
let _browser: Browser | null = null;
let _browserUseCount = 0;
const BROWSER_RECYCLE_AFTER = 30; // recycle after N uses to prevent memory creep

const CHROME_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-extensions",
  "--disable-component-extensions-with-background-pages",
  "--disable-default-apps",
  "--mute-audio",
  "--no-first-run",
  "--no-zygote",
  "--single-process",
  "--disable-crashpad-for-testing",
];

async function killBrowser(browser: Browser): Promise<void> {
  const pid = browser.process()?.pid;
  // Try graceful close with 3s timeout, then force kill
  try {
    await Promise.race([
      browser.close(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("close timeout")), 3000)
      ),
    ]);
  } catch (_) {
    if (pid) {
      await new Promise<void>((resolve) =>
        treeKill(pid, "SIGKILL", () => resolve())
      );
    }
  }
}

async function getBrowser(): Promise<Browser> {
  if (_browser && _browser.connected && _browserUseCount < BROWSER_RECYCLE_AFTER) {
    _browserUseCount++;
    return _browser;
  }
  // Recycle: kill old browser first
  if (_browser) {
    await killBrowser(_browser);
    _browser = null;
  }
  _browserUseCount = 1;
  _browser = await puppeteer.launch({
    headless: true,
    args: CHROME_ARGS,
    protocolTimeout: 10_000,
  });
  return _browser;
}

// Clean up on process exit
async function cleanupBrowser() {
  if (_browser) {
    await killBrowser(_browser);
    _browser = null;
  }
}
process.on("SIGINT", async () => { await cleanupBrowser(); process.exit(0); });
process.on("SIGTERM", async () => { await cleanupBrowser(); process.exit(0); });

export async function fetchWebsiteContent(url: string): Promise<string | null> {
  if (!url) return null;

  // Clean and validate the URL
  let cleanUrl = url.trim();
  if (
    cleanUrl === "/dev/null" ||
    cleanUrl === "null" ||
    cleanUrl === "undefined"
  ) {
    return null;
  }
  try {
    if (!cleanUrl.startsWith("http")) {
      cleanUrl = "https://" + cleanUrl;
    }
    new URL(cleanUrl);
  } catch (e) {
    console.error(`Invalid URL: ${url}`);
    return null;
  }

  // Hard timeout: 10s total for the entire operation
  const HARD_TIMEOUT_MS = 10_000;
  const PAGE_TIMEOUT_MS = 6_000;

  return new Promise<string | null>((resolveOuter) => {
    let settled = false;
    const finish = (val: string | null) => {
      if (!settled) {
        settled = true;
        resolveOuter(val);
      }
    };

    const hardTimer = setTimeout(() => {
      console.error(
        `[fetchWebsiteContent] Hard timeout (${HARD_TIMEOUT_MS}ms) for ${cleanUrl}`
      );
      finish(null);
    }, HARD_TIMEOUT_MS);

    (async () => {
      let page: any = null;
      try {
        const browser = await getBrowser();
        page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });
        await page.setUserAgent(
          "Mozilla/5.0 (compatible; PrimeIntellectBot/1.0;)"
        );
        page.setDefaultNavigationTimeout(PAGE_TIMEOUT_MS);
        page.setDefaultTimeout(PAGE_TIMEOUT_MS);

        await page.goto(cleanUrl, {
          waitUntil: "domcontentloaded",
          timeout: PAGE_TIMEOUT_MS,
        });

        const html = await page.content();
        clearTimeout(hardTimer);
        finish(html);
      } catch (error: any) {
        console.error(
          `Error fetching website content: ${error?.message || error}`
        );
        clearTimeout(hardTimer);
        finish(null);
      } finally {
        // Always close the page, never the browser
        try {
          if (page) await page.close();
        } catch (_) {}
      }
    })();
  });
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
                  // Skip bot emails and GitHub Actions emails
                  if (
                    email.includes("[bot]") ||
                    email.includes("github-actions")
                  ) {
                    continue;
                  }
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
