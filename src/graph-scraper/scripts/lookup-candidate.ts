import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import { DbGraphUser } from "../types.js";

dotenv.config();

const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017";
const dbName = process.env.MONGODB_DB;

async function main() {
  const query = process.argv[2];
  if (!query) {
    console.error("Usage: npm run lookup <github-username-or-linkedin-slug>");
    process.exit(1);
  }

  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db(dbName);
  const usersCol = db.collection<DbGraphUser>("users");

  // Try by GitHub username first, then by LinkedIn slug
  let user = await usersCol.findOne({ _id: query });
  if (!user) {
    user = await usersCol.findOne({ linkedinUrl: { $regex: query, $options: "i" } });
  }
  if (!user) {
    console.error(`No user found for "${query}"`);
    await client.close();
    process.exit(1);
  }

  const u = user as any;
  const output = {
    github: user._id,
    githubUrl: `https://github.com/${user._id}`,
    name: user.name,
    email: user.email || null,
    company: user.company || null,
    bio: user.bio || null,
    location: user.inferredLocation || null,
    rating: user.rating,
    archetype: user.engineerArchetype || null,
    // Links
    linkedinUrl: user.linkedinUrl || null,
    xUrl: u.xUrl || null,
    twitterUsername: u.twitter_username || null,
    blog: user.blog || null,
    // X/Twitter profile
    xName: user.xName || null,
    xBio: user.xBio || null,
    // Career data
    linkedinSummary: user.linkedinExperienceSummary || null,
    currentCompanyInsights: u.currentCompanyInsights || null,
    // Web research
    webResearch: u.webResearchInfoOpenAI || u.webResearchInfoGemini || null,
    // Graph discovery - who led us to this person
    discoveredVia: u.discoveredVia || null,
    topReferrer: null as { github: string; name: string | null; rating: number } | null,
    parentRatings: u.parentRatings || null,
    depth: u.depth || null,
    // Scoring
    criteriaScores: user.criteriaScores || null,
    criteriaReasonings: user.criteriaReasonings || null,
  };

  // Resolve top referrer's full name
  if (u.parentRatings?.length) {
    const topParent = u.parentRatings.reduce(
      (best: any, p: any) => (p.rating > best.rating ? p : best),
      u.parentRatings[0]
    );
    const parentUser = await usersCol.findOne({ _id: topParent.parent });
    output.topReferrer = {
      github: topParent.parent,
      name: parentUser?.name || null,
      rating: topParent.rating,
    };
  }

  console.log(JSON.stringify(output, null, 2));
  await client.close();
}

main().catch(console.error);
