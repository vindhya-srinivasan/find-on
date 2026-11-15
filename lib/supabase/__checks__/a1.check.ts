// Run: $env:NODE_OPTIONS='--conditions=react-server'; npx tsx lib/supabase/__checks__/a1.check.ts; $code=$LASTEXITCODE; Remove-Item Env:NODE_OPTIONS; $code
import assert from 'node:assert/strict';
import sharp from 'sharp';
import type { z } from 'zod';
import type { FoundItemRow } from '../../../types';
import {
  blurThumbnail,
  canClaim,
  canFileLostReport,
  claimFlags,
  genericReason,
  isPrefiled,
  makeItemCode,
  makePickupCode,
  safePublicReason,
  safeQuestions,
  toPublicFoundItem,
} from '../../db';
import {
  AnswersBody,
  badRequest,
  ClaimBody,
  formFields,
  FoundAnalyzeForm,
  FoundForm,
  IdParam,
  ItemCodeParam,
  LostForm,
  MessageBody,
  ReturnBody,
  ReturnMethodBody,
  ReviewBody,
} from '../../api';

const DAY_MS = 24 * 60 * 60 * 1000;
const UUID = '11111111-1111-4111-8111-111111111111';

async function main() {
  // 1-2. Mapper
  const row: FoundItemRow = {
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    finder_id: 'ffffffff-0000-4000-8000-00000000f1d3',
    item_code: 'FO-4821',
    photo_paths: ['full/abc-1.jpg'],
    blurred_thumb_path: 'thumbs/abc.jpg',
    found_building_id: 'LVL',
    landmark: 'near the 2nd floor printers',
    found_at: '2026-11-15T07:30:00.000Z',
    category: 'water bottle',
    color: 'blue',
    brand: 'Zojirushi',
    public_title: 'Blue water bottle at LVL',
    hidden_details: [{ detail: 'Fight On sticker', weight: 3 }],
    verifiability: 'high',
    is_valuable: false,
    return_method: 'desk',
    held_at_desk_id: null,
    finder_availability: 'weekdays 10-4',
    status: 'en_route_to_desk',
    created_at: '2026-11-15T09:12:34.000Z',
  };
  const out = toPublicFoundItem(row, 'https://signed.example/t?token=x');
  assert.deepEqual(
    Object.keys(out).sort(),
    ['id', 'item_code', 'public_title', 'category', 'color', 'found_building_id', 'found_date', 'blurred_thumb_url', 'status', 'return_method', 'held_at_desk_id'].sort(),
  );
  const s = JSON.stringify(out);
  for (const leak of ['Zojirushi', 'near the 2nd floor printers', 'Fight On sticker', 'full/abc-1.jpg', 'thumbs/abc.jpg', row.finder_id, 'weekdays 10-4', row.found_at, row.created_at]) {
    assert.ok(!s.includes(leak), `mapper leaked ${leak}`);
  }
  for (const k of ['hidden_details', 'photo_paths', 'blurred_thumb_path', 'landmark', 'finder_id', 'brand', 'finder_availability', 'found_at']) {
    assert.ok(!(k in out), `mapper has key ${k}`);
  }
  assert.equal(out.found_date, '2026-11-14'); // 23:30 PST
  assert.equal(toPublicFoundItem({ ...row, found_at: '2026-11-15T08:30:00.000Z' }, '').found_date, '2026-11-15'); // 00:30 PST
  console.log('ok mapper');

  // 3. Codes
  for (let i = 0; i < 1000; i++) {
    assert.match(makeItemCode(), /^FO-[0-9]{4}$/);
    assert.match(makePickupCode(), /^[0-9]{6}$/);
  }
  console.log('ok codes');

  // 4. canClaim
  const now = new Date('2026-11-15T12:00:00.000Z');
  const ago = (h: number) => new Date(now.getTime() - h * 3600 * 1000).toISOString();
  const base: Parameters<typeof canClaim>[0] = {
    isFinder: false,
    lostReport: { status: 'open' },
    claimsLast24h: 0,
    priorAttempts: { count: 0, lastStatus: null, lastAt: null },
    itemStatus: 'at_desk',
    now,
  };
  const claim = (patch: Partial<typeof base>) => canClaim({ ...base, ...patch });
  const refused = (patch: Partial<typeof base>) => {
    const r = claim(patch);
    assert.ok(!r.ok, `expected refusal for ${JSON.stringify(patch)}`);
    return r;
  };
  const allowed = (patch: Partial<typeof base>) => {
    const r = claim(patch);
    assert.ok(r.ok, `expected ok for ${JSON.stringify(patch)}`);
    return r;
  };
  assert.equal(allowed({}).attemptNo, 1);
  assert.equal(refused({ isFinder: true }).status, 403);
  refused({ lostReport: null });
  refused({ lostReport: { status: 'closed' } });
  assert.equal(refused({ claimsLast24h: 3 }).status, 429);
  allowed({ claimsLast24h: 2 });
  refused({ itemStatus: 'returned' });
  const lastAt = ago(23);
  const early = refused({ priorAttempts: { count: 1, lastStatus: 'rejected', lastAt } });
  assert.equal(Date.parse(early.retryAt ?? ''), Date.parse(lastAt) + DAY_MS);
  assert.equal(allowed({ priorAttempts: { count: 1, lastStatus: 'rejected', lastAt: ago(25) } }).attemptNo, 2);
  const noDate = refused({ priorAttempts: { count: 1, lastStatus: 'rejected', lastAt: null } });
  assert.equal(noDate.status, 409);
  assert.equal(noDate.retryAt, undefined);
  refused({ priorAttempts: { count: 1, lastStatus: 'needs_review', lastAt: ago(48) } });
  refused({ priorAttempts: { count: 2, lastStatus: 'rejected', lastAt: ago(48) } });
  console.log('ok canClaim');

  // 5. canFileLostReport
  assert.ok(canFileLostReport(4).ok);
  assert.ok(!canFileLostReport(5).ok);
  console.log('ok canFileLostReport');

  // 6. claimFlags / isPrefiled
  const T0 = '2026-11-14T10:00:00.000Z';
  const T1 = '2026-11-14T11:00:00.000Z';
  assert.deepEqual(claimFlags({ created_at: T1, verifiability: 'high' }, { created_at: T0 }), []);
  assert.deepEqual(claimFlags({ created_at: T0, verifiability: 'high' }, { created_at: T1 }), ['filed_after_listing']);
  assert.deepEqual(claimFlags({ created_at: T1, verifiability: 'low' }, { created_at: T0 }), ['low_verifiability']);
  assert.deepEqual(claimFlags({ created_at: T0, verifiability: 'low' }, { created_at: T1 }), ['filed_after_listing', 'low_verifiability']);
  assert.equal(isPrefiled({ created_at: T0 }, { found_at: T1 }), true);
  assert.equal(isPrefiled({ created_at: T1 }, { found_at: T0 }), false);
  // Same instant, Postgres vs JS format: string compare says '.000Z' > '+00:00' and would wrongly flag.
  assert.deepEqual(claimFlags({ created_at: '2026-11-14T10:00:00+00:00', verifiability: 'high' }, { created_at: T0 }), []);
  // 02:00-08:00 is 10:00Z, after 09:59:59Z; string compare ('02' < '09') would say before.
  assert.equal(isPrefiled({ created_at: '2026-11-14T02:00:00-08:00' }, { found_at: '2026-11-14T09:59:59.000Z' }), false);
  assert.deepEqual(claimFlags({ created_at: '2026-11-14T09:59:59.000Z', verifiability: 'high' }, { created_at: '2026-11-14T02:00:00-08:00' }), ['filed_after_listing']);
  console.log('ok claimFlags/isPrefiled');

  // 7. Schemas
  const good = (schema: z.ZodType, input: unknown) => {
    const r = schema.safeParse(input);
    assert.ok(r.success, `expected valid: ${r.error?.issues[0]?.message}`);
  };
  const bad = async (schema: z.ZodType, input: unknown, leak?: string) => {
    const r = schema.safeParse(input);
    assert.ok(!r.success, `expected invalid: ${JSON.stringify(input)}`);
    const res = badRequest(r.error);
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: unknown };
    assert.equal(typeof body.error, 'string');
    if (leak) assert.ok(!(body.error as string).includes(leak), `error echoed ${leak}`);
  };
  const jpg = () => new File([new Uint8Array(10)], 'a.jpg', { type: 'image/jpeg' });
  const form = (fields: Record<string, string>, photos: File[]) => {
    const fd = new FormData();
    for (const p of photos) fd.append('photos', p);
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    return formFields(fd);
  };
  const analysis = {
    is_valid_item: true, reject_reason: null, category: 'water bottle', color: 'blue', brand: null,
    public_title: 'Blue water bottle', hidden_details: [{ detail: 'Fight On sticker', weight: 3 }],
    verifiability: 'high', is_valuable: false,
  };
  const foundFields = { buildingId: 'LVL', landmark: 'lobby', foundAt: '2026-11-14T10:00:00-08:00', analysis: JSON.stringify(analysis), returnMethod: 'desk', availability: 'mornings' };

  good(IdParam, { id: UUID });
  await bad(IdParam, { id: 'not-a-uuid-xyz' }, 'not-a-uuid-xyz');
  good(ItemCodeParam, { id: 'FO-4821' });
  await bad(ItemCodeParam, { id: 'FO-12' }, 'FO-12');
  good(FoundAnalyzeForm, form({ buildingId: 'LVL', landmark: 'lobby' }, [jpg()]));
  await bad(FoundAnalyzeForm, form({ buildingId: 'LVL' }, [jpg(), jpg(), jpg(), jpg()]));
  await bad(FoundAnalyzeForm, form({ buildingId: 'LVL' }, [new File(['hi'], 'a.txt', { type: 'text/plain' })]));
  for (const heic of [new File(['x'], 'IMG_1.HEIC', { type: 'image/heic' }), new File(['x'], 'IMG_2.heif', { type: '' })]) {
    const r = FoundAnalyzeForm.safeParse(form({ buildingId: 'LVL' }, [heic]));
    assert.ok(!r.success && r.error.issues[0].message === "HEIC photos aren't supported; use JPEG or PNG.", `HEIC not rejected clearly: ${heic.name}`);
  }
  good(FoundForm, form(foundFields, [jpg()]));
  await bad(FoundForm, form({ ...foundFields, analysis: 'not-json{{' }, [jpg()]), 'not-json{{');
  await bad(FoundForm, form({ ...foundFields, analysis: JSON.stringify({ ...analysis, hidden_details: [{ detail: 'x', weight: 4 }] }) }, [jpg()]));
  const lostFields = { text: 'grey bottle', buildingIds: '["LVL"]', notSure: 'false', landmarks: '[]' };
  assert.deepEqual(LostForm.parse(form(lostFields, [])), { text: 'grey bottle', buildingIds: ['LVL'], notSure: false, landmarks: [] });
  const lostFd = new FormData();
  for (const [k, v] of Object.entries(lostFields)) lostFd.append(k, v);
  lostFd.append('photo', jpg());
  assert.ok(LostForm.parse(formFields(lostFd)).photo instanceof File);
  await bad(LostForm, form({ ...lostFields, buildingIds: '[]' }, []));
  good(LostForm, form({ ...lostFields, buildingIds: '[]', notSure: 'true' }, []));
  await bad(LostForm, form({ ...lostFields, buildingIds: '["LVL"' }, []), '["LVL"');
  good(ClaimBody, { foundItemId: UUID, lostReportId: UUID });
  await bad(ClaimBody, { foundItemId: UUID });
  good(AnswersBody, { answers: [{ question_id: 'q1', answer: 'a sticker' }] });
  await bad(AnswersBody, { answers: [] });
  good(ReviewBody, { decision: 'approve' });
  await bad(ReviewBody, { decision: 'maybe-xyz' }, 'maybe-xyz');
  good(ReturnBody, { pickupCode: '012345' });
  await bad(ReturnBody, { pickupCode: '12345' }, '12345');
  good(ReturnMethodBody, { returnMethod: 'desk' });
  await bad(ReturnMethodBody, { returnMethod: 'finder' });
  good(MessageBody, { body: 'hi' });
  await bad(MessageBody, { body: '   ' });
  console.log('ok schemas');

  // 8. blurThumbnail
  const input = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#888', noise: { type: 'gaussian', mean: 128, sigma: 60 } } }).png().toBuffer();
  const thumb = await blurThumbnail(input);
  assert.deepEqual([...thumb.subarray(0, 3)], [0xff, 0xd8, 0xff]);
  assert.equal((await sharp(thumb).metadata()).width, 320);
  assert.ok(thumb.length < input.length);
  console.log('ok blurThumbnail');

  // 9. safePublicReason: match reasons must not leak hidden details or brand
  const bn = 'Leavey Library';
  const generic = genericReason(row, bn);
  assert.equal(safePublicReason('Blue bottle with a sticker on it', row, bn), generic);
  assert.equal(safePublicReason('  Blue water bottle found at Leavey Library  ', row, bn), 'Blue water bottle found at Leavey Library');
  assert.equal(safePublicReason('Blue bottle with a sticker', { ...row, public_title: 'Blue sticker bottle at LVL' }, bn), 'Blue bottle with a sticker');
  assert.equal(safePublicReason('Looks like a Zojirushi bottle', row, bn), generic);
  assert.equal(safePublicReason('Looks like an HP bottle', { ...row, brand: 'HP' }, bn), generic);
  assert.equal(safePublicReason('Blue bottle with stickers', row, bn), generic);
  const engraved = { ...row, hidden_details: [{ detail: 'engraving on the lid', weight: 3 as const }] };
  assert.equal(safePublicReason('Blue bottle, engraved', engraved, bn), genericReason(engraved, bn));
  console.log('ok safePublicReason');

  // 10. safeQuestions: brand is banned by stem, like leaksHidden (plural / joined forms too)
  const q = (question: string, item = row) => safeQuestions([{ question, hint: '', detail_indexes: [0] }], item);
  assert.ok(q('Describe any markings on the outside.'), 'safe question rejected');
  assert.equal(q('What do your Zojirushis look like?'), null);
  assert.equal(q('Describe the hydroflask.', { ...row, brand: 'Hydro Flask' }), null);
  assert.equal(q('Is it an HP?', { ...row, brand: 'HP' }), null);
  console.log('ok safeQuestions');

  console.log('A1 checks passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
