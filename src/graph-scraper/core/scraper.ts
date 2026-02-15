import { Octokit } from "@octokit/core";
import dotenv from "dotenv";
import { Collection, MongoClient } from "mongodb";
import { DbGraphUser } from "../types.js";
import { topProfiles } from "./profils.js";
import { RapidAPICreditsExhaustedError } from "./scraper-helpers/linkedin-research.js";
import {
  processUserFromBatch,
  ScraperConfig,
} from "./scraper-helpers/process-user.js";

dotenv.config();

const octokit = new Octokit({ auth: process.env.GITHUB_ACCESS_TOKEN });
const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017";
const dbName = process.env.MONGODB_DB;

// --- Configuration ---
const BATCH_SIZE = 5;
const MAX_DEPTH = 20;
const MIN_PRIORITY = 5;
const STATS_INTERVAL = 10;
const SEED_PRIORITY = 100;

// Queue selection: multi-parent quality bonus
const GOOD_PARENT_THRESHOLD = 35; // parent rating considered "good"
const GOOD_PARENT_BONUS = 4; // priority bonus per good parent
const AVG_PARENT_WEIGHT = 0.15; // weight of average parent rating
const CANDIDATE_POOL_SIZE = 500; // top N by raw priority to re-rank

const SCRAPER_CONFIG: ScraperConfig = {
  maxDepth: MAX_DEPTH,
  minRatingToScrapeConnections: 25,
  minRatingToScrapeFollowers: 30,
};

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
  console.log(
    `High scorers (>=12):  ${highScorers}${topStr ? ` - top: ${topStr}` : ""}`
  );
  console.log(`===========================\n`);
}

// --- Startup ---
async function initializeDatabase(usersCol: Collection<DbGraphUser>) {
  console.log("Ensuring indexes...");
  await Promise.all([
    usersCol.createIndex({ status: 1, priority: -1 }),
    usersCol.createIndex({ rating: 1 }),
  ]);
  console.log("Indexes ready.");

  // Insert seed users
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

  // Recovery: reset interrupted "processing" users
  const recovered = await usersCol.updateMany(
    { status: "processing" },
    { $set: { status: "pending" } }
  );
  if (recovered.modifiedCount > 0) {
    console.log(
      `Recovered ${recovered.modifiedCount} interrupted users back to pending.`
    );
  }

  // Assign default priority to legacy pending users without it
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
      `Re-queued ${requeued.modifiedCount} processed users with unscraped connections.`
    );
  }
}

// --- Main Loop ---
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

  await initializeDatabase(usersCol);

  let batchCount = 0;

  while (true) {
    batchCount++;

    if (batchCount === 1 || batchCount % STATS_INTERVAL === 0) {
      await printStats(usersCol);
    }

    // Fetch next batch: get top candidates by raw priority, then re-rank
    // with multi-parent quality bonus (users discovered by many high-scoring
    // parents are better candidates)
    const pendingUsers = await usersCol
      .aggregate([
        { $match: { status: "pending", priority: { $gte: MIN_PRIORITY } } },
        { $sort: { priority: -1 } },
        { $limit: CANDIDATE_POOL_SIZE },
        {
          $addFields: {
            _goodParentCount: {
              $cond: [
                { $isArray: "$parentRatings" },
                {
                  $size: {
                    $filter: {
                      input: "$parentRatings",
                      as: "pr",
                      cond: { $gte: ["$$pr.rating", GOOD_PARENT_THRESHOLD] },
                    },
                  },
                },
                0,
              ],
            },
            _avgParentRating: {
              $cond: [
                {
                  $and: [
                    { $isArray: "$parentRatings" },
                    { $gt: [{ $size: "$parentRatings" }, 0] },
                  ],
                },
                { $avg: "$parentRatings.rating" },
                0,
              ],
            },
          },
        },
        {
          $addFields: {
            _effectivePriority: {
              $add: [
                "$priority",
                { $multiply: ["$_goodParentCount", GOOD_PARENT_BONUS] },
                { $multiply: ["$_avgParentRating", AVG_PARENT_WEIGHT] },
              ],
            },
          },
        },
        { $sort: { _effectivePriority: -1 } },
        { $limit: BATCH_SIZE },
      ])
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

    const effPriorities = pendingUsers.map((u: any) => u._effectivePriority ?? u.priority ?? 0);
    console.log(
      `Batch ${batchCount}: ${pendingUsers.length} users ` +
        `[priority ${Math.min(...effPriorities).toFixed(1)}-${Math.max(...effPriorities).toFixed(1)}] ` +
        `(${pendingUsers.map((u) => u._id).join(", ")})`
    );

    // Mark as processing
    await usersCol.updateMany(
      { _id: { $in: pendingUsers.map((u) => u._id) } },
      { $set: { status: "processing" } }
    );

    try {
      await Promise.all(
        pendingUsers.map((userDoc: any) =>
          processUserFromBatch(
            userDoc as DbGraphUser,
            octokit,
            usersCol,
            edgesCol,
            SCRAPER_CONFIG
          )
        )
      );
    } catch (err) {
      if (err instanceof RapidAPICreditsExhaustedError) {
        console.error(
          "\nRapidAPI credits exhausted! Exiting gracefully..."
        );
        // Reset any remaining "processing" users back to "pending"
        await usersCol.updateMany(
          { status: "processing" },
          { $set: { status: "pending" } }
        );
        await printStats(usersCol);
        break;
      }
      throw err;
    }

    if (global.gc) global.gc();
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  await client.close();
  console.log("Done.");
}

main().catch(console.error);
