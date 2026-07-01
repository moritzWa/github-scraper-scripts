/**
 * Test LinkedIn search for known users to validate search quality.
 * Does NOT call RapidAPI - only tests query generation and Brave search.
 *
 * Run: npx tsx src/graph-scraper/scripts/test-linkedin-search.ts
 */
import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import {
  findLinkedInUrlInProfileData,
  generateOptimizedSearchQuery,
  fetchLinkedInProfileUsingBrave,
} from "../core/scraper-helpers/linkedin-research.js";
import { UserData } from "../../types.js";
import { DbGraphUser } from "../types.js";

dotenv.config();

const client = new MongoClient(process.env.MONGODB_URI!);
await client.connect();
const db = client.db(process.env.MONGODB_DB);
const usersCol = db.collection<DbGraphUser>("users");

// Users where LinkedIn search failed but we know their LinkedIn
const testCases = [
  { github: "habanzu", expectedSlug: "georg-meinhardt", expectedName: "Georg Meinhardt" },
  { github: "LitMSCTBB", expectedSlug: "arnavwad", expectedName: "Arnav Adhikari" },
  { github: "AJNandi", expectedSlug: null, expectedName: "AJ Nandi" },
  { github: "antfu", expectedSlug: null, expectedName: "Anthony Fu" },
  { github: "mnida", expectedSlug: null, expectedName: null },
];

for (const tc of testCases) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Testing: ${tc.github} (expected: ${tc.expectedSlug || "unknown"})`);

  const dbUser = await usersCol.findOne({ _id: tc.github });
  if (!dbUser) {
    console.log("  NOT IN DB - skipping");
    continue;
  }

  const userData: UserData = {
    ...dbUser,
    login: dbUser._id,
    repoInteractionScraped: [],
    recentRepositories: dbUser.recentRepositories || null,
  };

  // Step 1: Test findLinkedInUrlInProfileData
  console.log("\n  Step 1: findLinkedInUrlInProfileData");
  console.log(`    name: ${dbUser.name || "null"}`);
  console.log(`    bio: ${dbUser.bio || "null"}`);
  console.log(`    company: ${dbUser.company || "null"}`);
  console.log(`    email: ${dbUser.email || "null"}`);
  console.log(`    blog: ${dbUser.blog || "null"}`);
  console.log(`    twitter: ${dbUser.twitter_username || "null"}`);
  console.log(`    websiteContent: ${dbUser.websiteContent ? `${dbUser.websiteContent.length} chars` : "null"}`);
  console.log(`    profileReadme: ${dbUser.profileReadme ? `${dbUser.profileReadme.length} chars` : "null"}`);

  const foundUrl = findLinkedInUrlInProfileData(userData);
  console.log(`    -> Found URL: ${foundUrl || "NONE"}`);

  if (foundUrl && tc.expectedSlug) {
    const match = foundUrl.includes(tc.expectedSlug);
    console.log(`    -> ${match ? "CORRECT MATCH" : "WRONG MATCH"}`);
  }

  // Step 2: Test query generation
  console.log("\n  Step 2: generateOptimizedSearchQuery");
  const query = await generateOptimizedSearchQuery(userData);
  console.log(`    -> Query: "${query}"`);

  if (query === "SKIP") {
    console.log("    -> LLM decided to SKIP (not enough info)");
    continue;
  }

  // Step 3: Test Brave search
  console.log("\n  Step 3: fetchLinkedInProfileUsingBrave");
  const braveResult = await fetchLinkedInProfileUsingBrave(userData, query);
  console.log(`    -> Brave result: ${braveResult || "NONE"}`);

  if (braveResult && tc.expectedSlug) {
    const match = braveResult.includes(tc.expectedSlug);
    console.log(`    -> ${match ? "CORRECT" : "WRONG"} (expected: ${tc.expectedSlug})`);
  }
}

await client.close();
console.log("\n\nDone.");
