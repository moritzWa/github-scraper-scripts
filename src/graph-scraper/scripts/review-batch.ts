import { execSync } from "child_process";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import { companyConfig } from "../../config/company.js";

dotenv.config();

const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017";
const dbName = process.env.MONGODB_DB;

const count = parseInt(process.argv[2] || "10", 10);

async function main() {
  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db(dbName);
  const usersCol = db.collection("users");

  const teamUsernames = companyConfig.teamMembers.map((url) =>
    url.replace("https://github.com/", "")
  );

  const users = await usersCol
    .find({
      status: "processed",
      rating: { $exists: true },
      _id: { $nin: teamUsernames } as any,
      reviewStatus: { $exists: false },
    })
    .sort({ rating: -1 })
    .limit(count)
    .project({ _id: 1, rating: 1, linkedinUrl: 1, name: 1, company: 1 })
    .toArray();

  if (users.length === 0) {
    console.log("No unreviewed profiles left!");
    await client.close();
    return;
  }

  console.log(`Opening ${users.length} profiles:\n`);
  for (const u of users) {
    const url = u.linkedinUrl || `https://github.com/${u._id}`;
    console.log(`  ${u.name || u._id} (${u.rating}) - ${url}`);
    execSync(`open "${url}"`);
  }

  console.log(`\nUsernames: ${users.map((u) => u._id).join(" ")}`);
  console.log(`\nWhen done, run:`);
  console.log(`  npm run mark <user1> [user2 ...] --status outreach`);
  console.log(`  npm run mark <user1> [user2 ...] --status discarded`);

  await client.close();
}

main().catch(console.error);
