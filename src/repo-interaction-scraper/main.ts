import { Octokit } from "@octokit/core";
import dotenv from "dotenv";
import fs from "fs";
import player from "play-sound";
import { rateUserV2 } from "../rating/rate-users-v2.js";
import {
  GitHubRepo,
  interactionTypes,
  RepoSummary,
  UserData,
} from "../types.js";
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
  getLastProcessedPage,
  hasBeenScraped,
  loadScrapedRepos,
  markTypeAsCompleted,
  saveScrapedRepo,
} from "../utils/storage-utils.js";
import { primeTeamMembers, reposToScrape } from "../variables.js";
import { ContributionData } from "../graph-scraper/types.js";

// Load environment variables
dotenv.config();

const apiKey = process.env.GITHUB_ACCESS_TOKEN;
const octokit = new Octokit({ auth: apiKey });

// Add near the top of the file with other const declarations
const audioPlayer = player({});

// Update the getRepoInteractors function
async function getRepoInteractors(
  owner: string,
  repo: string,
  repoSummary: RepoSummary
) {
  const repoUrl = `https://github.com/${owner}/${repo}`;

  // Check if all interaction types have been scraped
  const scrapedRepo = loadScrapedRepos().find((r) => r.repoUrl === repoUrl);
  if (
    scrapedRepo &&
    scrapedRepo.scrapedTypes.includes("stargazer") &&
    scrapedRepo.scrapedTypes.includes("watcher") &&
    scrapedRepo.scrapedTypes.includes("forker") &&
    scrapedRepo.scrapedTypes.includes("contributor")
  ) {
    console.log(
      `Skipping ${repoUrl} - all interaction types already processed`
    );
    return;
  }

  // Get initial repo stats
  const repoInfo = await withRateLimitRetry(() =>
    octokit.request("GET /repos/{owner}/{repo}", {
      owner,
      repo,
    })
  );

  console.log("\nRepository Stats:");
  console.log(`Stars: ${repoInfo.data.stargazers_count}`);
  console.log(`Watchers: ${repoInfo.data.subscribers_count}`);
  console.log(`Forks: ${repoInfo.data.forks_count}`);
  console.log("-------------------");

  // Load existing data if file exists
  const interactors = new Map<string, UserData>();
  try {
    const existingData = JSON.parse(
      fs.readFileSync("dataOutputs/repointeracters-3.json", "utf8")
    );
    existingData.forEach((user: UserData) => {
      if (!user.repoInteractionScraped) {
        user.repoInteractionScraped = [];
      }
      interactors.set(user.login, user);
    });
    console.log(`Loaded ${interactors.size} existing users from database`);
  } catch (error) {
    console.log("No existing data found, starting fresh");
  }

  let processedCount = 0;
  let qualifiedCount = 0;
  let contributionCount = 0;
  let currentBatchSize = 0;
  let totalBatchSize = 0;

  console.log(`\nProcessing repository: ${owner}/${repo}`);

  function saveCurrentData() {
    fs.writeFileSync(
      "dataOutputs/repointeracters-3.json",
      JSON.stringify(Array.from(interactors.values()), null, 2)
    );
  }

  async function processUser(login: string, type: string) {
    try {
      processedCount++;

      // Skip prime engineers
      const isPrimeEngineer = primeTeamMembers.some(
        (url) => url.replace("https://github.com/", "") === login
      );
      if (isPrimeEngineer) {
        console.log(`Skipping user ${login} - prime engineer`);
        return;
      }

      // Check if user has already been processed for this interaction type
      if (interactors.has(login)) {
        const existing = interactors.get(login)!;
        const existingRepoIndex = existing.repoInteractionScraped.findIndex(
          (repo) => repo.scrapedFromUrl === repoUrl
        );

        if (
          existingRepoIndex !== -1 &&
          existing.repoInteractionScraped[
            existingRepoIndex
          ].interactionTypes.includes(type)
        ) {
          console.log(`User ${login} already processed for ${type}`);
          return;
        }
      }

      // Only increment currentBatchSize for new interactions
      currentBatchSize++;

      // Only log progress every 10 users or when batch is complete
      if (currentBatchSize % 10 === 0 || currentBatchSize === totalBatchSize) {
        const progress = ((currentBatchSize / totalBatchSize) * 100).toFixed(1);
        console.log(
          `${owner}/${repo} Progress: ${progress}% of ${type} (${currentBatchSize}/${totalBatchSize})`
        );
      }

      if (!interactors.has(login)) {
        const userData = await withRateLimitRetry(() =>
          octokit.request("GET /users/{username}", {
            username: login,
          })
        );

        // Check location using actual location data from profile
        if (
          userData.data.location &&
          isLocationInBadCountries(userData.data.location)
        ) {
          console.log(
            `Skipping user ${login} - located in China (${userData.data.location})`
          );
          return;
        }

        // Add follower count check
        if (userData.data.followers > 4000) {
          console.log(`Skipping user ${login} - more than 4000 followers`);
          return;
        }

        const createdAt = new Date(userData.data.created_at);
        if (createdAt > new Date("2020-01-01")) return;
        if (countProfileFields(userData.data) < 1) {
          console.log(
            "Not enough profile fields",
            countProfileFields(userData.data)
          );
          return;
        }

        let contributions: ContributionData | null = null;
        if (userData.data.followers >= 350) {
          contributions = await fetchContributions(login);
          if (!contributions) {
            console.log(`Could not fetch contributions for ${login}, skipping`);
            return;
          }
          // Increased threshold from 300 to 500
          if (contributions.totalSum < 500) return;
        } else if (userData.data.followers < 60) {
          contributions = await fetchContributions(login);
          if (!contributions) {
            console.log(`Could not fetch contributions for ${login}, skipping`);
            return;
          }
          // Increased threshold from 2000 to 2500
          if (contributions.totalSum < 2500) return;
        } else {
          contributions = await fetchContributions(login);
          if (!contributions) {
            console.log(`Could not fetch contributions for ${login}, skipping`);
            return;
          }
          // Increased threshold from 1000 to 1500
          if (contributions.totalSum < 1500) return;
        }

        qualifiedCount++;
        repoSummary.qualifiedUserLogins.push(login);

        const [profileReadme, recentRepositories, websiteContent, xProfile] =
          await Promise.all([
            fetchProfileReadme(login),
            fetchRecentRepositories(login, octokit),
            userData.data.blog
              ? fetchWebsiteContent(userData.data.blog)
              : Promise.resolve(null),
            userData.data.twitter_username
              ? fetchXProfileMetadata(userData.data.twitter_username)
              : Promise.resolve(null),
          ]);

        const normalizedLocation = normalizeLocation(userData.data.location);

        // Create base user data object to avoid repetition
        const baseUserData = {
          // Include required properties explicitly
          login: userData.data.login,
          profileUrl: userData.data.html_url || "",
          createdAt: userData.data.created_at,
          followers: userData.data.followers,
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
          repoInteractionScraped: [
            {
              scrapedFromUrl: repoUrl,
              interactionTypes: [type],
            },
          ],
          contributions: contributions || undefined,
          profileReadme: profileReadme || null,
          websiteContent: websiteContent || null,
          recentRepositories: recentRepositories?.map((repo: GitHubRepo) => ({
            id: repo.id,
            name: repo.name,
            full_name: repo.full_name,
            description: repo.description,
            language: repo.language,
            created_at: repo.created_at,
            updated_at: repo.updated_at,
            pushed_at: repo.pushed_at,
            stargazers_count: repo.stargazers_count,
            forks_count: repo.forks_count,
            topics: repo.topics,
          })),
        };

        // Rate the user
        const rating = await rateUserV2(baseUserData);

        // if score is below 20, skip
        if (rating.score < 20) {
          console.log(`Skipping user ${login} - score below 20`);
          return;
        }

        // log x score for xyz
        console.log(`https://github.com/${login} scored: ${rating.score}`);

        // Create the user profile with the rating
        const userProfile: UserData = {
          ...baseUserData,
          v2LlmRatingScore: rating,
        };

        interactors.set(login, userProfile);
        saveCurrentData();
      } else {
        const existing = interactors.get(login)!;
        let updated = false;

        const existingRepoIndex = existing.repoInteractionScraped.findIndex(
          (repo) => repo.scrapedFromUrl === repoUrl
        );

        if (existingRepoIndex === -1) {
          existing.repoInteractionScraped.push({
            scrapedFromUrl: repoUrl,
            interactionTypes: [type],
          });
          updated = true;
        } else if (
          !existing.repoInteractionScraped[
            existingRepoIndex
          ].interactionTypes.includes(type)
        ) {
          existing.repoInteractionScraped[
            existingRepoIndex
          ].interactionTypes.push(type);
          updated = true;
        }

        if (updated) {
          saveCurrentData();
        }
      }
    } catch (error) {
      console.error(`Error processing user ${login}`);
    }
  }

  // New function to handle scraping different interaction types
  async function scrapeInteractionType(
    interactionType: string,
    endpoint: string,
    getTotalCount: () => Promise<number>,
    extractLogin: (item: any) => string | null
  ) {
    // Check if this type has already been fully scraped
    const scrapedRepo = loadScrapedRepos().find((r) => r.repoUrl === repoUrl);
    if (scrapedRepo?.scrapedTypes.includes(interactionType)) {
      console.log(`Skipping ${interactionType}s - already fully scraped`);
      return;
    }

    console.log(`\nProcessing ${interactionType}s...`);

    // Get total count first
    totalBatchSize = await getTotalCount();
    console.log(`Found ${totalBatchSize} total ${interactionType}s to process`);

    // Skip if it's stargazers and count is too high
    if (interactionType === "stargazer" && totalBatchSize > 20000) {
      console.log(
        `Skipping ${interactionType}s - too many (${totalBatchSize} > 20000)`
      );
      return;
    }

    if (totalBatchSize === 0) {
      console.log(`No ${interactionType}s to process`);
      return;
    }

    try {
      let page = getLastProcessedPage(repoUrl, interactionType) || 1;
      let processedItems = 0; // Start from 0 and count actual processed users
      currentBatchSize = 0; // Start from 0 and count actual processed users

      // If we're resuming from a page, log that
      if (page > 1) {
        console.log(`Resuming from page ${page}`);
      }

      while (processedItems < totalBatchSize) {
        console.log(`\nFetching page ${page} of ${interactionType}s...`);
        const response = await withRateLimitRetry<any[]>(() =>
          octokit.request(endpoint, {
            owner,
            repo,
            per_page: Math.min(100, totalBatchSize - processedItems),
            page,
          })
        );

        if (!response.data || response.data.length === 0) {
          console.log(`No more ${interactionType}s to process`);
          break;
        }

        const itemsToProcess = Math.min(
          response.data.length,
          totalBatchSize - processedItems
        );

        console.log(
          `Processing ${itemsToProcess} ${interactionType}s from page ${page}`
        );

        for (let i = 0; i < itemsToProcess; i++) {
          const login = extractLogin(response.data[i]);
          if (login) {
            await processUser(login, interactionType);
          }
          processedItems++;
        }

        // Save progress after each page
        saveScrapedRepo(repoUrl, interactionType, page);

        if (response.data.length < 100 || processedItems >= totalBatchSize) {
          break;
        }
        page++;
      }

      console.log(
        `Completed processing ${interactionType}s: ${currentBatchSize}/${totalBatchSize}`
      );
      // audioPlayer.play("notification.mp3", (err: Error | null) => {
      //   if (err) console.error(`Error playing sound: ${err}`);
      // });

      // After successful completion, add this type to scrapedTypes
      markTypeAsCompleted(repoUrl, interactionType);
    } catch (error) {
      console.log(`Error processing ${interactionType}s: ${error}`);
    }
  }

  // Scrape stargazers
  await scrapeInteractionType(
    interactionTypes.stargazer,
    "GET /repos/{owner}/{repo}/stargazers",
    async () => {
      const repoInfo = await withRateLimitRetry(() =>
        octokit.request("GET /repos/{owner}/{repo}", {
          owner,
          repo,
        })
      );
      return repoInfo.data.stargazers_count;
    },
    (item) => item.login
  );

  // Scrape watchers
  await scrapeInteractionType(
    interactionTypes.watcher,
    "GET /repos/{owner}/{repo}/watchers",
    async () => {
      const repoInfo = await withRateLimitRetry(() =>
        octokit.request("GET /repos/{owner}/{repo}", {
          owner,
          repo,
        })
      );
      return repoInfo.data.subscribers_count;
    },
    (item) => item.login
  );

  // Scrape forkers
  await scrapeInteractionType(
    interactionTypes.forker,
    "GET /repos/{owner}/{repo}/forks",
    async () => {
      const repoInfo = await withRateLimitRetry(() =>
        octokit.request("GET /repos/{owner}/{repo}", {
          owner,
          repo,
        })
      );
      return repoInfo.data.forks_count;
    },
    (item) => item.owner?.login
  );

  // Scrape contributors (special case with different counting method)
  if (!hasBeenScraped(repoUrl, interactionTypes.contributor)) {
    console.log("\nProcessing contributors...");
    currentBatchSize = 0;
    totalBatchSize = 0;
    let page = 1;

    try {
      while (true) {
        const contributors = await withRateLimitRetry<any[]>(() =>
          octokit.request("GET /repos/{owner}/{repo}/contributors", {
            owner,
            repo,
            per_page: 100,
            page,
          })
        );

        if (contributors.data.length === 0) break;
        totalBatchSize += contributors.data.length;

        for (const contributor of contributors.data) {
          if (contributor.login) {
            await processUser(contributor.login, interactionTypes.contributor);
          }
        }

        if (contributors.data.length < 100) break;
        page++;
        // Save progress after each page
        saveScrapedRepo(repoUrl, interactionTypes.contributor, page);
      }

      console.log(
        `Completed processing contributors: ${currentBatchSize}/${totalBatchSize}`
      );
      // audioPlayer.play("notification.mp3", (err: Error | null) => {
      //   if (err) console.error(`Error playing sound: ${err}`);
      // });

      // After successful completion
      markTypeAsCompleted(repoUrl, interactionTypes.contributor);
    } catch (error) {
      console.log("No permission to view contributors, skipping...");
    }
  }

  // Update summary
  repoSummary.totalProcessed = processedCount;
  repoSummary.qualifiedUsers = qualifiedCount;
  repoSummary.usersWithContributions = contributionCount;

  console.log("\nRepository Summary:");
  console.log(`Total processed: ${processedCount}`);
  console.log(`Qualified users: ${qualifiedCount}`);
  console.log(`Users with contributions: ${contributionCount}`);
}

