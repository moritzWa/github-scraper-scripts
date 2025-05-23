// src/graph-scraper/investigate-graph-follower-data.ts

import { connectToDatabase } from "../core/db.js";

async function main() {
  const db = await connectToDatabase();
  const users = db.collection("users");
  const edges = db.collection("edges");

  // 1. Count depth-0 users with ratings
  const depth0WithRating = await users.countDocuments({
    depth: 0,
    rating: { $exists: true },
  });
  const totalDepth0 = await users.countDocuments({ depth: 0 });
  console.log(
    `Depth-0 users: ${totalDepth0}, with rating: ${depth0WithRating}`
  );

  // 2. Count depth-1 users with a parent edge from a rated depth-0 user
  const depth1WithRatedParent = await edges
    .aggregate([
      {
        $lookup: {
          from: "users",
          localField: "to",
          foreignField: "_id",
          as: "parent",
        },
      },
      { $unwind: "$parent" },
      { $match: { "parent.depth": 0, "parent.rating": { $exists: true } } },
      {
        $lookup: {
          from: "users",
          localField: "from",
          foreignField: "_id",
          as: "child",
        },
      },
      { $unwind: "$child" },
      { $match: { "child.depth": 1 } },
      { $group: { _id: "$from" } },
      { $count: "depth1WithRatedParent" },
    ])
    .toArray();
  console.log(
    `Depth-1 users with a parent edge from a rated depth-0 user: ${
      depth1WithRatedParent[0]?.depth1WithRatedParent || 0
    }`
  );

  // 3. Sample depth-1 users without parentRatings and print their incoming edges
  const sample = await users
    .find({ depth: 1, parentRatings: { $exists: false } })
    .limit(30)
    .toArray();
  for (const user of sample) {
    console.log(`\nDepth-1 user without parentRatings: ${user._id}`);
    const incomingEdges = await edges.find({ from: user._id }).toArray();
    if (incomingEdges.length === 0) {
      console.log("  No incoming edges.");
    } else {
      for (const edge of incomingEdges) {
        console.log(`  Follows: ${edge.to}`);
      }
    }
  }
}

main().catch(console.error);
