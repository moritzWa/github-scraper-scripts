import dotenv from "dotenv";
import { MongoClient } from "mongodb";

dotenv.config();

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB);
  const users = db.collection("users");

  const outreach = await users
    .find({ reviewStatus: "outreach" })
    .project({
      _id: 1,
      name: 1,
      rating: 1,
      criteriaScores: 1,
      engineerArchetype: 1,
      inferredLocation: 1,
      company: 1,
      bio: 1,
      followers: 1,
      following: 1,
      public_repos: 1,
      contributions: 1,
      blog: 1,
      twitter_username: 1,
      linkedinUrl: 1,
    })
    .toArray();

  // Criteria score averages
  console.log("=== AVG CRITERIA SCORES (outreach vs all processed) ===");
  const allProcessed = await users
    .find({ status: "processed", criteriaScores: { $exists: true } })
    .project({ criteriaScores: 1 })
    .toArray();

  const criteriaKeys = Object.keys(outreach[0]?.criteriaScores || {});
  for (const key of criteriaKeys) {
    const outreachAvg =
      outreach
        .filter((u) => u.criteriaScores?.[key] != null)
        .reduce((s, u) => s + u.criteriaScores[key], 0) /
      outreach.filter((u) => u.criteriaScores?.[key] != null).length;
    const allAvg =
      allProcessed
        .filter((u) => u.criteriaScores?.[key] != null)
        .reduce((s, u) => s + u.criteriaScores[key], 0) /
      allProcessed.filter((u) => u.criteriaScores?.[key] != null).length;
    const diff = outreachAvg - allAvg;
    console.log(
      `  ${key.padEnd(25)} outreach: ${outreachAvg.toFixed(1)}  all: ${allAvg.toFixed(1)}  diff: ${diff > 0 ? "+" : ""}${diff.toFixed(1)}`
    );
  }

  // Archetypes
  console.log("\n=== ARCHETYPES ===");
  const archetypeCounts: Record<string, number> = {};
  for (const u of outreach) {
    for (const a of u.engineerArchetype || []) {
      archetypeCounts[a] = (archetypeCounts[a] || 0) + 1;
    }
  }
  for (const [a, c] of Object.entries(archetypeCounts).sort(
    (a, b) => b[1] - a[1]
  )) {
    console.log(`  ${a}: ${c}/${outreach.length}`);
  }

  // GitHub profile richness
  console.log("\n=== GITHUB PROFILE TRAITS ===");
  const withBlog = outreach.filter((u) => u.blog).length;
  const withTwitter = outreach.filter((u) => u.twitter_username).length;
  const withLinkedin = outreach.filter((u) => u.linkedinUrl).length;
  const withBio = outreach.filter((u) => u.bio).length;
  const avgFollowers =
    outreach.reduce((s, u) => s + (u.followers || 0), 0) / outreach.length;
  const avgRepos =
    outreach.reduce((s, u) => s + (u.public_repos || 0), 0) / outreach.length;
  const avgContributions =
    outreach
      .filter((u) => u.contributions)
      .reduce((s, u) => s + (u.contributions?.totalSum || 0), 0) /
    outreach.filter((u) => u.contributions).length;

  // Compare with all processed
  const allWithBlog = await users.countDocuments({
    status: "processed",
    blog: { $exists: true, $ne: null } as any,
  });
  const allProcessedCount = await users.countDocuments({ status: "processed" });

  const allAvgFollowers = (
    await users
      .aggregate([
        { $match: { status: "processed" } },
        { $group: { _id: null, avg: { $avg: "$followers" } } },
      ])
      .toArray()
  )[0]?.avg;

  const allAvgRepos = (
    await users
      .aggregate([
        { $match: { status: "processed" } },
        { $group: { _id: null, avg: { $avg: "$public_repos" } } },
      ])
      .toArray()
  )[0]?.avg;

  console.log(
    `  Has blog:     ${withBlog}/${outreach.length} (${((withBlog / outreach.length) * 100).toFixed(0)}%) vs all: ${((allWithBlog / allProcessedCount) * 100).toFixed(0)}%`
  );
  console.log(
    `  Has Twitter:  ${withTwitter}/${outreach.length} (${((withTwitter / outreach.length) * 100).toFixed(0)}%)`
  );
  console.log(
    `  Has LinkedIn: ${withLinkedin}/${outreach.length} (${((withLinkedin / outreach.length) * 100).toFixed(0)}%)`
  );
  console.log(
    `  Has bio:      ${withBio}/${outreach.length} (${((withBio / outreach.length) * 100).toFixed(0)}%)`
  );
  console.log(
    `  Avg followers:      ${avgFollowers.toFixed(0)} vs all: ${allAvgFollowers?.toFixed(0)}`
  );
  console.log(
    `  Avg public repos:   ${avgRepos.toFixed(0)} vs all: ${allAvgRepos?.toFixed(0)}`
  );
  console.log(`  Avg contributions:  ${avgContributions.toFixed(0)}`);

  // Location distribution
  console.log("\n=== LOCATIONS ===");
  for (const u of outreach) {
    console.log(`  ${(u.name || u._id).padEnd(25)} ${u.inferredLocation || "?"}`);
  }

  // Bios
  console.log("\n=== BIOS ===");
  for (const u of outreach) {
    console.log(`  ${(u.name || u._id).padEnd(25)} ${(u.bio || "no bio").substring(0, 80)}`);
  }

  // Companies
  console.log("\n=== COMPANIES ===");
  for (const u of outreach) {
    console.log(`  ${(u.name || u._id).padEnd(25)} ${u.company || "none"}`);
  }

  await client.close();
}

main().catch(console.error);