// Modify the processAllRepositories function
async function processAllRepositories() {
  const repoSummaries: RepoSummary[] = [];

  for (const repository of reposToScrape) {
    try {
      console.log(`\nProcessing repository: ${repository}`);
      const [owner, repo] = (repository as string)
        .replace("https://github.com/", "")
        .split("/");

      // Create a new summary object for this repo
      const repoSummary: RepoSummary = {
        repoUrl: repository as string,
        totalProcessed: 0,
        qualifiedUsers: 0,
        usersWithContributions: 0,
        qualifiedUserLogins: [],
      };

      // Modify getRepoInteractors to accept and update the summary
      await getRepoInteractors(owner, repo, repoSummary);

      repoSummaries.push(repoSummary);
      console.log(`Completed processing ${repository}\n`);
    } catch (error) {
      console.error(`Error processing repository ${repository}:`, error);
      console.log("Continuing with next repository...\n");
      continue;
    }
  }

  // Print consolidated summary at the end
  console.log("\n=== Consolidated Scraping Summary ===");
  console.log(`Total Repositories Processed: ${repoSummaries.length}`);
  console.log("\nPer Repository Breakdown:");
  console.log("----------------------------------------");

  let totalProcessed = 0;
  let totalQualified = 0;
  let totalWithContributions = 0;
  let allQualifiedUsers = new Set<string>();

  repoSummaries.forEach((summary) => {
    console.log(`\nRepository: ${summary.repoUrl}`);
    console.log(`- Total users processed: ${summary.totalProcessed}`);
    console.log(`- Qualified users found: ${summary.qualifiedUsers}`);
    console.log(
      `- Users with contributions: ${summary.usersWithContributions}`
    );
    console.log(`- Qualified users: ${summary.qualifiedUserLogins.join(", ")}`);

    totalProcessed += summary.totalProcessed;
    totalQualified += summary.qualifiedUsers;
    totalWithContributions += summary.usersWithContributions;
    summary.qualifiedUserLogins.forEach((user) => allQualifiedUsers.add(user));
  });

  console.log("\nOverall Totals:");
  console.log("----------------------------------------");
  console.log(`Total users processed across all repos: ${totalProcessed}`);
  console.log(`Total qualified users found: ${totalQualified}`);
  console.log(`Total users with contributions: ${totalWithContributions}`);
  console.log(
    `Unique qualified users across all repos: ${allQualifiedUsers.size}`
  );
  console.log("========================================\n");
}

// Replace the single repository call with the new function
processAllRepositories()
  .then(() => console.log("All repositories processed!"))
  .catch(console.error);
