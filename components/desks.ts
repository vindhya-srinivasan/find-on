// Person 1: drop-off desks (DPS, ITS). Read from Person 4's data/desks.json; the server keeps the same ids.
import desksData from '@/data/desks.json';

export type Desk = { id: string; name: string; building_id: string; hours_text: string };

export const DESKS: Desk[] = desksData;
export const DEFAULT_DESK = 'dps';

export function deskOf(id: string | null | undefined): Desk {
  return DESKS.find((d) => d.id === id) ?? DESKS.find((d) => d.id === DEFAULT_DESK) ?? DESKS[0];
}

export function deskName(id: string | null | undefined) {
  return deskOf(id).name;
}

/** One line under each drop-off option. */
export const DESK_BLURB: Record<string, string> = {
  dps: 'Easiest for you. DPS hands it over once the owner is verified.',
  its: 'Handy near Leavey Library. The ITS desk hands it over once the owner is verified.',
};
