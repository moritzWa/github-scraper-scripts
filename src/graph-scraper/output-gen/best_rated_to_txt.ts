import { config } from "dotenv";
import fs from "fs";
import { MongoClient } from "mongodb";
import path from "path";
import { companyConfig } from "../../config/company.js";
import { topProfiles } from "../core/profils.js";

config();

const startIndex = 0;
const endIndex = 200;
const excludedArchetypes = [
  "AI researcher/scientist",
  "frontend",
  "data engineer",
  "low-level systems",
  "None",
];

interface RatedUser {
  _id: string;
  rating: number;
  ratingReasoning: string;
  criteriaScores?: Record<string, number>;
  criteriaReasonings?: Record<string, string>;
  engineerArchetype: string[];
  inferredLocation?: string;
  name?: string;
  company?: string;
  linkedinUrl?: string;
  dept?: string;
}

async function exportBestRatedToTxt() {
  const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017";
  const dbName = process.env.MONGODB_DB;

  const client = new MongoClient(mongoUri);
  try {
    await client.connect();
    const db = client.db(dbName);
    const usersCol = db.collection<RatedUser>("users");

    // Get all existing profile URLs to filter out
    const knownProfiles = new Set(
      [...topProfiles].map((url) => url.replace("https://github.com/", ""))
    );

    // Query for rated users, excluding those in existing profiles and with excluded archetypes
    const ratedUsers = await usersCol
      .find({
        rating: { $exists: true },
        _id: { $nin: Array.from(knownProfiles) },
        engineerArchetype: { $nin: excludedArchetypes },
      })
      .sort({ rating: -1 })
      .toArray();

    const slicedRatedUsers = ratedUsers.slice(startIndex, endIndex);

    // Create output directory if it doesn't exist
    const outputDir = path.join(process.cwd(), "output");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
    }

    // Generate output content
    const outputContent = slicedRatedUsers
      .map((user, index) => {
        const profileUrl = `https://github.com/${user._id}`;
        // Format per-criterion scores with reasoning
        const criteriaLines = user.criteriaScores
          ? Object.entries(user.criteriaScores)
              .map(([key, score]) => {
                const reasoning = user.criteriaReasonings?.[key];
                return `  ${key}: ${score}${reasoning ? ` - ${reasoning}` : ""}`;
              })
              .join("\n")
          : null;

        return `#${startIndex + index + 1} - ${user.name || user._id}${
          user.company ? ` (${user.company})` : ""
        }
Profile: ${profileUrl}
${user.linkedinUrl ? `LinkedIn: ${user.linkedinUrl}\n` : ""}${
          user.inferredLocation ? `Location: ${user.inferredLocation}\n` : ""
        }Score: ${user.rating}/${companyConfig.maxTierSum}
Archetypes: ${user.engineerArchetype.join(", ")}
${criteriaLines ? `Criteria:\n${criteriaLines}` : `Reasoning: ${user.ratingReasoning || "No reasoning provided"}`}
----------------------------------------`;
      })
      .join("\n\n");

    // Write to file
    const timestamp = new Date().toISOString().split("T")[0];
    const outputPath = path.join(
      outputDir,
      `top-rated-profiles-${timestamp}-${startIndex}-${endIndex}.txt`
    );
    fs.writeFileSync(outputPath, outputContent);

    console.log(
      `Successfully exported ${slicedRatedUsers.length} profiles to ${outputPath}`
    );
  } catch (error) {
    console.error("Error exporting rated profiles:", error);
  } finally {
    await client.close();
  }
}

// Run the script if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  exportBestRatedToTxt().catch(console.error);
}
