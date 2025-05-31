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

const testingScraper = process.env.MONGODB_DB === "githubScraper-test";

const apiKey = process.env.GITHUB_ACCESS_TOKEN;
const octokit = new Octokit({ auth: apiKey });
const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017";
const dbName = process.env.MONGODB_DB;
const maxDepth = 20;
const RATING_THRESHOLD_FOR_D2ETC = 50;
const BATCH_SIZE = 5;

// Criteria for scraping followers based on parent ratings
const MIN_HIGH_RATING_PARENTS_FOR_FOLLOWER_SCRAPE = 3;
const RATING_THRESHOLD_FOR_FOLLOWER_SCRAPE_PARENTS = 40;

// Memory optimization: Cache the total count and update it less frequently
let cachedTotalProcessable = 0;
let lastCountUpdate = 0;
const COUNT_UPDATE_INTERVAL = 20; // Update count every 10 batches

// --- Reusable Connection Processing Function ---
async function processConnectionsPageByPage(
  parentUsername: string,
  depth: number,
  parentRating: number | undefined,
  connectionType: "followers" | "following",
  fetchFunction: (
    username: string,
    octokit: Octokit
  ) => AsyncGenerator<string[], void, undefined>,
  usersCol: Collection<DbGraphUser>,
  edgesCol: Collection<any>
) {
  try {
    for await (const pageItems of fetchFunction(parentUsername, octokit)) {
      if (pageItems.length > 0) {
        const edgeDocs =
          connectionType === "followers"
            ? pageItems.map((item) => ({ from: item, to: parentUsername }))
            : pageItems.map((item) => ({ from: parentUsername, to: item }));

        await edgesCol
          .insertMany(edgeDocs, { ordered: false })
          .catch((err: any) => {
            console.error(
              `Error inserting ${connectionType} edges for ${parentUsername}, page:`,
              err
            );
          });

        // Process in smaller chunks to reduce memory pressure
        const CHUNK_SIZE = 100;
        for (let i = 0; i < pageItems.length; i += CHUNK_SIZE) {
          const chunk = pageItems.slice(i, i + CHUNK_SIZE);

          await usersCol
            .bulkWrite(
              chunk.map((newUsername: string) => {
                const childDepth = depth + 1;
                const updateOnInsertFields: Partial<DbGraphUser> & {
                  _id: string;
                } = {
                  _id: newUsername,
                  status: "pending",
                  depth: childDepth,
                  // Initialize scrapedConnections for new users discovered via edges
                  scrapedConnections: { followers: false, following: false },
                };

                const updateDefinition: any = {
                  $setOnInsert: updateOnInsertFields,
                };

                if (parentRating !== undefined) {
                  updateDefinition.$addToSet = {
                    parentRatings: {
                      parent: parentUsername,
                      rating: parentRating,
                    },
                  };
                } else {
                  // Ensure parentRatings array exists if no specific rating is added
                  // This might be redundant if $setOnInsert already creates it,
                  // but can be explicit if parentRatings is optional and might not be set by $setOnInsert alone.
                  // However, given the current structure, if parentRating is undefined,
                  // parentRatings might not be initialized by $addToSet.
                  // Let's ensure it's initialized if not already via $setOnInsert logic.
                  // If updateOnInsertFields.parentRatings is already [], this is fine.
                  // If parentRatings can be null/undefined by default, we might need:
                  // $setOnInsert: { ...updateOnInsertFields, parentRatings: [] }
                  // For now, assuming updateOnInsertFields handles initialization correctly or it's handled by schema defaults.
                }

                return {
                  updateOne: {
                    filter: { _id: newUsername },
                    update: updateDefinition,
                    upsert: true,
                  },
                };
              })
            )
            .catch((err: any) => {
              console.error(
                `Error upserting new users from ${connectionType} for ${parentUsername}, chunk:`,
                err
              );
            });
        }
      }
    }
  } catch (err) {
    console.error(
      `Error in ${connectionType} processing stream for ${parentUsername}:`,
      err
    );
    throw err;
  }
}

