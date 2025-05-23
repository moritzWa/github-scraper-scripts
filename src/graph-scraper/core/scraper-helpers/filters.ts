import { isLocationInBadCountries } from "../../../utils/location.js";
import { countProfileFields } from "../../../utils/prime-scraper-api-utils.js";
import { ContributionData, IgnoredReason } from "../../types.js";
import {
  isActiveInEnoughMonths,
  isWeekdayCoder,
} from "./contribution-patterns.js";

export async function checkUserFilters(
  userData: any,
  contributions: ContributionData | null | undefined
): Promise<{ shouldIgnore: boolean; reason?: IgnoredReason }> {
  console.log(
    `[Filter Check] Checking filters for ${userData.login} (depth: ${userData.depth})`
  );

  if (userData.location && isLocationInBadCountries(userData.location)) {
    console.log(`[Filter Check] ${userData.login} rejected: BANNED_COUNTRY`);
    return { shouldIgnore: true, reason: IgnoredReason.BANNED_COUNTRY };
  }

  const createdAt = new Date(userData.created_at);
  if (createdAt > new Date("2019-01-01")) {
    console.log(`[Filter Check] ${userData.login} rejected: ACCOUNT_TOO_NEW`);
    return { shouldIgnore: true, reason: IgnoredReason.ACCOUNT_TOO_NEW };
  }

  if (countProfileFields(userData) < 1) {
    console.log(
      `[Filter Check] ${userData.login} rejected: INSUFFICIENT_PROFILE_FIELDS`
    );
    return {
      shouldIgnore: true,
      reason: IgnoredReason.INSUFFICIENT_PROFILE_FIELDS,
    };
  }

  if (userData.followers > 3500) {
    console.log(
      `[Filter Check] ${userData.login} rejected: TOO_MANY_FOLLOWERS`
    );
    return { shouldIgnore: true, reason: IgnoredReason.TOO_MANY_FOLLOWERS };
  }

  if (userData.following > 415) {
    console.log(
      `[Filter Check] ${userData.login} rejected: TOO_MANY_FOLLOWING`
    );
    return { shouldIgnore: true, reason: IgnoredReason.TOO_MANY_FOLLOWING };
  }

  if (!contributions) {
    console.log(
      `[Filter Check] ${userData.login} rejected: COULD_NOT_FETCH_CONTRIBUTIONS`
    );
    return {
      shouldIgnore: true,
      reason: IgnoredReason.COULD_NOT_FETCH_CONTRIBUTIONS,
    };
  }

  if (userData.followers <= 35 && contributions.totalSum < 3500) {
    console.log(
      `[Filter Check] ${userData.login} rejected: LOW_CONTRIBUTIONS_LOW_FOLLOWERS`
    );
    return {
      shouldIgnore: true,
      reason: IgnoredReason.LOW_CONTRIBUTIONS_LOW_FOLLOWERS,
    };
  } else if (
    userData.followers > 35 &&
    userData.followers <= 60 &&
    contributions.totalSum < 3000
  ) {
    console.log(
      `[Filter Check] ${userData.login} rejected: LOW_CONTRIBUTIONS_MEDIUM_FOLLOWERS`
    );
    return {
      shouldIgnore: true,
      reason: IgnoredReason.LOW_CONTRIBUTIONS_MEDIUM_FOLLOWERS,
    };
  } else if (userData.followers > 60 && contributions.totalSum < 2000) {
    console.log(
      `[Filter Check] ${userData.login} rejected: LOW_CONTRIBUTIONS_HIGH_FOLLOWERS`
    );
    return {
      shouldIgnore: true,
      reason: IgnoredReason.LOW_CONTRIBUTIONS_HIGH_FOLLOWERS,
    };
  }

  if (contributions.calendar_weeks) {
    if (!isActiveInEnoughMonths(contributions.calendar_weeks)) {
      console.log(
        `[Filter Check] ${userData.login} rejected: NOT_ACTIVE_ENOUGH_MONTHS`
      );
      return {
        shouldIgnore: true,
        reason: IgnoredReason.NOT_ACTIVE_ENOUGH_MONTHS,
      };
    }
    if (isWeekdayCoder(contributions.calendar_weeks)) {
      console.log(`[Filter Check] ${userData.login} rejected: WEEKDAY_CODER`);
      return { shouldIgnore: true, reason: IgnoredReason.WEEKDAY_CODER };
    }
  }

  console.log(`[Filter Check] ${userData.login} passed all filters`);
  return { shouldIgnore: false };
}
