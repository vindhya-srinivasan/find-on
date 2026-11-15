# Person 1 (frontend) handoff

Where the frontend stands, so a new Claude Code session can pick up without re-explaining. Read with `CLAUDE.md`, `docs/spec.md` and `docs/tasks.md`.

## How it runs
- Sample data by default (`lib/mock.ts`). No `.env.local` needed. Data is saved per browser in localStorage (`findon-mock`).
- `npm run build && npm run start`, then `ngrok http 3000` for phone testing. Dev mode over ngrok needs `allowedDevOrigins` in `next.config.ts`.
- Switches in `.env.local`:
  - `NEXT_PUBLIC_USE_MOCKS=false`: screens call the real `/api/*` routes (Person 2).
  - `NEXT_PUBLIC_REQUIRE_SIGNIN=true`: everyone must sign in. **Off for now** by decision.
  - `NEXT_PUBLIC_REAL_AUTH=true`: real Supabase email codes while data stays sample. Needs Supabase URL + anon key, and the Magic Link email template must include `{{ .Token }}` for a 6-digit code.

## Screens (all built, mobile-first)
| Route | What it does |
| --- | --- |
| `/` | Two full-height choices: I lost something (cardinal), I found something (gold). "Waiting on you" rows below. |
| `/found/new` | 4 steps: photo, where (auto location + landmark chips), check AI details (public vs kept private), DPS or keep it. Done screen shows item code + QR. |
| `/lost/new` | 2 steps. Step 1: location card at top (auto, change, add another, not sure) + three questions that adapt to the item + when chips. Step 2: optional photo. |
| `/lost/[id]` | Possible matches with match reason. "I found it myself" closes the report. |
| `/items/[id]` | Blurred listing, "This might be mine" starts a claim (needs a lost report). |
| `/claims/[id]` | One-page quiz (general questions with example hints), result, pickup code, finder chat, review view for finder/desk. |
| `/my` | Claims, lost reports, found items with pickup-code entry and switch to DPS. |
| `/desk` | Receive by item code, review claims, release with pickup code. Not linked; open directly. |
| `/notifications` | Alerts; opening it clears the red dot on the tab. |
| `/login` | @usc.edu email + 6-digit code. Sample code `123456`. |

## Design decisions (keep these)
- USC theme: cardinal `#990000`, gold `#FFCC00`. Gold is a fill only, never text on white. Wordmark: "Find" cardinal, "On" gold. Font: Outfit.
- Home = big-choice layout (direction C). Quiz = one-page layout (direction B). Canvas: https://claude.ai/artifact/VNzaCH2zAPgarNLobbhTVH
- Main screens: brand header (icon, wordmark, Demo pill). Inner screens: title bar with back (detail) or close (flows). Bottom nav (Home, My stuff, Alerts) hidden during flows.
- One primary action per screen, pinned at the bottom (`StickyAction`).
- Accessibility rules from the front-end checklist and Chrome modern web guidance: real `<label>` on every field, visible focus rings, 44px tap targets, native `<dialog>` for the building picker (Esc/back closes), `inputMode`/`enterKeyHint` on inputs, reduced motion, no autofocus, pinch zoom on.
- Verification questions are short and general; examples go in `hint`, never the item's real details.
- Lost-item questions by type (`QUESTIONS` + keyword `MATCHERS` in `app/(pages)/lost/new/page.tsx`): ID card, phone, laptop, earbuds, keys, wallet, generic.

## What the screens send that Person 2 must handle
- `POST /api/lost` is form-data: `text` (one sentence for the AI), `category`, `color`, `brand`, `marks`, `when`, `buildingIds`, `notSure`, `landmarks`, optional `photo`; plus `id_type`/`id_name` for IDs and `keychain`/`key_count` for keys.
- Extra routes the screens call: `GET /api/items` (recent listings), `POST /api/lost/[id]/close`.
- Response shapes the screens expect: see the "API response shapes" section of `types/index.ts`.

## Open items for Person 1
- [ ] Switch screens to real routes as Person 2 ships them (`NEXT_PUBLIC_USE_MOCKS=false`), starting with the finder flow.
- [ ] Bank/credit cards get their own lost-item questions (currently generic).
- [ ] "Who am I" route from Person 2 → show Desk tab only for desk staff.
- [ ] QR scanning at the desk (stretch).
- [ ] Demo prep with Person 4: seed scenario, screen recordings, screenshots.

## Working rules
- Only edit Person 1 files (`app/(pages)/`, `components/`, `lib/mock.ts`, `app/layout.tsx`, `app/globals.css`). Ask before touching shared files.
- No em dashes or filler in copy or comments.
- The user commits and pushes themselves with `git commit -m "title" -m "description"`. Don't commit or push.
