import { readFileSync, writeFileSync } from "fs";
import { GraphData, GraphUser } from "./types.js"; // Assuming types are correctly exported

interface RankedUser extends GraphUser {
  inboundInfluence: number;
  combinedScore: number;
}

// Function to calculate the inbound influence score
function calculateInboundInfluence(
  username: string,
  followersMap: Map<string, string[]>,
  userMap: Map<string, GraphUser>
): number {
  const followers = followersMap.get(username) || [];
  let totalFollowerInfluence = 0;
  for (const followerLogin of followers) {
    const followerUser = userMap.get(followerLogin);
    if (followerUser) {
      totalFollowerInfluence += followerUser.followers || 0;
    }
  }
  return totalFollowerInfluence;
}

// Function to calculate the combined score
function calculateCombinedScore(
  user: GraphUser,
  inboundInfluence: number,
  maxInboundInfluence: number // For normalization
): number {
  const followers = user.followers || 0;
  const contributions = user.contributions?.totalSum || 0;

  // Normalize scores (0-1 range)
  const normalizedFollowers = Math.min(followers / 1000, 1); // Cap at 1000 followers
  const normalizedContributions = Math.min(contributions / 3000, 1); // Cap at 3000 contributions
  const normalizedInboundInfluence =
    maxInboundInfluence > 0
      ? Math.min(inboundInfluence / maxInboundInfluence, 1) // Normalize against max observed influence
      : 0;

  // --- Adjust weights as needed ---
  const influenceWeight = 0.4;
  const contributionsWeight = 0.3;
  const followersWeight = 0.3;
  // ---

  const finalScoreNotRounded =
    (normalizedInboundInfluence * influenceWeight +
      normalizedContributions * contributionsWeight +
      normalizedFollowers * followersWeight) *
    100;

  return Math.round(finalScoreNotRounded);
}

function rankGraphUsers() {
  const dataPath = "dataOutputs/github-graph.json";
  const outputPath = "dataOutputs/ranked-github-graph.json";

  try {
    console.log(`Loading data from ${dataPath}...`);
    const rawData = readFileSync(dataPath, "utf8");
    // Type assertion needed as loaded data has Set converted to Array
    const graphData: Omit<
      GraphData,
      "processedUsernames" | "ignoredUsernames"
    > & { processedUsernames: string[]; ignoredUsernames: string[] } =
      JSON.parse(rawData);
    const users = graphData.users;
    const edges = graphData.edges;
    console.log(`Loaded ${users.length} users and ${edges.length} edges.`);

    // Create user lookup map
    const userMap = new Map<string, GraphUser>();
    users.forEach((user) => userMap.set(user.login, user));

    // Create followers map (who follows whom)
    const followersMap = new Map<string, string[]>();
    edges.forEach((edge) => {
      // edge.from is the follower, edge.to is the followed user
      const followedLogin = edge.to;
      const followerLogin = edge.from;
      if (!followersMap.has(followedLogin)) {
        followersMap.set(followedLogin, []);
      }
      followersMap.get(followedLogin)!.push(followerLogin);
    });

    console.log("Calculating inbound influence scores...");
    let maxInboundInfluence = 0;
    const usersWithInfluence: Array<GraphUser & { inboundInfluence: number }> =
      users.map((user) => {
        const influence = calculateInboundInfluence(
          user.login,
          followersMap,
          userMap
        );
        if (influence > maxInboundInfluence) {
          maxInboundInfluence = influence;
        }
        return { ...user, inboundInfluence: influence };
      });
    console.log(`Max inbound influence score: ${maxInboundInfluence}`);

    console.log("Calculating combined scores...");
    const rankedUsers: RankedUser[] = usersWithInfluence.map((user) => ({
      ...user,
      combinedScore: calculateCombinedScore(
        user,
        user.inboundInfluence,
        maxInboundInfluence
      ),
    }));

    // Sort users by combined score (descending)
    rankedUsers.sort((a, b) => b.combinedScore - a.combinedScore);

    // Output top 50 users
    console.log("\nTop 50 Users by Combined Score:");
    console.log("----------------------------------------");
    rankedUsers.slice(0, 50).forEach((user, index) => {
      console.log(`${index + 1}. https://github.com/${user.login}`);
      console.log(`   Score: ${user.combinedScore}`);
      console.log(`   Inbound Influence: ${user.inboundInfluence}`);
      console.log(`   Followers: ${user.followers || 0}`);
      console.log(`   Contributions: ${user.contributions?.totalSum || 0}`);
      console.log("----------------------------------------");
    });

    // Save the ranked users
    console.log(`\nSaving ranked users to ${outputPath}...`);
    writeFileSync(outputPath, JSON.stringify(rankedUsers, null, 2));
    console.log("Ranking complete.");
  } catch (error) {
    console.error("Error ranking graph users:", error);
  }
}

// Run the script
rankGraphUsers();
