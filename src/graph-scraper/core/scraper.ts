import { Octokit } from "@octokit/core";
import dotenv from "dotenv";
import { Collection, MongoClient } from "mongodb";
import { DbGraphUser, IgnoredReason } from "../types.js";
import { topProfiles } from "./profils.js";
import { fetchFollowingPaged } from "./scraper-helpers/fetch-connections.js";
import { scrapeUser } from "./scraper-helpers/scrape-user.js";

dotenv.config();

const apiKey = process.env.GITHUB_ACCESS_TOKEN;
const octokit = new Octokit({ auth: apiKey });
const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017";
const dbName = process.env.MONGODB_DB;
const maxDepth = 4;
const RATING_THRESHOLD_FOR_D2ETC = 50;
const BATCH_SIZE = 3;

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

        await usersCol
          .bulkWrite(
            pageItems.map((newUsername: string) => {
              const childDepth = depth + 1;
              const updateOnInsertFields: Partial<DbGraphUser> & {
                _id: string;
              } = {
                _id: newUsername,
                status: "pending",
                depth: childDepth,
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
                updateOnInsertFields.parentRatings = [];
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
              `Error upserting new users from ${connectionType} for ${parentUsername}, page:`,
              err
            );
          });
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
  const userRequedForConnectionScraping =
    userDoc.rating !== undefined && userDoc.status === "pending";
  const userRating = userToProcess.rating ?? userDoc.rating;
  if (
    (userWasJustScraped || userRequedForConnectionScraping) &&
    depth < currentMaxDepth
  ) {
    // RATING IS REQUIRED TO SCRAPE CONNECTIONS
    if (userRating === undefined) {
      console.error(
        `[${username}] Cannot scrape connections: rating is undefined. Status: ${userToProcess.status}`
      );
      return;
    }
    const parentRatingForChildren = userRating;
    const connectionPromises = [];

    // SCRAPING FOLLOWING IF NOT DONE
    const currentUserConnections = (await usersCol.findOne({ _id: username }))
      ?.scrapedConnections ?? { following: false, followers: false };
    if (!currentUserConnections.following) {
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
        ).then(() =>
          usersCol.updateOne(
            { _id: username },
            { $set: { "scrapedConnections.following": true } }
          )
        )
      );
    }

    if (connectionPromises.length > 0) {
      await Promise.all(connectionPromises);
      console.log(`[${username}] Connection scraping attempts finished.`);
    }

    // UPDATING STATUS TO PROCESSED IF FOLLOWING IS DONE
    if (!performedScrape && userDoc.rating !== undefined) {
      const finalConnectionState = (await usersCol.findOne({ _id: username }))
        ?.scrapedConnections;
      const followingDone = finalConnectionState?.following === true;
      if (followingDone) {
        await usersCol.updateOne(
          { _id: username },
          { $set: { status: "processed" } }
        );
        console.log(
          `[${username}] Skipped scrape, 'following' connections processed. Status set to 'processed'.`
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
  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db(dbName);
  const usersCol = db.collection<DbGraphUser>("users");
  const edgesCol = db.collection("edges");

  for (const profile of topProfiles) {
    const username = profile.replace("https://github.com/", "");
    await usersCol.updateOne(
      { _id: username },
      {
        $setOnInsert: {
          _id: username,
          status: "pending",
          depth: 0,
          scrapedConnections: {
            followers: false,
            following: false,
          },
        },
      },
      { upsert: true }
    );
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
      `Re-queued ${requeueForFollowingScraping.modifiedCount} previously processed users whose following connections need to be scraped.`
    );
  }

  while (true) {
    const totalPending = await usersCol.countDocuments({
      status: "pending",
      depth: { $lte: maxDepth },
    });

    const pendingUsers = await usersCol
      .aggregate<DbGraphUser>([
        {
          $addFields: {
            averageParentRating: { $avg: "$parentRatings.rating" },
          },
        },
        {
          $match: {
            status: "pending",
            $or: [
              { depth: 0 },
              {
                depth: { $gt: 0 },
                rating: { $exists: false },
                averageParentRating: { $gte: RATING_THRESHOLD_FOR_D2ETC },
              },
              {
                depth: { $gt: 0 },
                rating: { $exists: true },
                "scrapedConnections.following": { $ne: true },
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
      `- Total pending profiles (up to depth ${maxDepth}): ${totalPending}`
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
  }

  await client.close();
  console.log("Graph scraping with MongoDB completed!");
}

main().catch(console.error);
