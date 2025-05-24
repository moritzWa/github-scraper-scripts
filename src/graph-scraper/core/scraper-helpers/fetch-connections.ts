import { Octokit } from "@octokit/core";
import { withRateLimitRetry } from "../../../utils/prime-scraper-api-utils.js";

// Helper functions (async generators for paged fetching)
export async function* fetchFollowersPaged(
  username: string,
  octokit: Octokit
): AsyncGenerator<string[], void, undefined> {
  let page = 1;
  const perPage = 100; // Keep this per page for API calls
  while (true) {
    const response = await withRateLimitRetry(() =>
      octokit.request("GET /users/{username}/followers", {
        username,
        per_page: perPage,
        page,
      })
    );
    if (response.data.length === 0) break;
    const currentPageFollowers = response.data
      .filter((user: any) => user.type === "User")
      .map((user: any) => user.login);

    if (currentPageFollowers.length > 0) {
      yield currentPageFollowers;
    }

    if (response.data.length < perPage) break;
    page++;
  }
}

export async function* fetchFollowingPaged(
  username: string,
  octokit: Octokit
): AsyncGenerator<string[], void, undefined> {
  let page = 1;
  const perPage = 100; // Keep this per page for API calls
  while (true) {
    const response = await withRateLimitRetry(() =>
      octokit.request("GET /users/{username}/following", {
        username,
        per_page: perPage,
        page,
      })
    );
    if (response.data.length === 0) break;
    const currentPageFollowing = response.data
      .filter((user: any) => user.type === "User")
      .map((user: any) => user.login);

    if (currentPageFollowing.length > 0) {
      yield currentPageFollowing;
    }

    if (response.data.length < perPage) break;
    page++;
  }
}
