import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import { DbGraphUser } from "./types.js";

dotenv.config();

const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017";
const dbName = process.env.MONGODB_DB || "githubGraph";

// Get username from command line arguments
const username = process.argv[2];

if (!username) {
  console.error("Please provide a username as a command line argument");
  console.log("Example: npm run check-user -- RyanMarten");
  process.exit(1);
}

async function checkUser(username: string) {
  console.log(`Checking database for user: ${username}`);
  const client = new MongoClient(mongoUri);

  try {
    await client.connect();
    console.log("Connected to MongoDB");

    const db = client.db(dbName);
    const usersCol = db.collection<DbGraphUser>("users");

    const user = await usersCol.findOne({ _id: username });

    if (!user) {
      console.log(`User ${username} not found in database`);
      process.exit(0);
    }

    console.log("\n=== User Details ===");
    console.log(`Username: ${user._id}`);
    console.log(`Status: ${user.status}`);
    console.log(`State: ${user.state || "undefined"}`);
    console.log(`Depth: ${user.depth}`);

    if (user.rating !== undefined) {
      console.log(`Rating: ${user.rating}`);
      console.log(
        `Rating with Role Fit Points: ${user.ratingWithRoleFitPoints}`
      );
      console.log(
        `Engineer Archetype: ${
          user.engineerArchetype?.join(", ") || "undefined"
        }`
      );
      console.log(
        `Rated At: ${
          user.ratedAt ? new Date(user.ratedAt).toISOString() : "undefined"
        }`
      );
    } else {
      console.log("This user does not have a rating yet");
    }

    if (user.scrapedConnections) {
      console.log(`Scraped Followers: ${user.scrapedConnections.followers}`);
      console.log(`Scraped Following: ${user.scrapedConnections.following}`);
    } else {
      console.log("This user does not have scraped connections information");
    }

    if (user.ignoredReason) {
      console.log(`Ignored Reason: ${user.ignoredReason}`);
    }

    // Print more detailed information if needed
    if (process.argv.includes("--verbose")) {
      console.log("\n=== Detailed User Data ===");
      console.log(JSON.stringify(user, null, 2));
    }
  } catch (error) {
    console.error("Error checking user:", error);
  } finally {
    await client.close();
    console.log("\nMongoDB connection closed");
  }
}

checkUser(username).catch(console.error);
