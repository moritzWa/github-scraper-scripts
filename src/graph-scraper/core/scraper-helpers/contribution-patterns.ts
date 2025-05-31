interface CalendarWeek {
  contributionDays: {
    contributionCount: number;
    date: string;
  }[];
}

export function isActiveInEnoughMonths(
  calendarWeeks: CalendarWeek[],
  minMonths: number = 8
): boolean {
  if (!calendarWeeks) return false;

  const activeMonths = new Set<string>();

  calendarWeeks.forEach((week) => {
    week.contributionDays.forEach((day) => {
      if (day.contributionCount > 0) {
        const monthKey = day.date.substring(0, 7);
        activeMonths.add(monthKey);
      }
    });
  });

  return activeMonths.size >= minMonths;
}

export function isWeekdayCoder(
  calendarWeeks: CalendarWeek[],
  weekdayThreshold: number = 0.85
): boolean {
  if (!calendarWeeks) return false;

  let weekdayContributions = 0;
  let weekendContributions = 0;

  calendarWeeks.forEach((week) => {
    week.contributionDays.forEach((day) => {
      const date = new Date(day.date);
      const dayOfWeek = date.getUTCDay();

      if (day.contributionCount > 0) {
        if (dayOfWeek >= 1 && dayOfWeek <= 5) {
          weekdayContributions += day.contributionCount;
        } else {
          weekendContributions += day.contributionCount;
        }
      }
    });
  });

  const totalContributions = weekdayContributions + weekendContributions;
  if (totalContributions === 0) {
    return false;
  }

  const weekdayRatio = weekdayContributions / totalContributions;
  return weekdayRatio > weekdayThreshold;
}
