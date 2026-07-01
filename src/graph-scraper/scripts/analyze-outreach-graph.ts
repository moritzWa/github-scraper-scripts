import dotenv from "dotenv";
import { MongoClient } from "mongodb";

dotenv.config();

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB);
  const users = db.collection("users");
  const edges = db.collection("edges");

  // Get all outreach users
  const outreachUsers = await users
    .find({ reviewStatus: "outreach" })
    .project({
      _id: 1,
      rating: 1,
      depth: 1,
      priority: 1,
      discoveredVia: 1,
      parentRatings: 1,
      engineerArchetype: 1,
      criteriaScores: 1,
    })
    .toArray();

  console.log(`=== OUTREACH CANDIDATES (${outreachUsers.length}) ===\n`);

  for (const u of outreachUsers) {
    const parentRatings = (u.parentRatings || []) as Array<{
      parent: string;
      rating: number;
    }>;
    const parentScores = parentRatings.map((p) => p.rating);
    const goodParents = parentScores.filter((s) => s >= 35);

    // Find who they follow and who follows them in our graph
    const followingEdges = await edges
      .find({ from: u._id })
      .toArray();
    const followerEdges = await edges
      .find({ to: u._id })
      .toArray();

    // Check how many of their connections are also high-scorers
    const followingUsernames = followingEdges.map((e: any) => e.to);
    const followerUsernames = followerEdges.map((e: any) => e.from);

    const highScoringFollowing = await users.countDocuments({
      _id: { $in: followingUsernames },
      status: "processed",
      rating: { $gte: 40 },
    });
    const highScoringFollowers = await users.countDocuments({
      _id: { $in: followerUsernames },
      status: "processed",
      rating: { $gte: 40 },
    });

    console.log(`${u._id} (score: ${u.rating})`);
    console.log(
      `  depth=${u.depth}, via=${u.discoveredVia}, priority=${u.priority?.toFixed?.(1)}`
    );
    console.log(
      `  parents: ${parentRatings.length} total, ${goodParents.length} good (35+): [${parentRatings.map((p) => `${p.parent}:${p.rating}`).join(", ")}]`
    );
    console.log(
      `  graph edges: follows ${followingEdges.length} in graph (${highScoringFollowing} scored 40+), followed by ${followerEdges.length} in graph (${highScoringFollowers} scored 40+)`
    );
    console.log();
  }

  // Summary stats
  console.log("=== SUMMARY ===");

  const avgDepth =
    outreachUsers.reduce((s, u) => s + (u.depth || 0), 0) /
    outreachUsers.length;
  const viaFollowing = outreachUsers.filter(
    (u) => u.discoveredVia === "following"
  ).length;
  const viaFollowers = outreachUsers.filter(
    (u) => u.discoveredVia === "followers"
  ).length;

  console.log(`  Avg depth: ${avgDepth.toFixed(1)}`);
  console.log(
    `  Discovered via: following=${viaFollowing}, followers=${viaFollowers}`
  );

  // Common parents (who discovers the most outreach-worthy candidates?)
  const parentCounts: Record<string, number> = {};
  for (const u of outreachUsers) {
    for (const p of u.parentRatings || []) {
      parentCounts[(p as any).parent] =
        (parentCounts[(p as any).parent] || 0) + 1;
    }
  }
  const topParents = Object.entries(parentCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  console.log(`\n  Top parents who discovered outreach candidates:`);
  for (const [parent, count] of topParents) {
    const parentDoc = await users.findOne(
      { _id: parent } as any,
      { projection: { rating: 1, name: 1 } }
    );
    console.log(
      `    ${parent} (score: ${parentDoc?.rating || "?"}, name: ${parentDoc?.name || "?"}): discovered ${count} outreach candidates`
    );
  }

  // Are outreach candidates connected to each other?
  const outreachIds = outreachUsers.map((u) => u._id);
  const interConnections = await edges.countDocuments({
    $or: [
      { from: { $in: outreachIds }, to: { $in: outreachIds } },
    ],
  });
  console.log(
    `\n  Connections between outreach candidates: ${interConnections}`
  );

  await client.close();
}

main().catch(console.error);
