// graphScraper.ts
import { Octokit } from "@octokit/core";
import dotenv from "dotenv";
import fs from "fs";
import { withRateLimitRetry } from "../utils/prime-scraper-api-utils.js";
import { scrapeUser } from "./helpers.js";
import { topProfiles } from "./profils.js";
import { GraphUser } from "./types.js";

// Load environment variables
dotenv.config();

const apiKey = process.env.GITHUB_ACCESS_TOKEN;
const octokit = new Octokit({ auth: apiKey });

interface GraphData {
  users: GraphUser[];
  edges: Array<{
    from: string; // follower username
    to: string; // following username
  }>;
  processedUsernames: Set<string>;
  ignoredUsernames: Set<string>;
  maxDepth: number;
}

// Modified main function
async function scrapeUserGraph(
  startingProfiles: string[],
  maxDepth: number = 2
): Promise<GraphData> {
  const existingProgress = loadProgress();

  const graphData: GraphData = existingProgress || {
    users: [],
    edges: [],
    processedUsernames: new Set(),
    ignoredUsernames: new Set(),
    maxDepth,
  };

  const queue: { username: string; depth: number }[] = [];

  startingProfiles.forEach((profile) => {
    const username = profile.replace("https://github.com/", "");
    queue.push({ username, depth: 0 });
    graphData.processedUsernames.delete(username);
    graphData.ignoredUsernames.delete(username);
  });

  if (existingProgress) {
    console.log("Resuming from previous progress");
    // First, add any unprocessed users from the original topProfiles
    topProfiles.forEach((profile) => {
      const username = profile.replace("https://github.com/", "");
      if (
        !graphData.processedUsernames.has(username) &&
        !graphData.ignoredUsernames.has(username)
      ) {
        queue.push({ username, depth: 0 });
      }
    });

    // Then add unprocessed users from edges
    graphData.edges.forEach(({ from, to }) => {
      const fromUser = graphData.users.find((u) => u.login === from);
      if (fromUser && fromUser.depth < maxDepth) {
        if (
          !graphData.processedUsernames.has(to) &&
          !graphData.ignoredUsernames.has(to) &&
          !queue.some((q) => q.username === to) // Don't add if already in queue
        ) {
          queue.push({
            username: to,
            depth: fromUser.depth + 1,
          });
        }
      }
    });
  }

  console.log(`Starting with ${queue.length} users to process`);
  const initialProcessedCount = existingProgress
    ? existingProgress.processedUsernames.size
    : 0;
  const initialIgnoredCount = existingProgress
    ? existingProgress.ignoredUsernames.size
    : 0;
  console.log(`Loaded ${initialProcessedCount} processed users from file.`);
  console.log(`Loaded ${initialIgnoredCount} ignored users from file.`);

  let processedInThisRun = 0;

  // Process users in batches
  while (queue.length > 0) {
    // Take up to 5 users from the queue
    const batch = [];
    for (let i = 0; i < 5 && queue.length > 0; i++) {
      const next = queue.shift()!;
      if (
        !graphData.processedUsernames.has(next.username) &&
        !graphData.ignoredUsernames.has(next.username) &&
        next.depth <= maxDepth
      ) {
        batch.push(next);
      }
    }

    if (batch.length === 0) continue;

    // Process the batch in parallel
    try {
      await Promise.all(
        batch.map(async ({ username, depth }) => {
          console.log(`Processing ${username} at depth ${depth}`);
          try {
            const userData = await scrapeUser(
              octokit,
              username,
              depth,
              depth === 0
            );
            if (!userData) {
              graphData.ignoredUsernames.add(username);
              graphData.processedUsernames.delete(username);
              return null;
            }

            const existingUserIndex = graphData.users.findIndex(
              (u) => u.login === username
            );
            if (existingUserIndex !== -1) {
              graphData.users[existingUserIndex] = userData;
            } else {
              graphData.users.push(userData);
            }
            graphData.processedUsernames.add(username);

            if (depth < maxDepth) {
              // Fetch followers and following in parallel
              const [followers, following] = await Promise.all([
                fetchFollowers(username),
                fetchFollowing(username),
              ]);

              // Add edges
              followers.forEach((follower) => {
                graphData.edges.push({ from: follower, to: username });
              });
              following.forEach((followedUser) => {
                graphData.edges.push({ from: username, to: followedUser });
              });

              // Filter and queue new users
              const newUsers = [...followers, ...following].filter(
                (newUsername) =>
                  !graphData.processedUsernames.has(newUsername) &&
                  !graphData.ignoredUsernames.has(newUsername)
              );

              if (newUsers.length > 0) {
                console.log(
                  `Adding ${newUsers.length} new users to queue (depth ${
                    depth + 1
                  })`
                );
                newUsers.forEach((newUsername) => {
                  queue.push({ username: newUsername, depth: depth + 1 });
                });
              }
            }

            processedInThisRun++;
            return username;
          } catch (error) {
            console.error(`Error processing ${username}:`, error);
            graphData.ignoredUsernames.add(username);
            graphData.processedUsernames.delete(username);
            return null;
          }
        })
      );

      // Log progress for successfully processed users
      if (processedInThisRun % 50 === 0) {
        const totalProcessed = graphData.processedUsernames.size;
        const totalIgnored = graphData.ignoredUsernames.size;
        console.log(
          `--- Processed ${processedInThisRun} users this run (${totalProcessed} total processed, ${totalIgnored} total ignored). Queue size: ${queue.length} ---`
        );
      }

      // Save progress periodically
      if (queue.length % 5 === 0) {
        saveProgress(graphData);
      }
    } catch (error) {
      console.error("Batch processing error:", error);
      // Individual errors are already handled in the user processing
    }
  }

  console.log("\nScraping Summary:");
  const finalMaxDepth = graphData.maxDepth;
  for (let i = 0; i <= finalMaxDepth; i++) {
    const usersAtDepth = graphData.users.filter((u) => u.depth === i).length;
    console.log(`Depth ${i}: ${usersAtDepth} users`);
  }
  console.log(`Total processed: ${graphData.processedUsernames.size}`);
  console.log(`Total ignored: ${graphData.ignoredUsernames.size}`);
  console.log(`Total edges: ${graphData.edges.length}`);

  saveProgress(graphData);
  console.log("--- Final progress saved ---");

  return graphData;
}

