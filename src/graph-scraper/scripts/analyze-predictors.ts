import dotenv from "dotenv";
import { MongoClient } from "mongodb";
dotenv.config();

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB);
  const users = db.collection("users");

  // 1. Does "following" vs "followers" discovery direction predict score?
  console.log("=== SCORE BY DISCOVERY DIRECTION ===");
  for (const via of ["following", "followers"]) {
    const results = await users.aggregate([
      { $match: { status: "processed", rating: { $exists: true }, discoveredVia: via } },
      { $group: { _id: null, avgScore: { $avg: "$rating" }, count: { $sum: 1 }, scored40plus: { $sum: { $cond: [{ $gte: ["$rating", 40] }, 1, 0] } } } }
    ]).toArray();
    if (results.length) {
      const r = results[0];
      console.log(`  ${via}: avg=${r.avgScore.toFixed(1)}, count=${r.count}, 40+=${r.scored40plus} (${((r.scored40plus/r.count)*100).toFixed(1)}%)`);
    }
  }

  // 2. Does depth predict score?
  console.log("\n=== SCORE BY DEPTH ===");
  const depthResults = await users.aggregate([
    { $match: { status: "processed", rating: { $exists: true }, depth: { $exists: true } } },
    { $group: { _id: "$depth", avgScore: { $avg: "$rating" }, count: { $sum: 1 }, scored40plus: { $sum: { $cond: [{ $gte: ["$rating", 40] }, 1, 0] } } } },
    { $sort: { _id: 1 } }
  ]).toArray();
  for (const r of depthResults) {
    console.log(`  depth=${r._id}: avg=${r.avgScore.toFixed(1)}, count=${r.count}, 40+=${r.scored40plus} (${((r.scored40plus/r.count)*100).toFixed(1)}%)`);
  }

  // 3. Does max parent rating predict score?
  console.log("\n=== SCORE BY MAX PARENT RATING ===");
  const processed = await users.find({ 
    status: "processed", 
    rating: { $exists: true },
    parentRatings: { $exists: true, $ne: [] }
  }).project({ rating: 1, parentRatings: 1, depth: 1, discoveredVia: 1 }).toArray();
  
  const buckets: Record<string, { total: number; good: number; sumScore: number }> = {
    "parent 55+": { total: 0, good: 0, sumScore: 0 },
    "parent 45-55": { total: 0, good: 0, sumScore: 0 },
    "parent 35-45": { total: 0, good: 0, sumScore: 0 },
    "parent 25-35": { total: 0, good: 0, sumScore: 0 },
    "parent <25": { total: 0, good: 0, sumScore: 0 },
  };

  for (const u of processed) {
    const parentScores = (u.parentRatings || []).map((p: any) => typeof p === "number" ? p : p.rating).filter((r: any) => typeof r === "number");
    if (!parentScores.length) continue;
    const maxParent = Math.max(...parentScores);
    
    let bucket: string;
    if (maxParent >= 55) bucket = "parent 55+";
    else if (maxParent >= 45) bucket = "parent 45-55";
    else if (maxParent >= 35) bucket = "parent 35-45";
    else if (maxParent >= 25) bucket = "parent 25-35";
    else bucket = "parent <25";
    
    buckets[bucket].total++;
    buckets[bucket].sumScore += u.rating;
    if (u.rating >= 40) buckets[bucket].good++;
  }
  
  for (const [label, b] of Object.entries(buckets)) {
    if (b.total > 0) {
      console.log(`  ${label}: avg=${(b.sumScore/b.total).toFixed(1)}, count=${b.total}, 40+=${b.good} (${((b.good/b.total)*100).toFixed(1)}%)`);
    }
  }

  // 4. Does number of parents (discovered by multiple high-scoring people) predict score?
  console.log("\n=== SCORE BY NUMBER OF PARENTS ===");
  const parentCountBuckets: Record<string, { total: number; good: number; sumScore: number }> = {
    "1 parent": { total: 0, good: 0, sumScore: 0 },
    "2-3 parents": { total: 0, good: 0, sumScore: 0 },
    "4-6 parents": { total: 0, good: 0, sumScore: 0 },
    "7+ parents": { total: 0, good: 0, sumScore: 0 },
  };

  for (const u of processed) {
    const nParents = (u.parentRatings || []).length;
    if (!nParents) continue;
    
    let bucket: string;
    if (nParents >= 7) bucket = "7+ parents";
    else if (nParents >= 4) bucket = "4-6 parents";
    else if (nParents >= 2) bucket = "2-3 parents";
    else bucket = "1 parent";
    
    parentCountBuckets[bucket].total++;
    parentCountBuckets[bucket].sumScore += u.rating;
    if (u.rating >= 40) parentCountBuckets[bucket].good++;
  }
  
  for (const [label, b] of Object.entries(parentCountBuckets)) {
    if (b.total > 0) {
      console.log(`  ${label}: avg=${(b.sumScore/b.total).toFixed(1)}, count=${b.total}, 40+=${b.good} (${((b.good/b.total)*100).toFixed(1)}%)`);
    }
  }

  // 5. Does "following" from a high-scorer beat "followers" from a high-scorer?
  console.log("\n=== COMBINED: DIRECTION + MAX PARENT SCORE ===");
  const comboBuckets: Record<string, { total: number; good: number; sumScore: number }> = {};
  
  for (const u of processed) {
    const parentScores = (u.parentRatings || []).map((p: any) => typeof p === "number" ? p : p.rating).filter((r: any) => typeof r === "number");
    if (!parentScores.length) continue;
    const maxParent = Math.max(...parentScores);
    const via = u.discoveredVia || "unknown";
    
    let parentBucket: string;
    if (maxParent >= 45) parentBucket = "45+";
    else if (maxParent >= 35) parentBucket = "35-45";
    else parentBucket = "<35";
    
    const key = `${via} + parent ${parentBucket}`;
    if (!comboBuckets[key]) comboBuckets[key] = { total: 0, good: 0, sumScore: 0 };
    comboBuckets[key].total++;
    comboBuckets[key].sumScore += u.rating;
    if (u.rating >= 40) comboBuckets[key].good++;
  }
  
  for (const [label, b] of Object.entries(comboBuckets).sort((a, b) => (b[1].good/b[1].total) - (a[1].good/a[1].total))) {
    if (b.total > 10) {
      console.log(`  ${label}: avg=${(b.sumScore/b.total).toFixed(1)}, count=${b.total}, 40+=${b.good} (${((b.good/b.total)*100).toFixed(1)}%)`);
    }
  }

  // 6. GitHub metadata available before scraping: do we have followers count, public repos, etc?
  console.log("\n=== GITHUB METADATA CORRELATION ===");
  // Check if we have any pre-scrape metadata
  const sampleWithMeta = await users.findOne(
    { status: "processed", rating: { $exists: true } },
    { projection: { _id: 1, followers: 1, following: 1, public_repos: 1, githubFollowers: 1, githubData: 1 } }
  );
  console.log("  Sample fields:", JSON.stringify(Object.keys(sampleWithMeta || {})));

  await client.close();
}
main().catch(console.error);
