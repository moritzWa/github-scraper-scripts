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
  } catch (err: any) {
    if (err instanceof RapidAPICreditsExhaustedError) throw err;

    // Transient errors (network timeouts, API issues) - re-queue as pending
    const isTransient = err?.message?.includes("LinkedIn fetch failed") ||
      err?.message?.includes("fetch failed") ||
      err?.message?.includes("ETIMEDOUT") ||
      err?.message?.includes("ECONNRESET");

    if (isTransient) {
      console.warn(`[${username}] Transient error, re-queuing: ${err?.message}`);
      await usersCol.updateOne(
        { _id: username },
        { $set: { status: "pending" } }
      );
    } else {
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
  const { user } = await scrapeUser(octokit, username, depth, depth === 0, usersCol);

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

  if (depth > 0 && rating < config.minRatingToScrapeConnections) {
    console.log(
      `[${username}] Rating ${rating} below threshold (${config.minRatingToScrapeConnections}). Skipping connections.`
    );
    return;
  }

  const connections = userDoc.scrapedConnections || {
    following: false,
    followers: false,
  };

  // Get best grandparent rating from this user's parentRatings
  const bestGrandparentRating = userDoc.parentRatings?.length
    ? Math.max(...userDoc.parentRatings.map((p) => p.rating))
    : undefined;

  // Seeds (depth 0) are manually curated - boost the parent rating passed to
  // connection discovery so their depth-1 connections get high queue priority,
  // regardless of the seed's own score.
  const effectiveParentRating = depth === 0 ? Math.max(rating, 60) : rating;

  // Always scrape following (people this user vouches for)
  if (!connections.following) {
    console.log(`[${username}] Scraping following...`);
    await discoverConnectionsPageByPage(
      username,
      depth,
      effectiveParentRating,
      "following",
      fetchFollowingPaged,
      octokit,
      usersCol,
      edgesCol,
      bestGrandparentRating
    );
    await usersCol.updateOne(
      { _id: username },
      { $set: { "scrapedConnections.following": true } }
    );
  }

  // Follower scraping disabled - followers are too noisy (random people follow
  // good engineers, signal is much weaker than "following" direction)
  // if (!connections.followers && rating >= config.minRatingToScrapeFollowers) {
  //   ...
  // }
}
