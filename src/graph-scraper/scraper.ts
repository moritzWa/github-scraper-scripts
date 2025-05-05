import { Octokit } from "@octokit/core";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import { DbGraphUser, GraphUser } from "../types.js";
import { withRateLimitRetry } from "../utils/prime-scraper-api-utils.js";
import { scrapeUser } from "./helpers.js";
import { topProfiles } from "./profils.js";

dotenv.config();

const apiKey = process.env.GITHUB_ACCESS_TOKEN;
const octokit = new Octokit({ auth: apiKey });
const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017";
const dbName = process.env.MONGODB_DB || "githubGraph";
const maxDepth = 2;

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
    // Get the next pending user
    const userDoc = await usersCol.findOneAndUpdate(
      { status: "pending", depth: { $lte: maxDepth } },
      { $set: { status: "processing" } },
      { returnDocument: "after" }
    );
    if (!userDoc) {
      console.log("No more pending users. Done!");
      break;
    }
    const username = userDoc._id;
    const depth = userDoc.depth || 0;
    console.log(`Processing ${username} at depth ${depth}`);

    try {
      const userData: GraphUser | null = await scrapeUser(
        octokit,
        username,
        depth,
        depth === 0
      );
      if (!userData) {
        await usersCol.updateOne(
          { _id: username },
          { $set: { status: "ignored" } }
        );
        continue;
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
            .catch(() => {}); // Ignore duplicate key errors
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
        { $set: { status: "ignored" } }
      );
    }
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
