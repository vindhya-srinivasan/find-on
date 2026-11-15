// Person 2: analyze a found-item photo (calls analyzePhoto). Contract: Team Tasks > API routes.
import { analyzePhoto } from '@/lib/ai';
import { FoundAnalyzeForm, badRequest, error, formFields, json } from '@/lib/api';
import { requireUser } from '@/lib/supabase/auth';
import { supabaseAdmin } from '@/lib/supabase/server';
import { BadImageError, forClaude } from '@/lib/supabase/storage';

const FAIL = () => error('Something went wrong. Try again.', 500);

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
    const parsed = FoundAnalyzeForm.safeParse(formFields(fd));
    if (!parsed.success) return badRequest(parsed.error);
    const { photos, buildingId, landmark } = parsed.data;

    const b = await supabaseAdmin().from('buildings').select('name').eq('id', buildingId).maybeSingle();
    if (b.error) return FAIL();
    if (!b.data) return error('buildingId: unknown building', 400);

    let images: Awaited<ReturnType<typeof forClaude>>[];
    try {
      images = await Promise.all(photos.map(forClaude));
    } catch (e) {
      if (e instanceof BadImageError) return error('photos: could not read image', 400);
      throw e;
    }

    try {
      // Landmark is untrusted finder text; it goes in as a data field only.
      return json(await analyzePhoto({ images, buildingName: b.data.name, landmark: landmark || undefined }));
    } catch {
      return error('ai_unavailable', 503);
    }
  } catch {
    return FAIL();
  }
}
