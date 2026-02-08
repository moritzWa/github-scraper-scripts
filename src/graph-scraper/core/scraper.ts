import { Octokit } from "@octokit/core";
import dotenv from "dotenv";
import { Collection, MongoClient } from "mongodb";
import { DbGraphUser, IgnoredReason } from "../types.js";
import { topProfiles } from "./profils.js";
import {
  fetchFollowersPaged,
  fetchFollowingPaged,
} from "./scraper-helpers/fetch-connections.js";
import { scrapeUser } from "./scraper-helpers/scrape-user.js";

dotenv.config();

const octokit = new Octokit({ auth: process.env.GITHUB_ACCESS_TOKEN });
const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017";
const dbName = process.env.MONGODB_DB;

// --- Configuration ---
const BATCH_SIZE = 5;
const MAX_DEPTH = 20;
const MIN_PRIORITY = 5; // Users below this priority won't be processed
const MIN_RATING_TO_SCRAPE_CONNECTIONS = 5; // Don't explore connections of low-scoring users
const MIN_RATING_TO_SCRAPE_FOLLOWERS = 12; // Only scrape followers of high-scoring users
const STATS_INTERVAL = 10; // Print stats every N batches
const SEED_PRIORITY = 100; // Seed users get highest priority

// Priority multipliers for edge direction.
// "following" = parent follows this user = parent vouches for them (strong signal).
// "followers" = this user follows the parent = weaker signal (anyone can follow).
const FOLLOWING_MULTIPLIER = 1.5;
const FOLLOWER_MULTIPLIER = 0.7;

function computePriority(
  parentRating: number,
  edgeDirection: "following" | "followers",
  childDepth: number
): number {
  const multiplier =
    edgeDirection === "following" ? FOLLOWING_MULTIPLIER : FOLLOWER_MULTIPLIER;
  return (
    Math.round((parentRating * multiplier) / Math.sqrt(childDepth) * 100) / 100
  );
}

// --- Connection Scraping ---
// Discovers new users via a parent's following/followers list.
// Each discovered user gets a priority based on the parent's rating and edge direction.
async function processConnectionsPageByPage(
  parentUsername: string,
  depth: number,
  parentRating: number,
  connectionType: "followers" | "following",
  fetchFunction: (
    username: string,
    octokit: Octokit
  ) => AsyncGenerator<string[], void, undefined>,
  usersCol: Collection<DbGraphUser>,
  edgesCol: Collection<any>
) {
  const childDepth = depth + 1;
  const childPriority = computePriority(parentRating, connectionType, childDepth);

  try {
    for await (const pageItems of fetchFunction(parentUsername, octokit)) {
      if (pageItems.length === 0) continue;

      // Insert edges
      const edgeDocs =
        connectionType === "followers"
          ? pageItems.map((item) => ({ from: item, to: parentUsername }))
          : pageItems.map((item) => ({ from: parentUsername, to: item }));

      await edgesCol
        .insertMany(edgeDocs, { ordered: false })
        .catch(() => {}); // Ignore duplicate edge errors

      // Upsert discovered users in chunks
      const CHUNK_SIZE = 100;
      for (let i = 0; i < pageItems.length; i += CHUNK_SIZE) {
        const chunk = pageItems.slice(i, i + CHUNK_SIZE);
        await usersCol
          .bulkWrite(
            chunk.map((newUsername: string) => ({
              updateOne: {
                filter: { _id: newUsername },
                update: {
                  $setOnInsert: {
                    _id: newUsername,
                    status: "pending" as const,
                    depth: childDepth,
                    discoveredVia: connectionType,
                    scrapedConnections: { followers: false, following: false },
                  },
                  // $max keeps the highest priority if user discovered by multiple parents
                  $max: { priority: childPriority },
                  $addToSet: {
                    parentRatings: {
                      parent: parentUsername,
                      rating: parentRating,
                    },
                  },
                },
                upsert: true,
              },
            }))
          )
          .catch((err: any) => {
            console.error(
              `Error upserting users from ${connectionType} for ${parentUsername}:`,
              err
            );
          });
      }
    }
  } catch (err) {
    console.error(
      `Error processing ${connectionType} for ${parentUsername}:`,
      err
    );
  }
}

