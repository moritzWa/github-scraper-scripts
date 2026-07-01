import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB);
  const users = db.collection("users");

  // Check a few outreach users with company insights
  const sample = await users.find({ 
    currentCompanyInsights: { $exists: true, $ne: null },
    reviewStatus: "outreach"
  }).limit(5).toArray();

  console.log("=== OUTREACH WITH COMPANY INSIGHTS ===\n");
  for (const u of sample) {
    console.log((u.name || u._id) + ":");
    console.log("  " + JSON.stringify(u.currentCompanyInsights));
    console.log("");
  }

  // Check founders in queue with stagnating companies
  console.log("=== QUEUE: FOUNDERS WITH COMPANY INSIGHTS ===\n");
  const founders = await users.find({
    status: "processed",
    reviewStatus: { $exists: false },
    currentCompanyInsights: { $exists: true, $ne: null },
    "criteriaScores.startup_experience": { $gte: 2 },
    "criteriaScores.hireability": { $lte: 2 },
  }).sort({ rating: -1 }).limit(15).toArray();

  for (const u of founders) {
    const ci = u.currentCompanyInsights;
    console.log((u.name || u._id).toString().padEnd(25) + " r=" + u.rating + " h=" + u.criteriaScores?.hireability);
    console.log("  Company: " + (ci?.companyName || u.company || "?"));
    console.log("  Employees: " + (ci?.employeeCount ?? "?") + " | 1Y growth: " + (ci?.oneYearHeadcountGrowth ?? "?") + " | 6M growth: " + (ci?.sixMonthHeadcountGrowth ?? "?"));
    console.log("  Founded: " + (ci?.foundedYear ?? "?"));
    console.log("");
  }

  // How many users have company insights?
  const withInsights = await users.countDocuments({ currentCompanyInsights: { $exists: true, $ne: null } });
  const total = await users.countDocuments({ status: "processed" });
  console.log("Users with company insights: " + withInsights + "/" + total);

  // Check the structure more carefully
  const sampleAny = await users.findOne({ currentCompanyInsights: { $exists: true, $ne: null } });
  if (sampleAny?.currentCompanyInsights) {
    console.log("\nSample insight keys: " + Object.keys(sampleAny.currentCompanyInsights).join(", "));
    console.log("Full: " + JSON.stringify(sampleAny.currentCompanyInsights).slice(0, 500));
  }

  await client.close();
}
main();
