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
      console.log("No more pending users. Done!");
      break;
    }

    // Show progress
    console.log(`\nProgress Update:`);
    console.log(`Total pending profiles: ${totalPending}`);
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
        const depth = userDoc.depth || 0;
        console.log(`Processing ${username} at depth ${depth}`);

        try {
          const { user: userData, ignoredReason } = await scrapeUser(
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
                  ignoredReason: ignoredReason || IgnoredReason.ERROR_SCRAPING,
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
            // Fetch followers and following
            const [followers, following] = await Promise.all([
              fetchFollowers(username),
              fetchFollowing(username),
            ]);

            // Insert edges
            if (followers.length > 0) {
              await edgesCol
                .insertMany(
                  followers.map((f) => ({ from: f, to: username })),
                  { ordered: false }
                )
                .catch(() => {});
            }
            if (following.length > 0) {
              await edgesCol
                .insertMany(
                  following.map((f) => ({ from: username, to: f })),
                  { ordered: false }
                )
                .catch(() => {});
            }

            // Upsert new users to users collection
            const newUsers = [...followers, ...following];
            if (newUsers.length > 0) {
              await usersCol.bulkWrite(
                newUsers.map((newUsername) => ({
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
              );
            }
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

// Helper functions (same as before)
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

main().catch(console.error);
