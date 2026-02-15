import dotenv from "dotenv";
import { MongoClient } from "mongodb";
dotenv.config();

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB);
  const users = db.collection("users");

  // Check actual parentRatings structure
  const sample = await users.findOne(
    { status: "pending", priority: { $gte: 39 } },
    { projection: { _id: 1, parentRatings: 1, priority: 1, depth: 1, discoveredVia: 1 } }
  );
  console.log("=== SAMPLE PENDING USER ===");
  console.log(JSON.stringify(sample, null, 2));

  // Check how priority is computed - look at discover-connections
  // Priority = parentRating * directionMultiplier / sqrt(depth)
  // following = 1.5x, followers = 0.7x

  console.log("\n=== PRIORITY BUCKETS (pending queue) ===");
  const buckets: [string, number, number][] = [
    ["60+", 60, 9999],
    ["50-60", 50, 60],
    ["40-50", 40, 50],
    ["30-40", 30, 40],
    ["20-30", 20, 30],
    ["10-20", 10, 20],
    ["<10", 0, 10],
  ];
  for (const [label, min, max] of buckets) {
    const count = await users.countDocuments({
      status: "pending",
      priority: { $gte: min, $lt: max },
    });
    if (count > 0) console.log(`  ${label}: ${count}`);
  }

  // What priority did good candidates have?
  console.log("\n=== PRIORITY DISTRIBUTION OF SCORED 40+ USERS ===");
  const scored40plus = await users
    .find({ status: "processed", rating: { $gte: 40 } })
    .project({ _id: 1, rating: 1, priority: 1 })
    .toArray();
  const priorities = scored40plus.map((u) => u.priority).filter((p): p is number => typeof p === "number");
  if (priorities.length) {
    priorities.sort((a, b) => b - a);
    console.log(`  Count: ${priorities.length}`);
    console.log(`  Avg priority: ${(priorities.reduce((a, b) => a + b, 0) / priorities.length).toFixed(1)}`);
    console.log(`  Median priority: ${priorities[Math.floor(priorities.length / 2)].toFixed(1)}`);
    console.log(`  Min: ${priorities[priorities.length - 1].toFixed(1)}, Max: ${priorities[0].toFixed(1)}`);

    // Bucket the 40+ scored users by their priority
    for (const [label, min, max] of buckets) {
      const c = priorities.filter(p => p >= min && p < max).length;
      if (c > 0) console.log(`    ${label}: ${c} users scored 40+`);
    }
  }

  // What % of users at each priority level scored 40+?
  console.log("\n=== HIT RATE BY PRIORITY BUCKET ===");
  for (const [label, min, max] of buckets) {
    const total = await users.countDocuments({
      status: "processed",
      priority: { $gte: min, $lt: max },
    });
    const good = await users.countDocuments({
      status: "processed",
      rating: { $gte: 40 },
      priority: { $gte: min, $lt: max },
    });
    if (total > 0) {
      console.log(`  ${label}: ${good}/${total} scored 40+ (${((good/total)*100).toFixed(1)}%)`);
    }
  }

  await client.close();
}
main().catch(console.error);
