import { connectToDatabase } from "../core/db.js";
import { GraphUser } from "../types.js";

interface ParentRatings {
  [key: string]: number;
}

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
        `[${percentage}%] Processing ${followerEdges.length} followers for ${user.login}`
      );

      // Get all follower usernames
      const followerUsernames = followerEdges.map((edge) => edge.from);

      // Update each follower with the parent's rating
      for (const followerUsername of followerUsernames) {
        const update = {
          $set: {
            parentRatings: {
              ...(((await users.findOne({ _id: followerUsername }))
                ?.parentRatings as ParentRatings) || {}),
              [user._id]: user.rating!,
            },
          },
        };

        await users.updateOne({ _id: followerUsername }, update);
      }

      // After getting followerEdges
      if (processedCount === 0) {
        console.log("\nDebug Info:");
        console.log("Sample edge:", JSON.stringify(followerEdges[0], null, 2));
        console.log("Total edges in collection:", await edges.countDocuments());

        // Add this to check parent ratings distribution
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
    if (user.parentRatings) {
      const ratings = Object.values(user.parentRatings as ParentRatings);
      if (ratings.length > 0) {
        const averageRating =
          ratings.reduce((a, b) => a + b, 0) / ratings.length;

        await users.updateOne(
          { _id: user._id },
          { $set: { averageParentRating: averageRating } }
        );
      }
    }
  }

  // Add after the main processing
  const verification = await users
    .find({
      $or: [{ depth: 1 }, { depth: 2 }],
    })
    .toArray();

  console.log("\nVerification Results:");
  console.log(`Total depth 1 and 2 users: ${verification.length}`);
  console.log(
    `Users with parentRatings: ${
      verification.filter((u) => u.parentRatings).length
    }`
  );
  console.log(
    `Users with averageParentRating: ${
      verification.filter((u) => u.averageParentRating).length
    }`
  );

  // Sample a few users to inspect
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
