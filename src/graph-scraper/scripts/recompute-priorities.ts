import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import { computePriority } from "../core/scraper-helpers/discover-connections.js";

dotenv.config();

const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017";
const dbName = process.env.MONGODB_DB;

async function main() {
  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db(dbName);
  const users = db.collection("users");

  const pendingUsers = await users
    .find({
      status: "pending",
      parentRatings: { $exists: true, $not: { $size: 0 } },
    })
    .project({
      _id: 1,
      parentRatings: 1,
      depth: 1,
      discoveredVia: 1,
    })
    .toArray();

  console.log(`Found ${pendingUsers.length} pending users to recompute`);

  let updated = 0;
  const BATCH_SIZE = 1000;

  for (let i = 0; i < pendingUsers.length; i += BATCH_SIZE) {
    const batch = pendingUsers.slice(i, i + BATCH_SIZE);
    const bulkOps = [];

    for (const user of batch) {
      const parentRatings = user.parentRatings || [];
      if (!parentRatings.length || !user.depth) continue;

      const bestParentRating = Math.max(
        ...parentRatings.map((p: any) => p.rating)
      );
      const direction = user.discoveredVia || "following";

      const newPriority = computePriority(
        bestParentRating,
        direction,
        user.depth
      );

      bulkOps.push({
        updateOne: {
          filter: { _id: user._id },
          update: { $set: { priority: newPriority } },
        },
      });
    }

    if (bulkOps.length > 0) {
      const result = await users.bulkWrite(bulkOps);
      updated += result.modifiedCount;
    }

    if ((i / BATCH_SIZE) % 50 === 0 || i + BATCH_SIZE >= pendingUsers.length) {
      console.log(
        `  ${Math.min(i + BATCH_SIZE, pendingUsers.length)}/${pendingUsers.length} processed (${updated} updated)`
      );
    }
  }

  console.log(`\nDone. Updated ${updated} priorities.`);
  await client.close();
}

main().catch(console.error);
