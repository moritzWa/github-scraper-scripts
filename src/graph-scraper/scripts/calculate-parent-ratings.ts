import { connectToDatabase } from "../core/db.js";
import { GraphUser } from "../types.js";

async function calculateParentRatings() {
  const db = await connectToDatabase();
  const users = db.collection<GraphUser>("users");
  const edges = db.collection("edges");

  // Get all users that have a rating
  const ratedUsers = await users.find({ rating: { $exists: true } }).toArray();
  const totalRatedUsers = ratedUsers.length;
  console.log(`Found ${totalRatedUsers} rated users`);

  // For each rated user, find their followers using the edges collection
  let processedCount = 0;
  for (const user of ratedUsers) {
    // Find all edges where this user is being followed
    const followerEdges = await edges.find({ to: user._id }).toArray();

    if (followerEdges.length > 0) {
      const percentage = ((processedCount / totalRatedUsers) * 100).toFixed(1);
      console.log(
        `[${percentage}%] Processing ${followerEdges.length} followers for ${user._id}`
      );

      const followerUsernames = followerEdges.map((edge) => edge.from);

      for (const followerUsername of followerUsernames) {
        // Add this parent rating to the array, avoiding duplicates
        await users.updateOne(
          { _id: followerUsername },
          {
            $addToSet: {
              parentRatings: {
                parent: user._id,
                rating: user.rating!,
              },
            },
          }
        );
      }

      if (processedCount === 0) {
        console.log("\nDebug Info:");
        console.log("Sample edge:", JSON.stringify(followerEdges[0], null, 2));
        console.log("Total edges in collection:", await edges.countDocuments());

        const ratingStats = await users
          .aggregate([
            { $match: { depth: { $in: [1, 2] } } },
            {
              $group: {
                _id: "$depth",
                total: { $sum: 1 },
                withParentRatings: {
                  $sum: {
                    $cond: [{ $ifNull: ["$parentRatings", false] }, 1, 0],
                  },
                },
              },
            },
            { $sort: { _id: 1 } },
          ])
          .toArray();
        console.log(
          "Parent ratings by depth:",
          JSON.stringify(ratingStats, null, 2)
        );
      }
    }
    processedCount++;
  }

  // Calculate average parent ratings for all users
  const allUsers = await users.find({}).toArray();
  console.log(
    `Calculating average parent ratings for ${allUsers.length} users`
  );

  for (const user of allUsers) {
    const parentRatings = user.parentRatings;
    if (parentRatings && parentRatings.length > 0) {
      const averageRating =
        parentRatings.reduce((sum, pr) => sum + pr.rating, 0) /
        parentRatings.length;

      await users.updateOne(
        { _id: user._id },
        { $set: { averageParentRating: averageRating } }
      );
    }
  }

  // Verification
  const verification = await users
    .find({
      $or: [{ depth: 1 }, { depth: 2 }],
    })
    .toArray();

  console.log("\nVerification Results:");
  console.log(`Total depth 1 and 2 users: ${verification.length}`);
  console.log(
    `Users with parentRatings: ${
      verification.filter((u) => u.parentRatings && u.parentRatings.length > 0)
        .length
    }`
  );
  console.log(
    `Users with averageParentRating: ${
      verification.filter((u) => u.averageParentRating).length
    }`
  );

  const sampleUsers = await users
    .find({
      $or: [{ depth: 1 }, { depth: 2 }],
    })
    .limit(5)
    .toArray();

  console.log("\nSample Users:");
  sampleUsers.forEach((user) => {
    console.log(`\nUser: ${user._id}`);
    console.log(`Depth: ${user.depth}`);
    console.log(`Parent Ratings: ${JSON.stringify(user.parentRatings)}`);
    console.log(`Average Parent Rating: ${user.averageParentRating}`);
  });

  console.log("Finished calculating parent ratings");
}

calculateParentRatings().catch(console.error);
