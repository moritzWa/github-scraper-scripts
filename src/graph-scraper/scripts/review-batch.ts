import { execSync } from "child_process";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import { companyConfig } from "../../config/company.js";

dotenv.config();

const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017";
const dbName = process.env.MONGODB_DB;

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const count = parseInt(args[0] || "10", 10);
const nycOnly = process.argv.includes("--nyc");
const noLinkedin = process.argv.includes("--no-linkedin");
const requireTwitter = process.argv.includes("--require-twitter");
const minHireabilityArg = process.argv.find((a) => a.startsWith("--min-hireability="));
const minHireability = minHireabilityArg
  ? parseInt(minHireabilityArg.split("=")[1], 10)
  : 1;
const minStartupExpArg = process.argv.find((a) => a.startsWith("--min-startup-exp="));
const minStartupExp = minStartupExpArg
  ? parseInt(minStartupExpArg.split("=")[1], 10)
  : 1;
const minAiExpArg = process.argv.find((a) => a.startsWith("--min-ai-exp="));
const minAiExp = minAiExpArg
  ? parseInt(minAiExpArg.split("=")[1], 10)
  : 0;

async function main() {
  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db(dbName);
  const usersCol = db.collection("users");

  const teamUsernames = companyConfig.teamMembers.map((url) =>
    url.replace("https://github.com/", "")
  );

  const query: any = {
    status: "processed",
    rating: { $exists: true },
    _id: { $nin: teamUsernames },
    reviewStatus: { $exists: false },
  };

  if (nycOnly) {
    query["criteriaScores.location"] = 3;
  }
  if (minHireability > 0) {
    query["criteriaScores.hireability"] = { $gte: minHireability };
  }
  if (!noLinkedin) {
    query.linkedinUrl = { $exists: true, $ne: null };
  }
  if (requireTwitter) {
    query.twitter_username = { $exists: true, $ne: null };
  }
  if (minStartupExp > 0) {
    query["criteriaScores.startup_experience"] = { $gte: minStartupExp };
  }
  if (minAiExp > 0) {
    query["criteriaScores.ai_agent_experience"] = { $gte: minAiExp };
  }

  const users = await usersCol
    .find(query)
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
