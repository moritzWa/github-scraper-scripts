import { config } from "dotenv";
import fs from "fs";
import { MongoClient } from "mongodb";
import path from "path";
import { topProfiles, topProfilesAdditional } from "./profils.js";

config();

interface RatedUser {
  _id: string;
  rating: number;
  ratingWithRoleFitPoints: number;
}

async function exportBestRatedLinksToTxt() {
  const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017";
  const dbName = process.env.MONGODB_DB || "githubGraph";

  const client = new MongoClient(mongoUri);
  try {
    await client.connect();
    const db = client.db(dbName);
    const usersCol = db.collection<RatedUser>("users");

    // Get all existing profile URLs to filter out
    const knownProfiles = new Set(
      [...topProfiles, ...topProfilesAdditional].map((url) =>
        url.replace("https://github.com/", "")
      )
    );

    // Query for rated users, excluding those in existing profiles
    const ratedUsers = await usersCol
      .find({
        rating: { $exists: true },
        ratingWithRoleFitPoints: { $exists: true },
        _id: { $nin: Array.from(knownProfiles) },
      })
      .sort({ ratingWithRoleFitPoints: -1 })
      .toArray();

    // Create output directory if it doesn't exist
    const outputDir = path.join(process.cwd(), "output");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
    }

    // Generate output content - just the profile URLs
    const outputContent = ratedUsers
      .map((user) => `https://github.com/${user._id}`)
      .join("\n");

    // Write to file
    const timestamp = new Date().toISOString().split("T")[0];
    const outputPath = path.join(outputDir, `top-rated-links-${timestamp}.txt`);
    fs.writeFileSync(outputPath, outputContent);

    console.log(
      `Successfully exported ${ratedUsers.length} profile links to ${outputPath}`
    );
  } catch (error) {
    console.error("Error exporting rated profile links:", error);
  } finally {
    await client.close();
  }
}

// Run the script if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  exportBestRatedLinksToTxt().catch(console.error);
}
