import type { Availability } from "../types.ts";

const RANK: Record<Availability, number> = {
  available: 3,
  downloading: 2,
  downloadable: 1,
  unavailable: 0,
};

export function mergeAvailability(...values: Availability[]): Availability {
  let best: Availability = "unavailable";
  for (const value of values) {
    if (RANK[value] > RANK[best]) best = value;
  }
  return best;
}
