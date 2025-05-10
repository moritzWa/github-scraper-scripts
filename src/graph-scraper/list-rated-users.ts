import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import { DbGraphUser } from "./types.js";

dotenv.config();

const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017";
const dbName = process.env.MONGODB_DB || "githubGraph";

async function listRatedUsers() {
  const client = new MongoClient(mongoUri);
  try {
    await client.connect();
    const db = client.db(dbName);
    const usersCol = db.collection<DbGraphUser>("users");

    // Find all users that have been rated
    const ratedUsers = await usersCol
      .find({
        rating: { $exists: true },
        status: "processed",
      })
      .sort({ rating: -1 }) // Sort by rating in descending order
      .toArray();

    // only list the top 20
    const top20RatedUsers = ratedUsers.slice(0, 30);

    console.log("\nRated Users (Sorted by Score):");
    console.log("----------------------------------------");

    top20RatedUsers.forEach((user: DbGraphUser, index) => {
      console.log(`${index + 1}. https://github.com/${user._id}`);
      console.log(`   Score: ${user.rating}`);
      console.log(`   Score w/ roleFitPoints: ${user.ratingWithRoleFitPoints}`);
      if (user.ratingReasoning) {
        console.log(`   Reasoning: ${user.ratingReasoning}`);
      }
      if (user.webResearchInfoOpenAI) {
        console.log(`   Web Research (OpenAI): ${user.webResearchInfoOpenAI}`);
      }
      if (user.webResearchInfoGemini) {
        console.log(`   Web Research (Gemini): ${user.webResearchInfoGemini}`);
      }
      if (user.webResearchPromptText) {
        console.log(`   Web Research Prompt: ${user.webResearchPromptText}`);
      }
      if (user.engineerArchetype) {
        console.log(`   Engineer Archetype: ${user.engineerArchetype}`);
      }
      console.log("----------------------------------------");
    });

    console.log(`\nTotal rated users: ${ratedUsers.length}`);
  } catch (error) {
    console.error("Error listing rated users:", error);
  } finally {
    await client.close();
  }
}

listRatedUsers().catch(console.error);
