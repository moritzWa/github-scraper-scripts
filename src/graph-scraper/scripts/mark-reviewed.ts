import dotenv from "dotenv";
import { MongoClient } from "mongodb";

dotenv.config();

const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017";
const dbName = process.env.MONGODB_DB;

type ReviewStatus = "outreach" | "discarded";

function parseArgs(): { users: string[]; status: ReviewStatus; note?: string } {
  const args = process.argv.slice(2);
  let status: ReviewStatus | null = null;
  let note: string | undefined;
  const users: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--status" && args[i + 1]) {
      const s = args[i + 1];
      if (s !== "outreach" && s !== "discarded") {
        console.error(`Invalid status: ${s}. Use "outreach" or "discarded".`);
        process.exit(1);
      }
      status = s;
      i++;
    } else if (args[i] === "--note" && args[i + 1]) {
      note = args[i + 1];
      i++;
    } else if (!args[i].startsWith("--")) {
      users.push(args[i]);
    }
  }

  if (!status || users.length === 0) {
    console.error(
      "Usage: mark-reviewed <user1> [user2 ...] --status outreach|discarded [--note 'optional note']"
    );
    process.exit(1);
  }

  return { users, status, note };
}

async function main() {
  const { users, status, note } = parseArgs();

  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db(dbName);
  const usersCol = db.collection("users");

  for (const username of users) {
    const update: any = {
      reviewStatus: status,
      reviewedAt: new Date(),
    };
    if (note) update.reviewNote = note;

    const result = await usersCol.updateOne(
      { _id: username } as any,
      { $set: update }
    );

    if (result.matchedCount === 0) {
      console.log(`[${username}] Not found in DB`);
    } else {
      console.log(`[${username}] Marked as ${status}`);
    }
  }

  // Print summary
  const outreachCount = await usersCol.countDocuments({ reviewStatus: "outreach" });
  const discardedCount = await usersCol.countDocuments({ reviewStatus: "discarded" });
  console.log(`\nReview totals: ${outreachCount} outreach, ${discardedCount} discarded`);

  await client.close();
}

main().catch(console.error);
