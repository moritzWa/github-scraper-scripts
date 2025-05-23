import { Octokit } from "@octokit/core";
import { config } from "dotenv";
import { MongoClient } from "mongodb";
import { UserData } from "../../types.js";
import {
  fetchLinkedInProfileUsingBrave,
  generateOptimizedSearchQuery,
} from "../core/scraper-helpers/linkedin-research.js";
import { DbGraphUser } from "../types.js";

config();

const octokit = new Octokit({
  auth: process.env.GITHUB_ACCESS_TOKEN,
});

const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017";
const dbName = process.env.MONGODB_DB;

// Convert DbGraphUser to UserData format
function convertToUserData(dbUser: DbGraphUser): UserData {
  return {
    ...dbUser,
    login: dbUser._id,
    repoInteractionScraped: dbUser.repoInteractionScraped || [],
  };
}

async function debugLinkedInSearch() {
  const client = new MongoClient(mongoUri);
  try {
    await client.connect();
    console.log("Connected to MongoDB");
    const db = client.db(dbName);
    const usersCol = db.collection<DbGraphUser>("users");

    // Get the username from command line arguments or use default
    const username = process.argv[2] || "JannikSt";
    console.log(`\nDebugging LinkedIn search for user: ${username}`);

    // Fetch user data from database
    const userFromDb = await usersCol.findOne({ _id: username });
    if (!userFromDb) {
      console.error(`User ${username} not found in database`);
      return;
    }

    console.log("\nUser Data from DB:");
    // console.log(JSON.stringify(userFromDb, null, 2));

    // Test 1: Original Brave Search
    console.log("\nTest 1: Original Brave Search");
    const braveUrl = await fetchLinkedInProfileUsingBrave(
      convertToUserData(userFromDb)
    );
    console.log("Found URL:", braveUrl);
    console.log("Current LinkedIn URL in DB:", userFromDb.linkedinUrl);
    console.log("Correct?", braveUrl === userFromDb.linkedinUrl);

    // Test 2: Optimized Search Query
    console.log("\nTest 2: Optimized Search Query");
    const optimizedQuery = await generateOptimizedSearchQuery(
      convertToUserData(userFromDb)
    );
    console.log("Optimized Query:", optimizedQuery);
    const optimizedUrl = await fetchLinkedInProfileUsingBrave(
      convertToUserData(userFromDb),
      optimizedQuery
    );
    console.log("Found URL:", optimizedUrl);
    console.log("Correct?", optimizedUrl === userFromDb.linkedinUrl);

    console.log("\n=== End of Tests ===\n");
  } catch (error) {
    console.error("Error in debug script:", error);
  } finally {
    await client.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  debugLinkedInSearch().catch(console.error);
}