// Helper function to fetch followers (only users, not organizations)
async function fetchFollowers(username: string): Promise<string[]> {
  const followers: string[] = [];
  let page = 1;

  while (true) {
    const response = await withRateLimitRetry(() =>
      octokit.request("GET /users/{username}/followers", {
        username,
        per_page: 100,
        page,
      })
    );

    if (response.data.length === 0) break;

    // Filter to include only users, not organizations
    followers.push(
      ...response.data
        .filter((user: any) => user.type === "User")
        .map((user: any) => user.login)
    );

    if (response.data.length < 100) break;
    page++;
  }

  return followers;
}

// Helper function to fetch following (only users, not organizations)
async function fetchFollowing(username: string): Promise<string[]> {
  const following: string[] = [];
  let page = 1;

  while (true) {
    const response = await withRateLimitRetry(() =>
      octokit.request("GET /users/{username}/following", {
        username,
        per_page: 100,
        page,
      })
    );

    if (response.data.length === 0) break;

    // Filter to include only users, not organizations
    following.push(
      ...response.data
        .filter((user: any) => user.type === "User")
        .map((user: any) => user.login)
    );

    if (response.data.length < 100) break;
    page++;
  }

  return following;
}

// Modified save/load functions
function saveProgress(graphData: GraphData) {
  const dataToSave = {
    users: graphData.users,
    edges: graphData.edges,
    processedUsernames: Array.from(graphData.processedUsernames),
    ignoredUsernames: Array.from(graphData.ignoredUsernames),
    maxDepth: graphData.maxDepth,
  };

  fs.writeFileSync(
    "dataOutputs/github-graph.json",
    JSON.stringify(dataToSave, null, 2)
  );
}

function loadProgress(): GraphData | null {
  try {
    const data = JSON.parse(
      fs.readFileSync("dataOutputs/github-graph.json", "utf8")
    );
    return {
      users: data.users,
      edges: data.edges,
      processedUsernames: new Set(data.processedUsernames),
      ignoredUsernames: new Set(data.ignoredUsernames),
      maxDepth: data.maxDepth,
    };
  } catch (error) {
    console.log("No previous progress found, starting fresh");
    return null;
  }
}

scrapeUserGraph(topProfiles, 2)
  .then(() => console.log("Graph scraping completed!"))
  .catch(console.error);
