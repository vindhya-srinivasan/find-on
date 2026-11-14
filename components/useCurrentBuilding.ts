// Person 1: phone location → nearest campus building. Raw coordinates never leave this hook.
'use client';

import { useCallback, useState } from 'react';
import type { Building } from '@/types';
import { nearestBuilding } from '@/lib/location';

export type LocState =
  | { kind: 'idle' }
  | { kind: 'locating' }
  | { kind: 'found'; building: Building }
  | { kind: 'off_campus' }
  | { kind: 'failed'; reason: string };

const OFF_CAMPUS_M = 300;

export function useCurrentBuilding(buildings: Building[]) {
  const [state, setState] = useState<LocState>({ kind: 'idle' });

  const locate = useCallback(() => {
    if (!buildings.length) return;
    if (!('geolocation' in navigator)) {
      setState({ kind: 'failed', reason: 'Location isn’t available on this device.' });
      return;
    }
    setState({ kind: 'locating' });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { building, distanceM } = nearestBuilding(pos.coords.latitude, pos.coords.longitude, buildings.filter((b) => b.type !== 'desk'));
        setState(distanceM > OFF_CAMPUS_M ? { kind: 'off_campus' } : { kind: 'found', building });
      },
      (err) => setState({ kind: 'failed', reason: err.code === err.PERMISSION_DENIED ? 'Location permission was denied.' : 'Couldn’t get your location.' }),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }, [buildings]);

  return { state, locate };
}
