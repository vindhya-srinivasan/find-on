// Person 2: save a found item, then run matching. Contract: Team Tasks > API routes.
import { FoundForm, badRequest, error, formFields, json } from '@/lib/api';
import { makeItemCode, runMatchingForFoundItem, toPublicFoundItem } from '@/lib/db';
import { requireUser } from '@/lib/supabase/auth';
import { supabaseAdmin } from '@/lib/supabase/server';
import { BadImageError, deletePhotos, savePhotos, signedUrl } from '@/lib/supabase/storage';
import type { FoundItemRow } from '@/types';

const FAIL = () => error('Something went wrong. Try again.', 500);
const SAVE_FAIL = () => error('Could not save the item. Try again.', 500);
const FUTURE_SLACK_MS = 5 * 60 * 1000;

export async function POST(req: Request) {
  try {
    const me = await requireUser(req, { write: true });
    if (me instanceof Response) return me;

    let fd: FormData;
    try {
      fd = await req.formData();
    } catch {
      return error('Invalid form data', 400);
    }
    const parsed = FoundForm.safeParse(formFields(fd));
    if (!parsed.success) return badRequest(parsed.error);
    const { photos, buildingId, landmark, foundAt, analysis, returnMethod, availability } = parsed.data;

    if (Date.parse(foundAt) > Date.now() + FUTURE_SLACK_MS) return error('foundAt: cannot be in the future', 400);
    if (analysis.is_valid_item === false) return error("This photo can't be posted.", 400);

    const db = supabaseAdmin();
    const b = await db.from('buildings').select('name').eq('id', buildingId).maybeSingle();
    if (b.error) return FAIL();
    if (!b.data) return error('buildingId: unknown building', 400);

    // Privacy fields are rebuilt server-side; client public_title / verifiability are not trusted.
    const { category, color, brand, hidden_details, is_valuable } = analysis;
    const public_title = `${color.charAt(0).toUpperCase()}${color.slice(1)} ${category} · ${b.data.name}`;
    const verifiability =
      hidden_details.length < 2 || !hidden_details.some((d) => d.weight === 3) ? 'low' : analysis.verifiability;

    // Desk staff posting a desk item are already holding it (spec edge case).
    const deskHeld = me.role === 'desk' && returnMethod === 'desk' && !!me.desk_id;
    let held_at_desk_id: string | null = deskHeld ? me.desk_id : null;
    if (returnMethod === 'desk' && !deskHeld) {
      const desk = await db.from('desks').select('id').ilike('name', '%dps%').order('id').limit(1).maybeSingle();
      if (desk.error) return FAIL();
      held_at_desk_id = desk.data?.id ?? null;
    }

    const id = crypto.randomUUID();
    let saved: Awaited<ReturnType<typeof savePhotos>>;
    try {
      saved = await savePhotos(id, photos);
    } catch (e) {
      return e instanceof BadImageError ? error('photos: could not read image', 400) : SAVE_FAIL();
    }

    const fields = {
      id,
      finder_id: me.id,
      photo_paths: saved.photo_paths,
      blurred_thumb_path: saved.blurred_thumb_path,
      found_building_id: buildingId,
      landmark: landmark || null,
      found_at: foundAt,
      category,
      color,
      brand,
      public_title,
      hidden_details,
      verifiability,
      is_valuable,
      return_method: returnMethod,
      held_at_desk_id,
      finder_availability: returnMethod === 'desk' ? null : availability || null,
      status: deskHeld ? 'at_desk' : returnMethod === 'desk' ? 'en_route_to_desk' : 'with_finder',
    };

    let row: FoundItemRow | null = null;
    // shortcut: 10k codes + 5 retries is fine for the demo, widen the code space if items grow past a few thousand
    for (let attempt = 0; attempt < 5 && !row; attempt++) {
      const ins = await db.from('found_items').insert({ ...fields, item_code: makeItemCode() }).select().single();
      if (!ins.error) row = ins.data as FoundItemRow;
      else if (ins.error.code !== '23505') break;
    }
    if (!row) {
      await deletePhotos([...saved.photo_paths, saved.blurred_thumb_path]);
      return SAVE_FAIL();
    }

    try {
      await runMatchingForFoundItem(id);
    } catch {
      // matching never fails the post
    }

    return json({ item: toPublicFoundItem(row, await signedUrl(row.blurred_thumb_path, 3600)) });
  } catch {
    return FAIL();
  }
}
