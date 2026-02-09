import { Octokit } from "@octokit/core";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import { scrapeUser } from "../core/scraper-helpers/scrape-user.js";

dotenv.config();

const username = process.argv[2];
if (!username) {
  console.error("Usage: npm run scrape-one <username>");
  process.exit(1);
}

const octokit = new Octokit({ auth: process.env.GITHUB_ACCESS_TOKEN });
const client = new MongoClient(process.env.MONGODB_URI!);
await client.connect();
const db = client.db(process.env.MONGODB_DB);
const usersCol = db.collection("users");

console.log(`Scraping ${username}...`);
const { user } = await scrapeUser(octokit, username, 1, false, usersCol);

if (!user) {
  console.log("Scrape failed or filtered out");
  await client.close();
  process.exit(1);
}

console.log(`\n=== ${username} ===`);
console.log(`Rating: ${user.rating} / 48`);
console.log(`Archetype: ${user.engineerArchetype}`);
console.log(`Location: ${user.inferredLocation}`);

if (user.criteriaScores) {
  console.log(`\nCriteria:`);
  for (const [k, v] of Object.entries(user.criteriaScores)) {
    console.log(`  ${k}: ${v}/3 - ${user.criteriaReasonings?.[k] || ""}`);
  }
}

const { status, ...userData } = user;
await usersCol.updateOne(
  { _id: username },
  { $set: { ...userData as any, status: "processed" } },
  { upsert: true }
);
console.log("\nSaved to DB");
await client.close();
