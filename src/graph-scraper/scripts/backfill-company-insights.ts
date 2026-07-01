import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import { fetchCurrentEmployerInsights } from "../core/scraper-helpers/linkedin-research.js";
import { DbGraphUser } from "../types.js";

dotenv.config();

const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017";
const dbName = process.env.MONGODB_DB;

async function main() {
  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db(dbName);
  const usersCol = db.collection<DbGraphUser>("users");

  // Find processed users with LinkedIn data but no company insights
  // currentCompanyInsights: null means we checked but they weren't a founder (old behavior)
  // currentCompanyInsights: { $exists: false } means we never checked
  // We want both, since we removed the founder-only filter
  const users = await usersCol
    .find({
      status: "processed",
      linkedinExperience: { $exists: true, $ne: null },
      $or: [
        { currentCompanyInsights: null },
        { currentCompanyInsights: { $exists: false } },
      ],
    })
    .project({ _id: 1, login: 1, linkedinExperience: 1 })
    .toArray();

  console.log(`Found ${users.length} users to backfill company insights for\n`);

  let fetched = 0;
  let cached = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    const login = user._id;

    try {
      const insights = await fetchCurrentEmployerInsights(
        { login, linkedinExperience: user.linkedinExperience as any },
        usersCol as any
      );

      if (insights) {
        await usersCol.updateOne(
          { _id: user._id },
          { $set: { currentCompanyInsights: insights } }
        );
        fetched++;
        // Log progress every 10 fetched
        if (fetched % 10 === 0) {
          console.log(`  Progress: ${i + 1}/${users.length} checked, ${fetched} fetched, ${cached} cached, ${skipped} skipped`);
        }
      } else {
        skipped++;
      }
    } catch (error: any) {
      if (error.name === "RapidAPICreditsExhaustedError") {
        console.error("\nRapidAPI credits exhausted. Stopping.");
        break;
      }
      console.error(`  Error for ${login}: ${error.message}`);
      errors++;
    }
  }

  console.log(`\nDone:`);
  console.log(`  Fetched new: ${fetched}`);
  console.log(`  From cache: ${cached}`);
  console.log(`  Skipped (no company URL / stealth): ${skipped}`);
  console.log(`  Errors: ${errors}`);

  await client.close();
}

main().catch(console.error);