// --- User Processing ---
async function processUserFromBatch(
  userDoc: DbGraphUser,
  usersCol: Collection<DbGraphUser>,
  edgesCol: Collection<any>
) {
  const username = userDoc._id;
  const depth = userDoc.depth ?? 0;

  try {
    let rating = userDoc.rating;

    // Phase 1: Profile scraping & rating (if not already done)
    if (rating === undefined) {
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
        return;
      }

      if (user.status === "ignored") {
        await usersCol.updateOne(
          { _id: username },
          { $set: user as any },
          { upsert: true }
        );
        return;
      }

      // Write user data but don't set status to "processed" yet (connections still needed)
      const { status, ...userData } = user;
      await usersCol.updateOne(
        { _id: username },
        { $set: userData as any },
        { upsert: true }
      );
      rating = user.rating;
    } else {
      console.log(
        `[${username}] Already rated (${rating}). Skipping profile scrape.`
      );
    }

    // Phase 2: Connection scraping
    if (depth >= MAX_DEPTH) {
      console.log(`[${username}] Max depth reached. Skipping connections.`);
      await usersCol.updateOne(
        { _id: username },
        { $set: { status: "processed" } }
      );
      return;
    }

    if (!rating || rating < MIN_RATING_TO_SCRAPE_CONNECTIONS) {
      console.log(
        `[${username}] Rating ${rating ?? "none"} below threshold (${MIN_RATING_TO_SCRAPE_CONNECTIONS}). Skipping connections.`
      );
      await usersCol.updateOne(
        { _id: username },
        { $set: { status: "processed" } }
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
      await processConnectionsPageByPage(
        username,
        depth,
        rating,
        "following",
        fetchFollowingPaged,
        usersCol,
        edgesCol
      );
      await usersCol.updateOne(
        { _id: username },
        { $set: { "scrapedConnections.following": true } }
      );
    }

    // Scrape followers only for high-scoring users
    if (!connections.followers && rating >= MIN_RATING_TO_SCRAPE_FOLLOWERS) {
      console.log(
        `[${username}] High scorer (${rating}) - also scraping followers...`
      );
      await processConnectionsPageByPage(
        username,
        depth,
        rating,
        "followers",
        fetchFollowersPaged,
        usersCol,
        edgesCol
      );
      await usersCol.updateOne(
        { _id: username },
        { $set: { "scrapedConnections.followers": true } }
      );
    }

    await usersCol.updateOne(
      { _id: username },
      { $set: { status: "processed" } }
    );
  } catch (err) {
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

// --- Stats ---
async function printStats(usersCol: Collection<DbGraphUser>) {
  const [
    queueSize,
    belowThreshold,
    processing,
    processed,
    ignored,
    highScorers,
    totalDiscovered,
  ] = await Promise.all([
    usersCol.countDocuments({
      status: "pending",
      priority: { $gte: MIN_PRIORITY },
    } as any),
    usersCol.countDocuments({
      status: "pending",
      $or: [
        { priority: { $lt: MIN_PRIORITY } },
        { priority: { $exists: false } },
      ],
    }),
    usersCol.countDocuments({ status: "processing" }),
    usersCol.countDocuments({ status: "processed" }),
    usersCol.countDocuments({ status: "ignored" }),
    usersCol.countDocuments({
      status: "processed",
      rating: { $gte: 12 },
    }),
    usersCol.countDocuments({}),
  ]);

  // Get top 5 high scorers for display
  const topScorers = await usersCol
    .find({ status: "processed", rating: { $gte: 12 } })
    .sort({ rating: -1 })
    .limit(5)
    .project({ _id: 1, rating: 1 })
    .toArray();
  const topStr = topScorers
    .map((u) => `${u._id}(${u.rating})`)
    .join(", ");

  console.log(`\n========== STATS ==========`);
  console.log(`Queue (processable):  ${queueSize}`);
  console.log(`Below threshold:      ${belowThreshold}`);
  console.log(`Processing:           ${processing}`);
  console.log(`Processed:            ${processed}`);
  console.log(`Ignored:              ${ignored}`);
  console.log(`Total discovered:     ${totalDiscovered}`);
  console.log(`High scorers (>=12):  ${highScorers}${topStr ? ` - top: ${topStr}` : ""}`);
  console.log(`===========================\n`);
}

// --- Main ---
async function main() {
  const client = new MongoClient(mongoUri, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });
  await client.connect();
  console.log(`Connected to MongoDB (${dbName})`);
  const db = client.db(dbName);
  const usersCol = db.collection<DbGraphUser>("users");
  const edgesCol = db.collection("edges");

  // Create indexes
  console.log("Ensuring indexes...");
  await Promise.all([
    usersCol.createIndex({ status: 1, priority: -1 }),
    usersCol.createIndex({ rating: 1 }),
  ]);
  console.log("Indexes ready.");

  // Insert seed users with highest priority
  for (const profile of topProfiles) {
    const username = profile.replace("https://github.com/", "");
    await usersCol.updateOne(
      { _id: username },
      {
        $setOnInsert: {
          _id: username,
          status: "pending" as const,
          depth: 0,
          priority: SEED_PRIORITY,
          parentRatings: [],
          scrapedConnections: { followers: false, following: false },
        },
      },
      { upsert: true }
    );
  }

  // Recovery: reset interrupted "processing" users back to "pending"
  const recovered = await usersCol.updateMany(
    { status: "processing" },
    { $set: { status: "pending" } }
  );
  if (recovered.modifiedCount > 0) {
    console.log(
      `Recovered ${recovered.modifiedCount} interrupted users back to pending.`
    );
  }

  // Assign default priority to old pending users without it
  const migrated = await usersCol.updateMany(
    { status: "pending", priority: { $exists: false } } as any,
    { $set: { priority: 0 } }
  );
  if (migrated.modifiedCount > 0) {
    console.log(
      `Assigned default priority to ${migrated.modifiedCount} legacy pending users.`
    );
  }

  // Re-queue processed users whose connections weren't scraped
  // (handles cases from previous runs with different logic)
  const requeued = await usersCol.updateMany(
    {
      status: "processed",
      rating: { $exists: true },
      depth: { $lt: MAX_DEPTH },
      "scrapedConnections.following": { $ne: true },
    },
    { $set: { status: "pending" } }
  );
  if (requeued.modifiedCount > 0) {
    console.log(
      `Re-queued ${requeued.modifiedCount} processed users with unsscraped connections.`
    );
  }

  let batchCount = 0;

  // Main loop: process users in priority order until queue is empty
  while (true) {
    batchCount++;

    if (batchCount === 1 || batchCount % STATS_INTERVAL === 0) {
      await printStats(usersCol);
    }

    // Fetch next batch sorted by priority (highest first)
    const pendingUsers = await usersCol
      .find({ status: "pending", priority: { $gte: MIN_PRIORITY } } as any)
      .sort({ priority: -1 } as any)
      .limit(BATCH_SIZE)
      .toArray();

    if (pendingUsers.length === 0) {
      await printStats(usersCol);
      const parkedCount = await usersCol.countDocuments({
        status: "pending",
        $or: [
          { priority: { $lt: MIN_PRIORITY } },
          { priority: { $exists: false } },
        ],
      });
      console.log(
        `Queue empty. Scraping complete.${parkedCount > 0 ? ` (${parkedCount} users parked below priority threshold)` : ""}`
      );
      break;
    }

    const priorities = pendingUsers.map((u: any) => u.priority ?? 0);
    console.log(
      `Batch ${batchCount}: ${pendingUsers.length} users ` +
        `[priority ${Math.min(...priorities).toFixed(1)}-${Math.max(...priorities).toFixed(1)}] ` +
        `(${pendingUsers.map((u) => u._id).join(", ")})`
    );

    // Mark as processing
    await usersCol.updateMany(
      { _id: { $in: pendingUsers.map((u) => u._id) } },
      { $set: { status: "processing" } }
    );

    // Process in parallel
    await Promise.all(
      pendingUsers.map((userDoc) =>
        processUserFromBatch(userDoc, usersCol, edgesCol)
      )
    );

    // Memory cleanup
    if (global.gc) global.gc();
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  await client.close();
  console.log("Done.");
}

main().catch(console.error);