async function processUserFromBatch(
  userDoc: DbGraphUser,
  usersCol: Collection<DbGraphUser>,
  edgesCol: Collection<any>,
  octokitInstance: Octokit,
  currentMaxDepth: number
) {
  const username = userDoc._id;
  const depth = typeof userDoc.depth === "number" ? userDoc.depth : 0;

  console.log(
    `[Batch Processing] Starting to process ${username} at depth ${depth}.`
  );

  try {
    let userToProcess: Partial<DbGraphUser> = { ...userDoc };
    let performedScrape = false;

    if (!userDoc.rating) {
      console.log(`[${username}] No rating found. Calling scrapeUser.`);
      const { user: freshlyScrapedUser } = await scrapeUser(
        octokitInstance,
        username,
        depth,
        depth === 0
      );

      if (!freshlyScrapedUser) {
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
      userToProcess = freshlyScrapedUser;
      performedScrape = true;
    } else {
      console.log(
        `[${username}] Existing rating ${userDoc.rating} found. Skipping scrapeUser.`
      );
    }

    if (performedScrape) {
      const updateFields: Partial<DbGraphUser> = { ...userToProcess };
      if (userToProcess.status === "processed") {
        updateFields.scrapedConnections = {
          followers: false,
          following: false,
        };
      }
      await usersCol.updateOne(
        { _id: username },
        { $set: updateFields },
        { upsert: true }
      );
    }

    await manageConnectionsAndUpdateStatus(
      username,
      depth,
      currentMaxDepth,
      userToProcess,
      userDoc,
      performedScrape,
      usersCol,
      edgesCol
    );
  } catch (err) {
    console.error(`Error processing ${username}:`, err);
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

async function manageConnectionsAndUpdateStatus(
  username: string,
  depth: number,
  currentMaxDepth: number,
  userToProcess: Partial<DbGraphUser>,
  userDoc: DbGraphUser,
  performedScrape: boolean,
  usersCol: Collection<DbGraphUser>,
  edgesCol: Collection<any>
) {
  const userWasJustScraped = userToProcess.status === "processed";
  const userRequeuedForConnectionScraping =
    userDoc.rating !== undefined && userDoc.status === "pending";
  const userRating = userToProcess.rating ?? userDoc.rating;

  if (
    (userWasJustScraped || userRequeuedForConnectionScraping) &&
    depth < currentMaxDepth
  ) {
    // RATING IS REQUIRED TO SCRAPE CONNECTIONS
    if (userRating === undefined) {
      console.error(
        `[${username}] Cannot scrape connections: rating is undefined. Status: ${userToProcess.status}, Original DB Status: ${userDoc.status}`
      );
      // Potentially set to ignored or error if rating is crucial and missing
      return;
    }
    const parentRatingForChildren = userRating;
    const connectionPromises = [];

    let currentUserConnectionsState = (
      await usersCol.findOne({ _id: username })
    )?.scrapedConnections ?? { following: false, followers: false };

    // SCRAPING FOLLOWING IF NOT DONE
    if (!currentUserConnectionsState.following) {
      console.log(`[${username}] Scraping 'following' connections.`);
      connectionPromises.push(
        processConnectionsPageByPage(
          username,
          depth,
          parentRatingForChildren,
          "following",
          fetchFollowingPaged,
          usersCol,
          edgesCol
        ).then(async () => {
          await usersCol.updateOne(
            { _id: username },
            { $set: { "scrapedConnections.following": true } }
          );
          currentUserConnectionsState.following = true; // Update local state
          console.log(
            `[${username}] 'following' connections marked as scraped.`
          );
        })
      );
    }

    // Helper to determine if followers should be scraped based on parent ratings.
    const shouldScrapeFollowersBasedOnParentRatings = () => {
      const actualParentRatings = userDoc.parentRatings || [];
      if (
        actualParentRatings.length >=
        MIN_HIGH_RATING_PARENTS_FOR_FOLLOWER_SCRAPE
      ) {
        const averageParentRating =
          actualParentRatings.reduce((sum, pr) => sum + pr.rating, 0) /
          actualParentRatings.length;
        return (
          averageParentRating >= RATING_THRESHOLD_FOR_FOLLOWER_SCRAPE_PARENTS
        );
      }
      return false;
    };

    const meetsFollowerScrapeCriteria =
      shouldScrapeFollowersBasedOnParentRatings();

    // SCRAPING FOLLOWERS IF NOT DONE AND MEETS CRITERIA
    if (!currentUserConnectionsState.followers && meetsFollowerScrapeCriteria) {
      console.log(
        `[${username}] Meets criteria. Scraping 'followers' connections.`
      );
      connectionPromises.push(
        processConnectionsPageByPage(
          username,
          depth,
          parentRatingForChildren, // Pass parent's rating for new edges/nodes
          "followers",
          fetchFollowersPaged, // You'll need to create and import this
          usersCol,
          edgesCol
        ).then(async () => {
          await usersCol.updateOne(
            { _id: username },
            { $set: { "scrapedConnections.followers": true } }
          );
          console.log(
            `[${username}] 'followers' connections marked as scraped.`
          );
        })
      );
    } else if (
      !currentUserConnectionsState.followers &&
      !meetsFollowerScrapeCriteria
    ) {
      console.log(
        `[${username}] Does not meet criteria for scraping 'followers' or already scraped. ParentRatings count: ${userDoc.parentRatings?.length}, Meets criteria: ${meetsFollowerScrapeCriteria}`
      );
    }

    if (connectionPromises.length > 0) {
      await Promise.all(connectionPromises);
      console.log(`[${username}] Connection scraping attempts finished.`);
    }

    // UPDATING STATUS TO PROCESSED IF ALL APPLICABLE CONNECTIONS ARE DONE
    if (!performedScrape && userDoc.rating !== undefined) {
      // Only for users who weren't freshly fully scraped but were requeued for connections
      const finalConnectionState = (await usersCol.findOne({ _id: username }))
        ?.scrapedConnections;

      const followingDone = finalConnectionState?.following === true;
      const followersDone = finalConnectionState?.followers === true;

      // Determine if follower scraping *should* have been done
      const followerScrapingWasApplicable = meetsFollowerScrapeCriteria;

      if (
        followingDone &&
        (followerScrapingWasApplicable ? followersDone : true)
      ) {
        await usersCol.updateOne(
          { _id: username },
          { $set: { status: "processed" } }
        );
        console.log(
          `[${username}] Skipped main scrape. 'Following' ${
            followingDone ? "done" : "not done/NA"
          }. 'Followers' ${
            followersDone
              ? "done"
              : followerScrapingWasApplicable
              ? "not done"
              : "NA"
          }. Status set to 'processed'.`
        );
      } else {
        console.log(
          `[${username}] Skipped main scrape. Connections not fully processed. Following: ${followingDone}, Followers: ${followersDone} (Applicable: ${followerScrapingWasApplicable})`
        );
      }
    }

    // ALREADY SCRAPED FOLLOWERS
  } else if (depth >= currentMaxDepth) {
    console.log(
      `[${username}] Max depth ${currentMaxDepth} reached (depth ${depth}). Not fetching further connections.`
    );
    if (
      !performedScrape &&
      userDoc.rating !== undefined &&
      userToProcess.status !== "processed"
    ) {
      await usersCol.updateOne(
        { _id: username },
        { $set: { status: "processed" } }
      );
      console.log(
        `[${username}] Skipped scrape, at max depth. Status set to 'processed'.`
      );
    }

    // NOT FETCHING BC DEPTH IS TOO HIGH
  } else if (
    userToProcess.status !== "processed" &&
    !(userDoc.rating !== undefined && userDoc.status === "pending")
  ) {
    console.log(
      `[${username}] User status is '${userToProcess.status}'. Not fetching connections.`
    );
  }
}

async function main() {
  const client = new MongoClient(mongoUri, {
    maxPoolSize: 10, // Limit connection pool size
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });
  await client.connect();
  const db = client.db(dbName);
  const usersCol = db.collection<DbGraphUser>("users");
  const edgesCol = db.collection("edges");

  // Create indexes for better query performance
  console.log("Ensuring database indexes...");
  await usersCol.createIndex({ status: 1, depth: 1 });
  await usersCol.createIndex({ "parentRatings.rating": 1 });
  await usersCol.createIndex({ rating: 1 });
  await usersCol.createIndex({ "scrapedConnections.following": 1 });
  await usersCol.createIndex({ "scrapedConnections.followers": 1 });
  await usersCol.createIndex({
    "parentRatings.parent": 1,
    "parentRatings.rating": 1,
  });
  console.log("Database indexes created/verified.");

  if (!testingScraper) {
    for (const profile of topProfiles) {
      const username = profile.replace("https://github.com/", "");
      await usersCol.updateOne(
        { _id: username },
        {
          $setOnInsert: {
            _id: username,
            status: "pending",
            depth: 0,
            parentRatings: [],
            scrapedConnections: {
              followers: false,
              following: false,
            },
          },
        },
        { upsert: true }
      );
    }
  }

  const requeueForFollowingScraping = await usersCol.updateMany(
    {
      status: "processed",
      depth: { $lt: maxDepth },
      "scrapedConnections.following": { $ne: true },
    },
    { $set: { status: "pending" } }
  );

  if (requeueForFollowingScraping.modifiedCount > 0) {
    console.log(
      `Re-queued ${requeueForFollowingScraping.modifiedCount} previously processed users for 'following' scraping.`
    );
  }

  // Requeue users for follower scraping if they meet criteria
  const followerScrapingRequeuePipeline = [
    {
      $match: {
        status: "processed", // Only consider users already processed
        depth: { $lt: maxDepth },
        "scrapedConnections.followers": { $ne: true }, // Followers not yet scraped
        "parentRatings.0": { $exists: true }, // Ensure parentRatings array is not empty and has at least one element
      },
    },
    {
      $addFields: {
        parentRatingsCount: { $ifNull: [{ $size: "$parentRatings" }, 0] },
        averageParentRatingForFollowerScrape: {
          $ifNull: [{ $avg: "$parentRatings.rating" }, 0],
        },
      },
    },
    {
      $match: {
        parentRatingsCount: {
          $gte: MIN_HIGH_RATING_PARENTS_FOR_FOLLOWER_SCRAPE,
        },
        averageParentRatingForFollowerScrape: {
          $gte: RATING_THRESHOLD_FOR_FOLLOWER_SCRAPE_PARENTS,
        },
      },
    },
    {
      $project: { _id: 1 }, // We only need the IDs for the update
    },
  ];

  const usersToRequeueForFollowers = await usersCol
    .aggregate(followerScrapingRequeuePipeline)
    .toArray();

  if (usersToRequeueForFollowers.length > 0) {
    const idsToUpdate = usersToRequeueForFollowers.map((doc) => doc._id);
    const requeueFollowerUpdateResult = await usersCol.updateMany(
      { _id: { $in: idsToUpdate } },
      { $set: { status: "pending" } }
    );
    console.log(
      `Re-queueing for 'follower' scraping: Found ${usersToRequeueForFollowers.length} users matching criteria. Modified ${requeueFollowerUpdateResult.modifiedCount} users to 'pending'.`
    );
  } else {
    console.log(
      "No users found to re-queue for 'follower' scraping based on parent rating criteria."
    );
  }

  let batchCount = 0;

  while (true) {
    batchCount++;

    // Only update the expensive count every N batches to reduce memory pressure
    if (batchCount === 1 || batchCount % COUNT_UPDATE_INTERVAL === 0) {
      console.log("Updating processable user count...");
      const totalProcessableUsers = await usersCol
        .aggregate([
          {
            $addFields: {
              averageParentRating: { $avg: "$parentRatings.rating" },
              // For follower scraping criteria check in count
              parentRatingsCountForFollowerScrape: {
                $ifNull: [{ $size: "$parentRatings" }, 0],
              },
              averageParentRatingForFollowerScrape: {
                $ifNull: [{ $avg: "$parentRatings.rating" }, 0],
              },
            },
          },
          {
            $match: {
              status: "pending",
              $or: [
                { depth: 0 }, // Initial seed users
                {
                  // D2ETC scrape for users without rating yet
                  depth: { $gt: 0 },
                  rating: { $exists: false }, // Not yet rated/scraped fully
                  averageParentRating: { $gte: RATING_THRESHOLD_FOR_D2ETC },
                },
                {
                  // Requeued for following scraping
                  depth: { $gt: 0 },
                  rating: { $exists: true }, // Should have a rating
                  "scrapedConnections.following": { $ne: true },
                },
                {
                  // Requeued for follower scraping
                  depth: { $gt: 0 },
                  rating: { $exists: true }, // Assumes user has been rated
                  "scrapedConnections.following": true, // Following should be done
                  "scrapedConnections.followers": { $ne: true }, // Followers not yet done
                  // And matches the criteria that got them requeued (redundant if requeue is perfect, safe check)
                  parentRatingsCountForFollowerScrape: {
                    $gte: MIN_HIGH_RATING_PARENTS_FOR_FOLLOWER_SCRAPE,
                  },
                  averageParentRatingForFollowerScrape: {
                    $gte: RATING_THRESHOLD_FOR_FOLLOWER_SCRAPE_PARENTS,
                  },
                },
              ],
            },
          },
          {
            $count: "total",
          },
        ])
        .toArray();

      cachedTotalProcessable = totalProcessableUsers[0]?.total || 0;
      lastCountUpdate = batchCount;
    }

    const pendingUsers = await usersCol
      .aggregate<DbGraphUser>([
        {
          $addFields: {
            averageParentRating: { $avg: "$parentRatings.rating" },
            // Add fields for follower scraping criteria to ensure they are picked up if pending for it
            parentRatingsCountForFollowerScrape: {
              $ifNull: [{ $size: "$parentRatings" }, 0],
            },
            averageParentRatingForFollowerScrape: {
              $ifNull: [{ $avg: "$parentRatings.rating" }, 0],
            },
          },
        },
        {
          $match: {
            status: "pending",
            $or: [
              { depth: 0 }, // Initial seed users
              {
                // D2ETC scrape for users without rating yet
                depth: { $gt: 0 },
                rating: { $exists: false },
                averageParentRating: { $gte: RATING_THRESHOLD_FOR_D2ETC },
              },
              {
                // Requeued for following scraping
                depth: { $gt: 0 },
                rating: { $exists: true }, // Assumes user has been rated
                "scrapedConnections.following": { $ne: true },
              },
              {
                // Requeued for follower scraping
                depth: { $gt: 0 },
                rating: { $exists: true }, // Assumes user has been rated
                "scrapedConnections.following": true, // Following must be done
                "scrapedConnections.followers": { $ne: true }, // Followers not yet done
                // And matches the criteria that got them requeued (redundant if requeue is perfect, safe check)
                parentRatingsCountForFollowerScrape: {
                  $gte: MIN_HIGH_RATING_PARENTS_FOR_FOLLOWER_SCRAPE,
                },
                averageParentRatingForFollowerScrape: {
                  $gte: RATING_THRESHOLD_FOR_FOLLOWER_SCRAPE_PARENTS,
                },
              },
            ],
          },
        },
        {
          $sort: {
            depth: 1,
            averageParentRating: -1,
          },
        },
        {
          $limit: BATCH_SIZE,
        },
      ])
      .toArray();

    if (pendingUsers.length === 0) {
      console.log(
        "No more pending users meeting criteria within the current maxDepth."
      );
      const anyRemainingUsersOverall = await usersCol.countDocuments({
        status: "pending",
      });
      if (anyRemainingUsersOverall === 0) {
        console.log(
          "All discovered users have been processed or ignored. Graph scraping complete for all reachable nodes."
        );
      } else {
        console.log(
          `Scraping complete for users meeting current criteria up to maxDepth: ${maxDepth}. There are ${anyRemainingUsersOverall} pending users overall (some may be at deeper levels or not currently meeting the processing criteria).`
        );
      }
      break;
    }

    console.log(`[Progress Update]`);
    console.log(
      `- Total processable profiles (meeting criteria): ${cachedTotalProcessable} (last updated: batch ${lastCountUpdate})`
    );
    console.log(`- Current batch size: ${pendingUsers.length}`);
    console.log(`- Processing next batch...
`);

    const usernames = pendingUsers.map((u) => u._id);
    await usersCol.updateMany(
      { _id: { $in: usernames } },
      { $set: { status: "processing" } }
    );

    await Promise.all(
      pendingUsers.map(async (userDoc) =>
        processUserFromBatch(userDoc, usersCol, edgesCol, octokit, maxDepth)
      )
    );

    console.log("Memory usage:", process.memoryUsage());

    // Memory cleanup: Suggest garbage collection after each batch
    if (global.gc) {
      global.gc();
    }

    // Add a small delay to prevent overwhelming the database
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  await client.close();
  console.log("Graph scraping with MongoDB completed!");
}

main().catch(console.error);
