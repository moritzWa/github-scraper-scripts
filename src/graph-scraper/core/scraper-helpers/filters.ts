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

  if (countProfileFields(userData) < 1) {
    console.log(
      `[Filter Check] ${userData.login} rejected: INSUFFICIENT_PROFILE_FIELDS`
    );
    return {
      shouldIgnore: true,
      reason: IgnoredReason.INSUFFICIENT_PROFILE_FIELDS,
    };
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

  if (contributions.totalSum < 500) {
    console.log(
      `[Filter Check] ${userData.login} rejected: LOW_CONTRIBUTIONS (${contributions.totalSum})`
    );
    return {
      shouldIgnore: true,
      reason: IgnoredReason.LOW_CONTRIBUTIONS_LOW_FOLLOWERS,
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
