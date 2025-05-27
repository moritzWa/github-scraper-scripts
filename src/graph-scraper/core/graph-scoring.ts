import dotenv from "dotenv";
import { MongoClient, ObjectId } from "mongodb";
import { DbGraphUser } from "../types.js"; // Assuming DbGraphUser is in this path and has login, rating

dotenv.config();

const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017";
const dbName = process.env.MONGODB_DB;

interface UserWithWeightedInflowScore {
  login: string; // This will store the effective identifier
  ownRating?: number;
  weightedInflowScore: number;
  followersContributingScore: number;
}

interface UserWithEigenvectorScore {
  login: string; // This will store the effective identifier
  eigenvectorScore: number;
}

// Helper to get a consistent identifier for a user
function getUserIdentifier(user: {
  login?: string | null;
  _id: ObjectId | string;
}): string {
  return user.login || user._id.toString();
}

async function calculateGraphScores() {
  if (!dbName) {
    console.error(
      "MongoDB database name not set. Please set MONGODB_DB in your .env file."
    );
    return;
  }
  const client = new MongoClient(mongoUri);

  try {
    await client.connect();
    console.log("Connected to MongoDB");
    const db = client.db(dbName);
    const usersCol = db.collection<DbGraphUser>("users");
    const edgesCol = db.collection<{ from: string; to: string }>("edges"); // Assuming 'from' and 'to' are user logins

    // Adjusted type cast: login is optional, _id is ObjectId or string
    const allUsersArray = (await usersCol
      .find({})
      .toArray()) as (DbGraphUser & {
      login?: string | null; // login can be null or undefined
      rating?: number;
      _id: ObjectId | string; // _id is always present, can be ObjectId or string
    })[];
    if (allUsersArray.length === 0) {
      console.log("No users found in the database.");
      return;
    }

    // Use effective identifier for userMap keys
    const userMap = new Map<
      string,
      DbGraphUser & {
        login?: string | null;
        rating?: number;
        _id: ObjectId | string;
      }
    >();
    for (const u of allUsersArray) {
      userMap.set(getUserIdentifier(u), u);
    }
    console.log(`Loaded ${allUsersArray.length} users.`);

    const allEdges = await edgesCol.find({}).toArray();
    console.log(`Loaded ${allEdges.length} edges.`);

    // 1. Calculate Weighted Inflow Score
    console.log("\nCalculating Weighted Inflow Scores...");
    const inflowScores = new Map<string, { score: number; count: number }>();

    for (const edge of allEdges) {
      const followerLogin = edge.from; // Assumed to be an effective identifier
      const followeeLogin = edge.to; // Assumed to be an effective identifier

      const follower = userMap.get(followerLogin);
      if (follower && typeof follower.rating === "number") {
        const current = inflowScores.get(followeeLogin) || {
          score: 0,
          count: 0,
        };
        inflowScores.set(followeeLogin, {
          score: current.score + follower.rating,
          count: current.count + 1,
        });
      }
    }

    const candidates: UserWithWeightedInflowScore[] = [];
    for (const user of allUsersArray) {
      const userIdentifier = getUserIdentifier(user);
      if (user.rating !== undefined && user.rating > 30) {
        const inflowData = inflowScores.get(userIdentifier);
        candidates.push({
          login: userIdentifier, // Store effective identifier
          ownRating: user.rating,
          weightedInflowScore: inflowData?.score || 0,
          followersContributingScore: inflowData?.count || 0,
        });
      }
    }

    candidates.sort((a, b) => b.weightedInflowScore - a.weightedInflowScore);

    console.log("\nTop 10 Users (Own Rating > 30) by Weighted Inflow Score:");
    console.log(
      "------------------------------------------------------------------"
    );
    console.log(
      "User Login         | Own Rating | Weighted Inflow Score | Contributing Followers"
    );
    console.log(
      "-------------------|------------|-----------------------|------------------------"
    );
    candidates.slice(0, 10).forEach((user) => {
      console.log(
        `${user.login.padEnd(18)} | ${String(user.ownRating ?? "N/A").padEnd(
          10
        )} | ${String(user.weightedInflowScore).padEnd(21)} | ${String(
          user.followersContributingScore
        ).padEnd(22)}`
      );
    });

    // 2. Calculate Eigenvector Centrality
    console.log("\nCalculating Eigenvector Centrality...");
    // Use effective identifiers for Eigenvector Centrality
    const allUserIdentifiers = allUsersArray.map((u) => getUserIdentifier(u));

    // Filter out any potential duplicates if identifiers weren't unique (should be rare)
    const uniqueUserIdentifiers = [...new Set(allUserIdentifiers)];

    const loginToIndex = new Map<string, number>(
      uniqueUserIdentifiers.map((id, i) => [id, i])
    );
    const indexToLogin = uniqueUserIdentifiers; // This now stores unique effective identifiers
    const numUsers = uniqueUserIdentifiers.length;

    if (numUsers === 0) {
      console.log("Skipping Eigenvector Centrality as there are no users.");
    } else {
      const adjListIncoming: number[][] = Array.from(
        { length: numUsers },
        () => []
      );

      for (const edge of allEdges) {
        const followerIdentifier = edge.from; // Assumed to be an effective identifier
        const followeeIdentifier = edge.to; // Assumed to be an effective identifier

        const followerIndex = loginToIndex.get(followerIdentifier);
        const followeeIndex = loginToIndex.get(followeeIdentifier);

        if (followerIndex !== undefined && followeeIndex !== undefined) {
          adjListIncoming[followeeIndex].push(followerIndex);
        }
      }

      let scores = Array(numUsers).fill(1 / numUsers);
      const iterations = 100;

      for (let iter = 0; iter < iterations; iter++) {
        const newScores = Array(numUsers).fill(0);
        let l2Norm = 0;

        for (let i = 0; i < numUsers; i++) {
          for (const j of adjListIncoming[i]) {
            newScores[i] += scores[j];
          }
        }

        for (let i = 0; i < numUsers; i++) {
          l2Norm += newScores[i] * newScores[i];
        }
        l2Norm = Math.sqrt(l2Norm);

        if (l2Norm === 0) {
          console.log(
            "Eigenvector scores converged to zero, stopping iteration."
          );
          break;
        }

        for (let i = 0; i < numUsers; i++) {
          newScores[i] /= l2Norm;
        }
        scores = newScores;
      }

      const eigenResults: UserWithEigenvectorScore[] = scores.map(
        (score, index) => ({
          login: indexToLogin[index], // This is the effective identifier
          eigenvectorScore: score,
        })
      );

      eigenResults.sort((a, b) => b.eigenvectorScore - a.eigenvectorScore);

      console.log("\nTop 10 Users by Eigenvector Centrality:");
      console.log("----------------------------------------------------");
      console.log("User Login         | Eigenvector Score");
      console.log("-------------------|------------------");
      eigenResults.slice(0, 10).forEach((user) => {
        console.log(
          `${user.login.padEnd(18)} | ${user.eigenvectorScore.toFixed(6)}`
        );
      });
    }
  } catch (error) {
    console.error("Error calculating graph scores:", error);
  } finally {
    await client.close();
    console.log("\nMongoDB connection closed.");
  }
}

calculateGraphScores().catch(console.error);
