# FindOn — USC's AI-powered lost & found

Campus-wide lost and found: finders snap a photo, owners describe what they lost, Claude matches them, and owners prove ownership with hidden-detail questions before any handover.

Built for AI@USC 2026 (HackSC x USC AI Committee).

## Setup
```bash
git clone <repo-url> && cd findon
npm install
cp .env.example .env.local   # fill in keys (ask Person 2)
npm run dev                   # http://localhost:3000
```

## Team workflow
- Read `CLAUDE.md` first. Each person owns specific folders; only edit yours.
- One branch per person: `p1-frontend`, `p2-backend`, `p3-ai`, `p4-data`. Pull `main` before each task; merge at checkpoints.
- Shared files (`types/index.ts`, `package.json`, `.env.example`) change only through Person 2.
- Never commit `.env.local` or API keys.

## What's in the skeleton
- `types/index.ts` — shared data shapes (the contract everyone codes against)
- `app/api/**` — every API route from the contract, returning 501 until built
- `app/(pages)/**` — every screen as a placeholder
- `lib/ai/` — AI function stubs with the final signatures (return sample data)
- `lib/location.ts` — working distance / nearest-building helpers
- `lib/mock.ts` — sample data for the frontend while routes are stubbed
- `lib/supabase/` — browser, server and admin clients

## Stack
Next.js 16 · React 19 · TypeScript · Tailwind 4 · Supabase · Anthropic Claude (`claude-sonnet-5-5`) · sharp · zod
