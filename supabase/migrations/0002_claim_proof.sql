-- Paste once into Supabase SQL Editor. Safe to re-run. Adds the owner's proof photo to a claim.
alter table claims add column if not exists proof_photo_path text;
-- PostgREST caches the schema; without this, writes to the new column fail with PGRST204 until it reloads.
notify pgrst, 'reload schema';
