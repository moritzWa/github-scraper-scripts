import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import { DbGraphUser } from "../types.js";

dotenv.config();

const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017";
const dbName = process.env.MONGODB_DB;

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

    // Get depth distribution for high-rated processed users
    const highRatedProcessedByDepth = await usersCol
      .aggregate([
        {
          $match: {
            status: "processed",
            rating: { $gt: 50 },
          },
        },
        {
          $group: {
            _id: "$depth",
            count: { $sum: 1 },
          },
        },
      ])
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

    // Add new stat for rated users among processed
    const processedStatusCount =
      statusCounts.find((s) => s._id === "processed")?.count || 0;
    if (processedStatusCount > 0) {
      const ratedUsersCount = await usersCol.countDocuments({
        status: "processed",
        rating: { $exists: true },
      });
      const percentageRated = (
        (ratedUsersCount / processedStatusCount) *
        100
      ).toFixed(1);
      console.log(
        `  - Of which, Rated: ${ratedUsersCount} (${percentageRated}%)`
      );
    }

    console.log("\nDepth Distribution:");

    depthCounts
      .sort((a, b) => (a._id ?? 0) - (b._id ?? 0))
      .forEach(({ _id, count }) => {
        const percentage = ((count / totalUsers) * 100).toFixed(1);
        const highRatedCount =
          highRatedProcessedByDepth.find((d) => d._id === _id)?.count || 0;
        console.log(
          `Depth ${_id}: ${count} (${percentage}%) - High Rated ( >50, processed): ${highRatedCount}`
        );
      });

    // Get total ignored users count
    const totalIgnored = await usersCol.countDocuments({ status: "ignored" });
    console.log("\nIgnored Users Statistics:");
    console.log(
      `Total Ignored Users: ${totalIgnored} (${(
        (totalIgnored / totalUsers) *
        100
      ).toFixed(1)}% of total)`
    );

    if (ignoredReasons.length > 0) {
      console.log("\nIgnored Reasons:");
      // Sort reasons by count in descending order
      ignoredReasons.sort((a, b) => (b.count ?? 0) - (a.count ?? 0));

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

    // Add new section for Depth 6 Sample Profiles
    const depth6HighRatedUsers = await usersCol
      .find({
        depth: 6,
        status: "processed",
        rating: { $gt: 50 },
      })
      .project({ html_url: 1, login: 1, rating: 1 }) // Assuming html_url and login exist
      .sort({ rating: -1 }) // Optional: sort by rating descending
      .limit(20)
      .toArray();

    if (depth6HighRatedUsers.length > 0) {
      console.log("Depth 6 Sample Profiles (Rating > 50, Processed):");
      console.log("----------------------------------------------------");
      depth6HighRatedUsers.forEach((user) => {
        console.log(
          `- https://github.com/${user.login} (Rating: ${user.rating})`
        );
      });
    }

    // Add Rating Statistics
    const ratedUsers = await usersCol
      .find({
        rating: { $exists: true },
      })
      .toArray();

    if (ratedUsers.length > 0) {
      console.log("\nRating Statistics:");
      console.log("----------------------------------------");

      const ratings = ratedUsers.map((u) => u.rating ?? 0);
      const avgRating =
        ratings.reduce((a, b) => a + b, 0) / ratings.length;
      const minRating = Math.min(...ratings);
      const maxRating = Math.max(...ratings);

      console.log(`Total Rated Users: ${ratedUsers.length}`);
      console.log(`Average Rating: ${avgRating.toFixed(1)}`);
      console.log(`Min Rating: ${minRating}`);
      console.log(`Max Rating: ${maxRating}`);

      // Rating distribution
      const ratingRanges = [
        { min: 0, max: 5, label: "0-5" },
        { min: 6, max: 10, label: "6-10" },
        { min: 11, max: 15, label: "11-15" },
        { min: 16, max: 20, label: "16-20" },
        { min: 21, max: 30, label: "21-30" },
      ];

      console.log("\nRating Distribution:");
      ratingRanges.forEach((range) => {
        const count = ratings.filter(
          (r) => r >= range.min && r <= range.max
        ).length;
        const percentage = ((count / ratings.length) * 100).toFixed(1);
        console.log(`${range.label}: ${count} (${percentage}%)`);
      });

      // Engineer archetype distribution
      const archetypeCounts: Record<string, number> = {};
      ratedUsers.forEach((user) => {
        if (user.engineerArchetype) {
          user.engineerArchetype.forEach((archetype) => {
            archetypeCounts[archetype] = (archetypeCounts[archetype] ?? 0) + 1;
          });
        }
      });

      console.log("\nEngineer Archetype Distribution:");
      Object.entries(archetypeCounts)
        .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0))
        .forEach(([archetype, count]) => {
          const percentage = ((count / ratedUsers.length) * 100).toFixed(1);
          console.log(`${archetype}: ${count} (${percentage}%)`);
        });
    }
  } catch (error) {
    console.error("Error calculating graph stats:", error);
  } finally {
    await client.close();
  }
}

calculateGraphStats().catch(console.error);
