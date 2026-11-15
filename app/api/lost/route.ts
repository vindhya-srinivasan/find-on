// Person 2: save a lost report (calls parseLostReport), run matching, return matches. Contract: Team Tasks > API routes.
import { LostForm, badRequest, error, formFields, json } from '@/lib/api';
import { parseLostReport } from '@/lib/ai';
import { canFileLostReport, runMatchingForLostReport } from '@/lib/db';
import { requireUser } from '@/lib/supabase/auth';
import { supabaseAdmin } from '@/lib/supabase/server';
import { BadImageError, deletePhotos, saveLostPhoto } from '@/lib/supabase/storage';
import type { MatchWithItem, ParsedLostReport } from '@/types';

const FAIL = () => error('Something went wrong. Try again.', 500);
const SAVE_FAIL = () => error('Could not save the report. Try again.', 500);
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export async function POST(req: Request) {
  try {
    const me = await requireUser(req, { write: true });
    if (me instanceof Response) return me;

    let fd: FormData;
    try {
      fd = await req.formData();
    } catch {
      return error('Bad form data', 400);
    }
    const form = LostForm.safeParse(formFields(fd));
    if (!form.success) return badRequest(form.error);
    const { text, buildingIds, notSure, landmarks, photo } = form.data;

    const db = supabaseAdmin();
    const open = await db.from('lost_reports').select('id', { count: 'exact', head: true }).eq('owner_id', me.id).eq('status', 'open');
    if (open.error) return FAIL();
    const can = canFileLostReport(open.count ?? 0);
    if (!can.ok) return error(can.reason, 409);

    const ids = [...new Set(buildingIds)];
    if (ids.length) {
      const b = await db.from('buildings').select('id').in('id', ids);
      if (b.error) return FAIL();
      if ((b.data ?? []).length !== ids.length) return error('buildingIds: unknown building', 400);
    }

    const now = new Date();
    let parsed: ParsedLostReport | null = null;
    try {
      const p = await parseLostReport({ text, now: now.toISOString() });
      const start = Date.parse(p.time_start);
      const end = Date.parse(p.time_end);
      if (p.category?.trim() && Number.isFinite(start) && Number.isFinite(end) && start <= end) parsed = p;
    } catch {
      // fall through to the manual fallback below
    }
    if (!parsed) {
      console.warn('parseLostReport fallback');
      parsed = {
        category: 'other', color: null, brand: null, marks: [],
        time_start: new Date(now.getTime() - WEEK_MS).toISOString(), time_end: now.toISOString(),
        summary: text.slice(0, 200),
      };
    }

    const reportId = crypto.randomUUID();
    let owner_photo_path: string | null = null;
    if (photo) {
      try {
        owner_photo_path = await saveLostPhoto(reportId, photo);
      } catch (e) {
        return e instanceof BadImageError ? error('photo: could not read image', 400) : SAVE_FAIL();
      }
    }

    const ins = await db.from('lost_reports').insert({
      id: reportId,
      owner_id: me.id,
      raw_text: text,
      category: parsed.category,
      color: parsed.color,
      brand: parsed.brand,
      marks: parsed.marks,
      building_ids: ids,
      not_sure: notSure,
      landmarks,
      time_start: parsed.time_start,
      time_end: parsed.time_end,
      owner_photo_path,
      status: 'open',
    });
    if (ins.error) {
      if (owner_photo_path) await deletePhotos([owner_photo_path]);
      return SAVE_FAIL();
    }

    let matches: MatchWithItem[] = [];
    try {
      matches = await runMatchingForLostReport(reportId);
    } catch {
      console.warn('lost report matching failed');
    }

    return json({ reportId, parsed, matches });
  } catch {
    return FAIL();
  }
}
