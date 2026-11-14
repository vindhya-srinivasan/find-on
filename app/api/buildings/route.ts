// Person 2 — campus buildings (data owned by Person 4 in data/buildings.json).
import buildings from '@/data/buildings.json';
import type { Building } from '@/types';

export async function GET() {
  return Response.json(buildings as Building[]);
}
