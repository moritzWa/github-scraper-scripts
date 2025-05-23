import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import { DbGraphUser } from "../types.js";

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
    depthCounts.forEach(({ _id, count }) => {
      const percentage = ((count / totalUsers) * 100).toFixed(1);
      console.log(`Depth ${_id}: ${count} (${percentage}%)`);
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

    // Add Rating Statistics
    const ratedUsers = await usersCol
      .find({
        ratingWithRoleFitPoints: { $exists: true },
        rating: { $exists: true },
      })
      .toArray();

    if (ratedUsers.length > 0) {
      console.log("\nRating Statistics (with Role Fit Points):");
      console.log("----------------------------------------");

      // Basic rating stats
      const ratingsWithRoleFit = ratedUsers.map(
        (u) => u.ratingWithRoleFitPoints ?? 0
      );
      const baseRatings = ratedUsers.map((u) => u.rating ?? 0);

      const avgRatingWithRoleFit =
        ratingsWithRoleFit.reduce((a, b) => a + b, 0) /
        ratingsWithRoleFit.length;
      const avgBaseRating =
        baseRatings.reduce((a, b) => a + b, 0) / baseRatings.length;
      const minRating = Math.min(...ratingsWithRoleFit);
      const maxRating = Math.max(...ratingsWithRoleFit);

      console.log(`Total Rated Users: ${ratedUsers.length}`);
      console.log(`Average Base Rating: ${avgBaseRating.toFixed(1)}`);
      console.log(
        `Average Rating with Role Fit: ${avgRatingWithRoleFit.toFixed(1)}`
      );
      console.log(
        `Average Role Fit Bonus: ${(
          avgRatingWithRoleFit - avgBaseRating
        ).toFixed(1)}`
      );
      console.log(`Min Rating: ${minRating}`);
      console.log(`Max Rating: ${maxRating}`);

      // Rating distribution
      const ratingRanges = [
        { min: 0, max: 20, label: "0-20" },
        { min: 21, max: 40, label: "21-40" },
        { min: 41, max: 60, label: "41-60" },
        { min: 61, max: 80, label: "61-80" },
        { min: 81, max: 100, label: "81-100" },
        { min: 101, max: 120, label: "101-120" },
      ];

      console.log("\nRating Distribution (with Role Fit):");
      ratingRanges.forEach((range) => {
        const count = ratingsWithRoleFit.filter(
          (r) => r >= range.min && r <= range.max
        ).length;
        const percentage = ((count / ratingsWithRoleFit.length) * 100).toFixed(
          1
        );
        console.log(`${range.label}: ${count} (${percentage}%)`);
      });

      // Role fit bonus distribution
      const roleFitBonuses = ratedUsers.map(
        (u) => (u.ratingWithRoleFitPoints ?? 0) - (u.rating ?? 0)
      );
      const usersWithRoleFitBonus = roleFitBonuses.filter(
        (bonus) => bonus > 0
      ).length;

      console.log("\nRole Fit Bonus Statistics:");
      console.log(
        `Users with Role Fit Bonus: ${usersWithRoleFitBonus} (${(
          (usersWithRoleFitBonus / ratedUsers.length) *
          100
        ).toFixed(1)}%)`
      );
      console.log(
        `Average Role Fit Bonus: ${(
          roleFitBonuses.reduce((a, b) => a + b, 0) / ratedUsers.length
        ).toFixed(1)}`
      );

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
