import dotenv from "dotenv";
dotenv.config();
import { MongoClient } from "mongodb";
const client = new MongoClient(process.env.MONGODB_URI!);
await client.connect();
const db = client.db(process.env.MONGODB_DB);
const usersCol = db.collection("users");

for (const username of ["yujonglee", "just-be-dev"]) {
  const u = await usersCol.findOne({ _id: username });
  if (!u) { console.log(username, "NOT FOUND"); continue; }
  console.log("=== " + username + " ===");
  console.log("Name:", u.name);
  console.log("Bio:", u.bio);
  console.log("Company:", u.company);
  console.log("Location:", u.location);
  console.log("LinkedIn:", u.linkedinUrl);
  console.log("Score:", u.rating);
  console.log("Archetype:", u.engineerArchetype);
  console.log("X Bio:", u.xBio);
  console.log("LinkedIn Summary:", u.linkedinExperienceSummary?.slice(0, 1000));
  console.log("Criteria:", JSON.stringify(u.criteriaScores));
  console.log("Web Research:", u.webResearchInfoOpenAI?.slice(0, 600));
  console.log();
}
await client.close();
