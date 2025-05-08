import { Octokit } from "@octokit/core";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import { withRateLimitRetry } from "../utils/prime-scraper-api-utils.js";
import { scrapeUser } from "./helpers.js";
import { topProfiles } from "./profils.js";
import { DbGraphUser, IgnoredReason } from "./types.js";

dotenv.config();

const apiKey = process.env.GITHUB_ACCESS_TOKEN;
const octokit = new Octokit({ auth: apiKey });
const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017";
const dbName = process.env.MONGODB_DB || "githubGraph";
const maxDepth = 2;
const BATCH_SIZE = 5;

// --- Reusable Connection Processing Function ---
async function processConnectionsPageByPage(
  username: string,
  depth: number,
  connectionType: "followers" | "following",
  fetchFunction: (
    username: string
  ) => AsyncGenerator<string[], void, undefined>,
  usersCol: any, // Consider using Collection<DbGraphUser> type if available here
  edgesCol: any // Consider using Collection<any> type
) {
  try {
    for await (const pageItems of fetchFunction(username)) {
      if (pageItems.length > 0) {
        // Insert edges
        const edgeDocs =
          connectionType === "followers"
            ? pageItems.map((item) => ({ from: item, to: username }))
            : pageItems.map((item) => ({ from: username, to: item }));

        await edgesCol
          .insertMany(edgeDocs, { ordered: false })
          .catch((err: any) => {
            console.error(
              `Error inserting ${connectionType} edges for ${username}, page:`,
              err
            );
            // Decide if you want to throw or just log for edge insertion failures
          });

        // Upsert new users
        await usersCol
          .bulkWrite(
            pageItems.map((newUsername: string) => ({
              updateOne: {
                filter: { _id: newUsername },
                update: {
                  $setOnInsert: {
                    _id: newUsername,
                    status: "pending",
                    depth: depth + 1,
                  },
                },
                upsert: true,
              },
            }))
          )
          .catch((err: any) => {
            console.error(
              `Error upserting new users from ${connectionType} for ${username}, page:`,
              err
            );
            // Decide if you want to throw or just log for user upsertion failures
          });
      }
    }
  } catch (err) {
    console.error(
      `Error in ${connectionType} processing stream for ${username}:`,
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
        },
      },
      { upsert: true }
    );
  }

  // Re-queue users that were processed at a depth shallower than the current maxDepth,
  // so their connections can be explored further.
  // This allows resuming and deepening the graph if maxDepth is increased.
  const requeueResult = await usersCol.updateMany(
    {
      status: "processed",
      depth: { $lt: maxDepth },
    },
    { $set: { status: "pending" } }
  );

  if (requeueResult.modifiedCount > 0) {
    console.log(
      `Re-queued ${requeueResult.modifiedCount} previously processed users whose connections might need further scraping due to increased maxDepth.`
    );
  }

  while (true) {
    // Get total count of pending users
    const totalPending = await usersCol.countDocuments({
      status: "pending",
      depth: { $lte: maxDepth },
    });

    // Fetch a batch of pending users
    const pendingUsers = await usersCol
      .find({ status: "pending", depth: { $lte: maxDepth } })
      .limit(BATCH_SIZE)
      .toArray();

    if (pendingUsers.length === 0) {
      console.log("No more pending users within the current maxDepth.");
      // Before breaking, check if there are any users at all (even > maxDepth or different statuses)
      // to distinguish between a completed scrape and a scrape limited by maxDepth.
      const anyRemainingPendingUsers = await usersCol.countDocuments({
        status: "pending",
      });
      if (anyRemainingPendingUsers === 0) {
        console.log(
          "All discovered users have been processed or ignored. Graph scraping complete for all reachable nodes."
        );
      } else {
        console.log(
          `Scraping complete up to maxDepth: ${maxDepth}. There are ${anyRemainingPendingUsers} pending users at deeper levels not yet processed.`
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
        const username = userDoc._id;
        const depth = typeof userDoc.depth === "number" ? userDoc.depth : 0;
        console.log(`Processing ${username} at depth ${depth}`);

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

          // Upsert user data
          await usersCol.updateOne(
            { _id: username },
            {
              $set: {
                ...userData,
                status: "processed",
                depth,
              },
            },
            { upsert: true }
          );

          if (depth < maxDepth) {
            try {
              await Promise.all([
                processConnectionsPageByPage(
                  username,
                  depth,
                  "followers",
                  fetchFollowersPaged,
                  usersCol,
                  edgesCol
                ),
                processConnectionsPageByPage(
                  username,
                  depth,
                  "following",
                  fetchFollowingPaged,
                  usersCol,
                  edgesCol
                ),
              ]);
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

async function* fetchFollowingPaged(
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
