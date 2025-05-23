import { Octokit } from "@octokit/core";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import { withRateLimitRetry } from "../../utils/prime-scraper-api-utils.js";
import { DbGraphUser, IgnoredReason } from "../types.js";
import { topProfiles } from "./profils.js";
import { scrapeUser } from "./scraper-helpers/scrape-user.js";

dotenv.config();

const apiKey = process.env.GITHUB_ACCESS_TOKEN;
const octokit = new Octokit({ auth: apiKey });
const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017";
const dbName = process.env.MONGODB_DB;
const maxDepth = 3;
const RATING_THRESHOLD_FOR_D2ETC = 40;
const BATCH_SIZE = 3;
const SCRAPE_FOLLOWERS = false; // Set to false to only scrape following connections

// --- Reusable Connection Processing Function ---
async function processConnectionsPageByPage(
  parentUsername: string, // Renamed from username for clarity
  depth: number, // This is the parent's depth
  parentRating: number | undefined, // The parent's rating
  connectionType: "followers" | "following",
  fetchFunction: (
    username: string
  ) => AsyncGenerator<string[], void, undefined>,
  usersCol: any, // Consider using Collection<DbGraphUser> type if available here
  edgesCol: any // Consider using Collection<any> type
) {
  try {
    for await (const pageItems of fetchFunction(parentUsername)) {
      if (pageItems.length > 0) {
        // Insert edges
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
            // Decide if you want to throw or just log for edge insertion failures
          });

        // Upsert new users
        await usersCol
          .bulkWrite(
            pageItems.map((newUsername: string) => {
              const childDepth = depth + 1; // 'depth' here is the parent's depth
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
            // Decide if you want to throw or just log for user upsertion failures
          });
      }
    }
  } catch (err) {
    console.error(
      `Error in ${connectionType} processing stream for ${parentUsername}:`,
      err
    );
    throw err; // Re-throw to be caught by the calling Promise.all
  }
}

