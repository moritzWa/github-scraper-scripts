import dotenv from "dotenv";
import { MongoClient } from "mongodb";

dotenv.config();

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB);
  const users = db.collection("users");

  // Score distribution by depth
  console.log("=== PROCESSED USERS BY DEPTH ===");
  const depthStats = await users
    .aggregate([
      { $match: { status: "processed", rating: { $exists: true } } },
      {
        $group: {
          _id: "$depth",
          count: { $sum: 1 },
          avgScore: { $avg: "$rating" },
          scored40plus: {
            $sum: { $cond: [{ $gte: ["$rating", 40] }, 1, 0] },
          },
          scored50plus: {
            $sum: { $cond: [{ $gte: ["$rating", 50] }, 1, 0] },
          },
          maxScore: { $max: "$rating" },
        },
      },
      { $sort: { _id: 1 } },
    ])
    .toArray();

  for (const d of depthStats) {
    console.log(
      `  depth ${d._id}: ${d.count} users, avg=${d.avgScore.toFixed(1)}, 40+=${d.scored40plus} (${((d.scored40plus / d.count) * 100).toFixed(1)}%), 50+=${d.scored50plus}, max=${d.maxScore}`
    );
  }

  // Outreach candidates by depth
  console.log("\n=== OUTREACH CANDIDATES BY DEPTH ===");
  const outreachByDepth = await users
    .aggregate([
      { $match: { reviewStatus: "outreach" } },
      {
        $group: {
          _id: "$depth",
          count: { $sum: 1 },
          users: { $push: { name: "$name", id: "$_id", rating: "$rating" } },
        },
      },
      { $sort: { _id: 1 } },
    ])
    .toArray();

  for (const d of outreachByDepth) {
    console.log(`  depth ${d._id}: ${d.count} outreach candidates`);
    for (const u of d.users) {
      console.log(`    - ${u.name || u.id} (score: ${u.rating})`);
    }
  }

  // Pending queue by depth
  console.log("\n=== PENDING QUEUE BY DEPTH ===");
  const pendingByDepth = await users
    .aggregate([
      { $match: { status: "pending" } },
      {
        $group: {
          _id: "$depth",
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ])
    .toArray();

  for (const d of pendingByDepth) {
    console.log(`  depth ${d._id}: ${d.count} pending`);
  }

  await client.close();
}

main().catch(console.error);
