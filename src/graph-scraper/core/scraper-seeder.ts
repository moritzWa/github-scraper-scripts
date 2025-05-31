import dotenv from "dotenv";
import { Collection, MongoClient } from "mongodb";
import { DbGraphUser } from "../types.js"; // Assuming DbGraphUser is exported from types.ts

dotenv.config();

const MONGO_URI = process.env.MONGODB_URI || "mongodb://localhost:27017";
const TARGET_DB_NAME = "githubScraper-test";
const ACTUAL_DB_NAME = process.env.MONGODB_DB;

// Constants from scraper.ts for criteria - ensure these match or are imported if possible
const MIN_HIGH_RATING_PARENTS_FOR_FOLLOWER_SCRAPE = 5;
const RATING_THRESHOLD_FOR_FOLLOWER_SCRAPE_PARENTS = 40;

async function seedDatabase() {
  if (ACTUAL_DB_NAME !== TARGET_DB_NAME) {
    console.error(
      `ERROR: Seeder is configured to run only on '${TARGET_DB_NAME}', but MONGODB_DB is currently '${ACTUAL_DB_NAME}'. Aborting.`
    );
    process.exit(1);
  }

  const client = new MongoClient(MONGO_URI);

  try {
    await client.connect();
    console.log("Connected to MongoDB for seeding.");
    const db = client.db(ACTUAL_DB_NAME);

    const usersCol: Collection<DbGraphUser> =
      db.collection<DbGraphUser>("users");
    const edgesCol: Collection<any> = db.collection("edges");

    console.log("Clearing existing users and edges collections...");
    await usersCol.deleteMany({});
    await edgesCol.deleteMany({});
    console.log("Collections cleared.");

    const parentUsers: DbGraphUser[] = [];
    for (let i = 0; i < 5; i++) {
      parentUsers.push({
        _id: `parent${i}`,
        profileUrl: `https://github.com/parent${i}`,
        createdAt: new Date("2018-01-01T00:00:00Z").toISOString(),
        followers: 100,
        following: 100,
        name: `Parent User ${i}`,
        bio: "A prolific open source contributor.",
        company: "Tech Corp",
        blog: "https://blog.parent.dev",
        location: "San Francisco, CA",
        normalizedLocation: {
          city: "San Francisco",
          country: "United States",
          province: "CA",
          timezone: "America/Los_Angeles",
        },
        email: `parent${i}@example.com`,
        twitter_username: `parent${i}_twitter`,
        xUrl: null,
        xBio: null,
        xName: null,
        xLocation: null,
        public_repos: 50,
        contributions: null, // Not relevant for this specific test
        profileReadme: "## Hello from parent " + i,
        websiteContent: null,
        recentRepositories: null,
        depth: 0,
        status: "processed", // These are the established high-quality users
        rating: 80, // Their own profile rating
        scrapedConnections: { followers: true, following: true },
        parentRatings: [], // Depth 0 users don't have parents in this context
        repoInteractionScraped: [], // Added to satisfy DbGraphUser type
      });
    }

    await usersCol.insertMany(parentUsers);
    console.log(`${parentUsers.length} parent users inserted.`);

    const targetUserParentRatings = parentUsers.map((parent) => ({
      parent: parent._id,
      rating: 50, // Each parent gives a rating of 50 to the target user
    }));

    // Verify criteria for logging
    const averageParentRatingForTarget =
      targetUserParentRatings.reduce((sum, pr) => sum + pr.rating, 0) /
      targetUserParentRatings.length;
    console.log(
      `Target user will have ${targetUserParentRatings.length} parent ratings.`
    );
    console.log(
      `Average rating from parents for target user: ${averageParentRatingForTarget}`
    );
    console.log(
      `Criteria: >=${MIN_HIGH_RATING_PARENTS_FOR_FOLLOWER_SCRAPE} parents, avg rating >=${RATING_THRESHOLD_FOR_FOLLOWER_SCRAPE_PARENTS}`
    );

    const targetUser: DbGraphUser = {
      _id: "jannikSt",
      profileUrl: "https://github.com/jannikSt",
      createdAt: new Date("2018-06-01T00:00:00Z").toISOString(),
      followers: 200, // This user has followers
      following: 50,
      name: "Target User",
      bio: "A user whose followers we want to scrape.",
      company: "Startup Inc.",
      blog: null,
      location: "Austin, TX",
      normalizedLocation: {
        city: "Austin",
        country: "United States",
        province: "TX",
        timezone: "America/Chicago",
      },
      email: "target@example.com",
      twitter_username: null,
      xUrl: null,
      xBio: null,
      xName: null,
      xLocation: null,
      public_repos: 10,
      contributions: null,
      profileReadme: "## Target User Profile",
      websiteContent: null,
      recentRepositories: null,
      depth: 1,
      status: "processed", // << IMPORTANT: Initially processed
      rating: 45, // This user's own rating
      scrapedConnections: {
        followers: false, // << IMPORTANT: Followers not yet scraped
        following: false, // Following already scraped
      },
      parentRatings: targetUserParentRatings, // << IMPORTANT: Populated with high-quality followers
      repoInteractionScraped: [], // Added to satisfy DbGraphUser type
    };

    await usersCol.insertOne(targetUser);
    console.log("Target user 'targetUserForFollowerScrape' inserted.");

    // Optionally, create edge documents for completeness, though parentRatings is key for the logic
    const edgeDocsToTarget = parentUsers.map((pUser) => ({
      from: pUser._id, // parent0 is following targetUserForFollowerScrape
      to: targetUser._id,
    }));
    if (edgeDocsToTarget.length > 0) {
      await edgesCol.insertMany(edgeDocsToTarget);
      console.log(
        `${edgeDocsToTarget.length} edges (parents following target) inserted.`
      );
    }

    console.log("Seeding complete!");
  } catch (error) {
    console.error("Error during seeding:", error);
    process.exit(1);
  } finally {
    await client.close();
    console.log("MongoDB connection closed.");
  }
}

seedDatabase();