async function main() {
  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db(dbName);
  const usersCol = db.collection<DbGraphUser>("users");
  const edgesCol = db.collection("edges");

  // Seed initial users if not present
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

  // Re-queue users that were processed at a depth shallower than the current maxDepth,
  // but only if they haven't had their following connections scraped yet
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
    // Get total count of all pending users up to maxDepth (for logging, can be an overestimate of "currently processable")
    const totalPending = await usersCol.countDocuments({
      status: "pending",
      depth: { $lte: maxDepth },
    });

    // Fetch a batch of pending users using an aggregation pipeline
    const pendingUsers = await usersCol
      .aggregate([
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
                averageParentRating: { $gte: RATING_THRESHOLD_FOR_D2ETC }, // Process all non-zero depth users with high-rated parents
              },
            ],
          },
        },
        {
          $sort: {
            depth: 1,
            averageParentRating: -1, // Prioritize depth 2 users with higher parent ratings
          },
        },
        {
          $limit: BATCH_SIZE,
        },
      ])
      .toArray();

    // --- START: Enhanced Logging ---
    if (pendingUsers.length > 0) {
      console.log(
        `\n[Aggregation Result] Fetched ${pendingUsers.length} users for batch:`
      );
      pendingUsers.forEach((user) => {
        let logMsg = `  - User: ${user._id}, Depth: ${user.depth}`;
        if (user.depth === 2) {
          // The 'isD2Qualified' field was added in the pipeline,
          // but it's implicitly true if they made it through the $match stage for D2 users.
          // We are projecting it away, but the fact they are in the list means they qualified.
          logMsg += ` (Qualified D2 user)`;
        }
        console.log(logMsg);
      });
    } else {
      console.log(
        "\n[Aggregation Result] No users matched the criteria for the current batch."
      );
    }
    // --- END: Enhanced Logging ---

    if (pendingUsers.length === 0) {
      console.log(
        "No more pending users meeting criteria within the current maxDepth."
      );
      // Before breaking, check if there are any users at all (even > maxDepth or different statuses)
      const anyRemainingUsersOverall = await usersCol.countDocuments({
        status: "pending",
      });
      if (anyRemainingUsersOverall === 0) {
        console.log(
          "All discovered users have been processed or ignored. Graph scraping complete for all reachable nodes."
        );
      } else {
        console.log(
          `Scraping complete for users meeting current criteria up to maxDepth: ${maxDepth}. There are ${anyRemainingUsersOverall} pending users overall (some may be at deeper levels or not currently meeting depth 2 criteria).`
        );
      }
      break;
    }

    // Show progress
    console.log(`\nProgress Update:`);
    console.log(
      `Total pending profiles (up to depth ${maxDepth}): ${totalPending}`
    );
    console.log(`Current batch size: ${pendingUsers.length}`);
    console.log(`Processing next batch...\n`);

    // Mark users as processing
    const usernames = pendingUsers.map((u) => u._id);
    await usersCol.updateMany(
      { _id: { $in: usernames } },
      { $set: { status: "processing" } }
    );

    // Process the batch in parallel
    await Promise.all(
      pendingUsers.map(async (userDoc) => {
        const username = userDoc._id; // userDoc will not have followerEdges or qualifyingD1Followers due to $project
        const depth = typeof userDoc.depth === "number" ? userDoc.depth : 0;
        console.log(
          `[Batch Processing] Starting to process ${username} at depth ${depth}.`
        );

        try {
          const { user: userData } = await scrapeUser(
            octokit,
            username,
            depth,
            depth === 0
          );
          if (!userData) {
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

          // Upsert user data, respecting the status determined by scrapeUser
          const updateFields: any = {
            // Ideally Partial<DbGraphUser>
            ...userData, // This includes login, profileUrl, ..., status, ignoredReason (if any), depth, and crucially userData.rating
          };

          if (userData.status === "processed") {
            // Only initialize scrapedConnections for successfully processed users
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

          // Only attempt to scrape connections if the user was processed and is not at max depth
          if (userData.status === "processed" && depth < maxDepth) {
            const parentRatingForChildren = userData.rating; // Use the parent's rating
            try {
              const connectionPromises = [];

              // Always scrape following
              connectionPromises.push(
                processConnectionsPageByPage(
                  username,
                  depth,
                  parentRatingForChildren, // Pass parent's rating
                  "following",
                  fetchFollowingPaged,
                  usersCol,
                  edgesCol
                ).then(() => {
                  return usersCol.updateOne(
                    { _id: username },
                    { $set: { "scrapedConnections.following": true } }
                  );
                })
              );

              // Only scrape followers if configured to do so
              if (SCRAPE_FOLLOWERS) {
                connectionPromises.push(
                  processConnectionsPageByPage(
                    username,
                    depth,
                    parentRatingForChildren, // Pass parent's rating
                    "followers",
                    fetchFollowersPaged,
                    usersCol,
                    edgesCol
                  ).then(() => {
                    return usersCol.updateOne(
                      { _id: username },
                      { $set: { "scrapedConnections.followers": true } }
                    );
                  })
                );
              }

              await Promise.all(connectionPromises);
            } catch (connectionError) {
              console.error(
                `Error fetching or processing connections for ${username}:`,
                connectionError
              );
              await usersCol.updateOne(
                { _id: username },
                {
                  $set: {
                    status: "ignored",
                    ignoredReason: IgnoredReason.ERROR_SCRAPING_CONNECTIONS,
                  },
                }
              );
            }
          } else {
            console.log(
              `Max depth ${maxDepth} reached for ${username} (depth ${depth}). Not fetching further connections.`
            );
          }
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
      })
    );
  }

  await client.close();
  console.log("Graph scraping with MongoDB completed!");
}

// Helper functions (async generators for paged fetching)
async function* fetchFollowersPaged(
  username: string
): AsyncGenerator<string[], void, undefined> {
  let page = 1;
  const perPage = 100; // Keep this per page for API calls
  while (true) {
    const response = await withRateLimitRetry(() =>
      octokit.request("GET /users/{username}/followers", {
        username,
        per_page: perPage,
        page,
      })
    );
    if (response.data.length === 0) break;
    const currentPageFollowers = response.data
      .filter((user: any) => user.type === "User")
      .map((user: any) => user.login);

    if (currentPageFollowers.length > 0) {
      yield currentPageFollowers;
    }

    if (response.data.length < perPage) break;
    page++;
  }
}

export async function* fetchFollowingPaged(
  username: string
): AsyncGenerator<string[], void, undefined> {
  let page = 1;
  const perPage = 100; // Keep this per page for API calls
  while (true) {
    const response = await withRateLimitRetry(() =>
      octokit.request("GET /users/{username}/following", {
        username,
        per_page: perPage,
        page,
      })
    );
    if (response.data.length === 0) break;
    const currentPageFollowing = response.data
      .filter((user: any) => user.type === "User")
      .map((user: any) => user.login);

    if (currentPageFollowing.length > 0) {
      yield currentPageFollowing;
    }

    if (response.data.length < perPage) break;
    page++;
  }
}

main().catch(console.error);
