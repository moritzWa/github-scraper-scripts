import { config } from "dotenv";
import fs from "fs";
import { MongoClient } from "mongodb";
import path from "path";
import { topProfiles } from "./profils.js";

config();

interface RatedUser {
  _id: string;
  rating: number;
  ratingWithRoleFitPoints: number;
  ratingReasoning: string;
  engineerArchetype: string[];
  name?: string;
  company?: string;
  depth?: number;
}

async function analyzeTopProfiles() {
  const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017";
  const dbName = process.env.MONGODB_DB || "githubGraph";

  const client = new MongoClient(mongoUri);
  try {
    await client.connect();
    const db = client.db(dbName);
    const usersCol = db.collection<RatedUser>("users");

    // Get usernames from topProfiles
    const topProfileUsernames = topProfiles.map((url) =>
      url.replace("https://github.com/", "")
    );

    // Query for rated users that are in topProfiles and have depth 0
    const ratedUsers = await usersCol
      .find({
        _id: { $in: topProfileUsernames },
        depth: 0,
        rating: { $exists: true },
        ratingWithRoleFitPoints: { $exists: true },
      })
      .sort({ ratingWithRoleFitPoints: -1 })
      .toArray();

    // Create output directory if it doesn't exist
    const outputDir = path.join(process.cwd(), "output");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
    }

    // Generate output content
    const outputContent = ratedUsers
      .map((user, index) => {
        const profileUrl = `https://github.com/${user._id}`;
        return `#${index + 1} - ${user.name || user._id}${
          user.company ? ` (${user.company})` : ""
        }
Profile: ${profileUrl}
Rating: ${user.rating}
Rating with Role Fit: ${user.ratingWithRoleFitPoints}
Archetypes: ${user.engineerArchetype.join(", ")}
Reasoning: ${user.ratingReasoning || "No reasoning provided"}
----------------------------------------`;
      })
      .join("\n\n");

    // Write to file
    const timestamp = new Date().toISOString().split("T")[0];
    const outputPath = path.join(
      outputDir,
      `top-profiles-analysis-${timestamp}.txt`
    );
    fs.writeFileSync(outputPath, outputContent);

    console.log(
      `Successfully analyzed ${ratedUsers.length} top profiles to ${outputPath}`
    );

    // Print some statistics
    console.log("\nStatistics:");
    console.log(`Total profiles analyzed: ${ratedUsers.length}`);
    console.log(
      `Average rating: ${(
        ratedUsers.reduce((acc, user) => acc + user.rating, 0) /
        ratedUsers.length
      ).toFixed(2)}`
    );
    console.log(
      `Average rating with role fit: ${(
        ratedUsers.reduce(
          (acc, user) => acc + user.ratingWithRoleFitPoints,
          0
        ) / ratedUsers.length
      ).toFixed(2)}`
    );

    // Count archetypes
    const archetypeCounts = ratedUsers.reduce((acc, user) => {
      user.engineerArchetype.forEach((archetype) => {
        acc[archetype] = (acc[archetype] || 0) + 1;
      });
      return acc;
    }, {} as Record<string, number>);

    console.log("\nArchetype distribution:");
    Object.entries(archetypeCounts)
      .sort(([, a], [, b]) => b - a)
      .forEach(([archetype, count]) => {
        console.log(`${archetype}: ${count} profiles`);
      });
  } catch (error) {
    console.error("Error analyzing top profiles:", error);
  } finally {
    await client.close();
  }
}

// Run the script if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  analyzeTopProfiles().catch(console.error);
}
