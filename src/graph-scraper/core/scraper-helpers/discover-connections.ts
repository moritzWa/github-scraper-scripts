import { Octokit } from "@octokit/core";
import { Collection } from "mongodb";
import { DbGraphUser } from "../../types.js";

// Priority multipliers for edge direction.
// "following" = parent follows this user = parent vouches for them (strong signal).
// "followers" = this user follows the parent = weaker signal (anyone can follow).
const FOLLOWING_MULTIPLIER = 1.5;
const FOLLOWER_MULTIPLIER = 0.7;

// Weights for lineage-blended rating
const PARENT_WEIGHT = 0.7;
const GRANDPARENT_WEIGHT = 0.3;

export function computePriority(
  parentRating: number,
  edgeDirection: "following" | "followers",
  childDepth: number,
  grandparentRating?: number
): number {
  const multiplier =
    edgeDirection === "following" ? FOLLOWING_MULTIPLIER : FOLLOWER_MULTIPLIER;
  // Blend parent and grandparent ratings for lineage-aware priority
  const effectiveRating = grandparentRating
    ? parentRating * PARENT_WEIGHT + grandparentRating * GRANDPARENT_WEIGHT
    : parentRating;
  return (
    Math.round(((effectiveRating * multiplier) / Math.sqrt(childDepth)) * 100) /
    100
  );
}

/**
 * Discovers new users via a parent's following/followers list.
 * Inserts edges and upserts discovered users with computed priority.
 */
export async function discoverConnectionsPageByPage(
  parentUsername: string,
  depth: number,
  parentRating: number,
  connectionType: "followers" | "following",
  fetchFunction: (
    username: string,
    octokit: Octokit
  ) => AsyncGenerator<string[], void, undefined>,
  octokit: Octokit,
  usersCol: Collection<DbGraphUser>,
  edgesCol: Collection<any>,
  grandparentRating?: number
) {
  const childDepth = depth + 1;
  const childPriority = computePriority(
    parentRating,
    connectionType,
    childDepth,
    grandparentRating
  );

  try {
    for await (const pageItems of fetchFunction(parentUsername, octokit)) {
      if (pageItems.length === 0) continue;

      // Insert edges
      const edgeDocs =
        connectionType === "followers"
          ? pageItems.map((item) => ({ from: item, to: parentUsername }))
          : pageItems.map((item) => ({ from: parentUsername, to: item }));

      await edgesCol
        .insertMany(edgeDocs, { ordered: false })
        .catch(() => {}); // Ignore duplicate edge errors

      // Upsert discovered users in chunks
      const CHUNK_SIZE = 100;
      for (let i = 0; i < pageItems.length; i += CHUNK_SIZE) {
        const chunk = pageItems.slice(i, i + CHUNK_SIZE);
        await usersCol
          .bulkWrite(
            chunk.map((newUsername: string) => ({
              updateOne: {
                filter: { _id: newUsername },
                update: {
                  $setOnInsert: {
                    _id: newUsername,
                    status: "pending" as const,
                    depth: childDepth,
                    discoveredVia: connectionType,
                    scrapedConnections: { followers: false, following: false },
                  },
                  $max: { priority: childPriority },
                  $addToSet: {
                    parentRatings: {
                      parent: parentUsername,
                      rating: parentRating,
                    },
                  },
                },
                upsert: true,
              },
            }))
          )
          .catch((err: any) => {
            console.error(
              `Error upserting users from ${connectionType} for ${parentUsername}:`,
              err
            );
          });
      }
    }
  } catch (err) {
    console.error(
      `Error processing ${connectionType} for ${parentUsername}:`,
      err
    );
  }
}
