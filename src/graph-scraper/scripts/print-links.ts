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

  console.log(`Top ${users.length} unreviewed profiles:\n`);
  for (let i = 0; i < users.length; i++) {
    const u = users[i];
    const linkedin = u.linkedinUrl || "no LinkedIn";
    console.log(
      `${i + 1}. ${u.name || u._id} (${u.rating}) - ${linkedin}`
    );
  }

  console.log(`\nLinkedIn URLs only (for batch opening):\n`);
  users
    .filter((u) => u.linkedinUrl)
    .forEach((u) => console.log(u.linkedinUrl));

  await client.close();
}

main().catch(console.error);
