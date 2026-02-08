import { Octokit } from "@octokit/core";
import { Collection } from "mongodb";
import { DbGraphUser, IgnoredReason } from "../../types.js";
import { discoverConnectionsPageByPage } from "./discover-connections.js";
import {
  fetchFollowersPaged,
  fetchFollowingPaged,
} from "./fetch-connections.js";
import { RapidAPICreditsExhaustedError } from "./linkedin-research.js";
import { scrapeUser } from "./scrape-user.js";

export interface ScraperConfig {
  maxDepth: number;
  minRatingToScrapeConnections: number;
  minRatingToScrapeFollowers: number;
}

/**
 * Processes a single user: scrapes profile + rating, then discovers connections.
 * Throws RapidAPICreditsExhaustedError if API credits are exhausted.
 */
export async function processUserFromBatch(
  userDoc: DbGraphUser,
  octokit: Octokit,
  usersCol: Collection<DbGraphUser>,
  edgesCol: Collection<any>,
  config: ScraperConfig
) {
  const username = userDoc._id;
  const depth = userDoc.depth ?? 0;

  try {
    const rating = await scrapeAndRateUser(
      username,
      depth,
      userDoc,
      octokit,
      usersCol
    );
    if (rating === null) return; // User was ignored or errored

    await scrapeConnections(
      username,
      depth,
      rating,
      userDoc,
      config,
      octokit,
      usersCol,
      edgesCol
    );

    await usersCol.updateOne(
      { _id: username },
      { $set: { status: "processed" } }
    );
  } catch (err) {
    if (err instanceof RapidAPICreditsExhaustedError) throw err;
    console.error(`[${username}] Error:`, err);
    await usersCol.updateOne(
      { _id: username },
      {
        $set: {
          status: "ignored",
          ignoredReason: IgnoredReason.ERROR_SCRAPING,
        },
      }
    );
  }
}

/**
 * Phase 1: Scrape profile and get rating. Returns the rating, or null if user was ignored/errored.
 */
async function scrapeAndRateUser(
  username: string,
  depth: number,
  userDoc: DbGraphUser,
  octokit: Octokit,
  usersCol: Collection<DbGraphUser>
): Promise<number | null> {
  if (userDoc.rating !== undefined) {
    console.log(
      `[${username}] Already rated (${userDoc.rating}). Skipping profile scrape.`
    );
    return userDoc.rating;
  }

  console.log(
    `[${username}] Scraping profile (depth ${depth}, priority ${userDoc.priority ?? "?"})...`
  );
  const { user } = await scrapeUser(octokit, username, depth, depth === 0);

  if (!user) {
    await usersCol.updateOne(
      { _id: username },
      {
        $set: {
          status: "ignored",
          ignoredReason: IgnoredReason.ERROR_SCRAPING,
        },
      }
    );
    return null;
  }

  if (user.status === "ignored") {
    await usersCol.updateOne(
      { _id: username },
      { $set: user as any },
      { upsert: true }
    );
    return null;
  }

  // Write user data but don't set status to "processed" yet (connections still needed)
  const { status, ...userData } = user;
  await usersCol.updateOne(
    { _id: username },
    { $set: userData as any },
    { upsert: true }
  );
  return user.rating ?? null;
}

/**
 * Phase 2: Discover connections based on rating thresholds.
 */
async function scrapeConnections(
  username: string,
  depth: number,
  rating: number,
  userDoc: DbGraphUser,
  config: ScraperConfig,
  octokit: Octokit,
  usersCol: Collection<DbGraphUser>,
  edgesCol: Collection<any>
) {
  if (depth >= config.maxDepth) {
    console.log(`[${username}] Max depth reached. Skipping connections.`);
    return;
  }

  if (rating < config.minRatingToScrapeConnections) {
    console.log(
      `[${username}] Rating ${rating} below threshold (${config.minRatingToScrapeConnections}). Skipping connections.`
    );
    return;
  }

  const connections = userDoc.scrapedConnections || {
    following: false,
    followers: false,
  };

  // Always scrape following (people this user vouches for)
  if (!connections.following) {
    console.log(`[${username}] Scraping following...`);
    await discoverConnectionsPageByPage(
      username,
      depth,
      rating,
      "following",
      fetchFollowingPaged,
      octokit,
      usersCol,
      edgesCol
    );
    await usersCol.updateOne(
      { _id: username },
      { $set: { "scrapedConnections.following": true } }
    );
  }

  // Scrape followers only for high-scoring users
  if (!connections.followers && rating >= config.minRatingToScrapeFollowers) {
    console.log(
      `[${username}] High scorer (${rating}) - also scraping followers...`
    );
    await discoverConnectionsPageByPage(
      username,
      depth,
      rating,
      "followers",
      fetchFollowersPaged,
      octokit,
      usersCol,
      edgesCol
    );
    await usersCol.updateOne(
      { _id: username },
      { $set: { "scrapedConnections.followers": true } }
    );
  }
}
