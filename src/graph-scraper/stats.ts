import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import { DbGraphUser } from "./types.js";

dotenv.config();

const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017";
const dbName = process.env.MONGODB_DB || "githubGraph";

async function calculateGraphStats() {
  const client = new MongoClient(mongoUri);
  try {
    await client.connect();
    const db = client.db(dbName);
    const usersCol = db.collection<DbGraphUser>("users");
    const edgesCol = db.collection("edges");

    // Get basic counts
    const totalUsers = await usersCol.countDocuments();
    const totalEdges = await edgesCol.countDocuments();

    // Get status distribution
    const statusCounts = await usersCol
      .aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }])
      .toArray();

    // Get depth distribution
    const depthCounts = await usersCol
      .aggregate([{ $group: { _id: "$depth", count: { $sum: 1 } } }])
      .toArray();

    // Get ignored reasons distribution
    const ignoredReasons = await usersCol
      .aggregate([
        { $match: { status: "ignored" } },
        { $group: { _id: "$ignoredReason", count: { $sum: 1 } } },
      ])
      .toArray();

    // Calculate average followers/following per user
    const followingCounts = await edgesCol
      .aggregate([{ $group: { _id: "$from", count: { $sum: 1 } } }])
      .toArray();

    const followerCounts = await edgesCol
      .aggregate([{ $group: { _id: "$to", count: { $sum: 1 } } }])
      .toArray();

    const avgFollowing =
      followingCounts.reduce((sum, curr) => sum + curr.count, 0) /
      followingCounts.length;
    const avgFollowers =
      followerCounts.reduce((sum, curr) => sum + curr.count, 0) /
      followerCounts.length;

    // Print statistics
    console.log("\nGraph Statistics:");
    console.log("----------------------------------------");
    console.log(`Total Users: ${totalUsers}`);
    console.log(`Total Edges: ${totalEdges}`);
    console.log(`Average Following per User: ${avgFollowing.toFixed(2)}`);
    console.log(`Average Followers per User: ${avgFollowers.toFixed(2)}`);

    console.log("\nUser Status Distribution:");
    statusCounts.forEach(({ _id, count }) => {
      const percentage = ((count / totalUsers) * 100).toFixed(1);
      console.log(`${_id}: ${count} (${percentage}%)`);
    });

    console.log("\nDepth Distribution:");
    depthCounts.forEach(({ _id, count }) => {
      const percentage = ((count / totalUsers) * 100).toFixed(1);
      console.log(`Depth ${_id}: ${count} (${percentage}%)`);
    });

    if (ignoredReasons.length > 0) {
      console.log("\nIgnored Reasons:");
      // Sort reasons by count in descending order
      ignoredReasons.sort((a, b) => b.count - a.count);

      // Group reasons into categories
      const categories: Record<string, string[]> = {
        "Profile Quality": [
          "INSUFFICIENT_PROFILE_FIELDS",
          "LOW_CONTRIBUTIONS_LOW_FOLLOWERS",
          "LOW_CONTRIBUTIONS_MEDIUM_FOLLOWERS",
          "LOW_CONTRIBUTIONS_HIGH_FOLLOWERS",
          "NOT_ACTIVE_ENOUGH_MONTHS",
          "WEEKDAY_CODER",
        ],
        "Account Restrictions": [
          "BANNED_COUNTRY",
          "ACCOUNT_TOO_NEW",
          "TOO_MANY_FOLLOWERS",
          "TOO_MANY_FOLLOWING",
        ],
        "Technical Issues": ["ERROR_SCRAPING", "COULD_NOT_FETCH_CONTRIBUTIONS"],
        Unknown: [],
      };

      // Print each category
      for (const [category, validReasons] of Object.entries(categories)) {
        const categoryReasons = ignoredReasons.filter(
          ({ _id }) =>
            validReasons.includes(_id) ||
            (category === "Unknown" &&
              !Object.values(categories).flat().includes(_id))
        );

        if (categoryReasons.length > 0) {
          console.log(`\n${category}:`);
          categoryReasons.forEach(({ _id, count }) => {
            const percentage = ((count / totalUsers) * 100).toFixed(1);
            console.log(`  ${_id}: ${count} (${percentage}%)`);
          });
        }
      }
    }
  } catch (error) {
    console.error("Error calculating graph stats:", error);
  } finally {
    await client.close();
  }
}

calculateGraphStats().catch(console.error);
