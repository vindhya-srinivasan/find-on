// SHARED CONTRACT: edited only by Person 2, after the team agrees in chat.
// Copied from "FindOn: Team Tasks" > Shared contracts.

export type Weight = 1 | 2 | 3; // low, medium, high
export type Verdict = 'match' | 'partial' | 'not_mentioned' | 'contradicts';
export type ItemStatus = 'en_route_to_desk' | 'at_desk' | 'with_finder' | 'returned' | 'unclaimed';
export type ClaimStatus = 'awaiting_answers' | 'likely_owner' | 'needs_review' | 'rejected' | 'approved' | 'returned';
export type ClaimFlag = 'filed_after_listing' | 'low_verifiability';
export type ReturnMethod = 'desk' | 'finder';
export type Role = 'student' | 'desk' | 'admin';

export interface Building {
  id: string; name: string; lat: number; lng: number;
  type: 'academic' | 'library' | 'residence' | 'dining' | 'outdoor' | 'transit' | 'desk';
}

export interface HiddenDetail { detail: string; weight: Weight; }

// Output of AI task 1
export interface PhotoAnalysis {
  is_valid_item: boolean; reject_reason: string | null;
  category: string; color: string; brand: string | null;
  public_title: string;            // category + color + building only
  hidden_details: HiddenDetail[];
  verifiability: 'high' | 'medium' | 'low';
  is_valuable: boolean;
}

// Output of AI task 2
export interface ParsedLostReport {
  category: string; color: string | null; brand: string | null;
  marks: string[]; time_start: string; time_end: string; // ISO
  summary: string;
}

// What any browser may see about a found item
export interface PublicFoundItem {
  id: string; item_code: string; public_title: string;
  category: string; color: string;
  found_building_id: string; found_date: string; // YYYY-MM-DD
  blurred_thumb_url: string;
  status: ItemStatus; return_method: ReturnMethod; held_at_desk_id: string | null;
}

export interface MatchResult { candidate_id: string; score: number; public_reason: string; }

// Sent to the browser: question text only, never the hidden details
export interface Question {
  id: string;
  question: string;          // short and general, e.g. "What makes it different from others like it?"
  hint?: string;             // examples shown under the answer box, e.g. "e.g. a sticker, a scratch, a name on it"
  detail_indexes: number[];
}

export interface DetailVerdict { detail_index: number; verdict: Verdict; }
export interface GradeResult { per_detail: DetailVerdict[]; reason: string; }

export interface ScoreResult {
  score: number;                   // 0–100, computed in code
  high_detail_matched: boolean;
  outcome: 'likely_owner' | 'needs_review' | 'rejected';
}

// ---- Database row shapes (server-only; used by Persons 2 and 3) ----

export interface FoundItemRow {
  id: string; finder_id: string; item_code: string;
  photo_paths: string[]; blurred_thumb_path: string;
  found_building_id: string; landmark: string | null; found_at: string; // ISO
  category: string; color: string; brand: string | null;
  public_title: string; hidden_details: HiddenDetail[];
  verifiability: 'high' | 'medium' | 'low'; is_valuable: boolean;
  return_method: ReturnMethod; held_at_desk_id: string | null;
  finder_availability: string | null;
  status: ItemStatus; created_at: string;
}

export interface LostReportRow {
  id: string; owner_id: string; raw_text: string;
  category: string; color: string | null; brand: string | null; marks: string[];
  building_ids: string[]; not_sure: boolean; landmarks: string[];
  time_start: string; time_end: string; owner_photo_path: string | null;
  status: 'open' | 'resolved' | 'closed'; created_at: string;
}

// ---- API response shapes the screens rely on (proposed by Person 1; Person 2 returns these) ----

export type Viewer = 'public' | 'finder' | 'desk' | 'claimant';

/** GET /api/items/:id: public fields always; the rest only for finder, desk staff or a verified claimant. */
export interface ItemDetail extends PublicFoundItem {
  viewer: Viewer;
  photo_urls?: string[];
  hidden_details?: HiddenDetail[];
  landmark?: string | null;
  finder_availability?: string | null;
  found_at?: string;
  pending_claims?: ClaimDetail[];         // finder of a finder-held item only: its needs_review claims
}

export interface MatchWithItem extends MatchResult { item: PublicFoundItem; }

export interface LostReportSummary {
  id: string; summary: string; category: string;
  status: 'open' | 'resolved' | 'closed'; created_at: string; match_count: number;
}

export interface ReturnDetails {
  method: ReturnMethod;
  desk_name?: string; desk_hours?: string;          // desk items
  finder_name?: string; finder_availability?: string | null; // finder-held items (first name + last initial)
}

/** GET /api/claims/:id: fields depend on who is looking. */
export interface ClaimDetail {
  id: string; status: ClaimStatus; viewer: 'claimant' | 'finder' | 'desk';
  item: PublicFoundItem;
  created_at: string;
  questions?: Question[];                 // claimant, while awaiting_answers
  pickup_code?: string;                   // claimant, after likely_owner / approved
  retry_after?: string | null;            // claimant, when rejected
  return_details?: ReturnDetails;         // claimant after passing; finder/desk always
  full_photo_urls?: string[];             // claimant after passing
  score?: number; reason?: string; flags?: ClaimFlag[];        // finder / desk reviewing
  answers?: { question: string; answer: string }[];          // finder / desk reviewing
  claimant_name?: string;                 // desk always; finder only after the claim passes (first name + last initial)
  proof_photo_url?: string; owner_photo_url?: string;        // finder / desk while needs_review; signed, 10 min
  hidden_details?: HiddenDetail[]; landmark?: string | null; found_at?: string; // claimant after passing
}

export interface ChatMessage { id: string; mine: boolean; sender_name: string; body: string; created_at: string; }

export interface MyItems {
  found: (PublicFoundItem & { pending_claims: ClaimDetail[] })[];
  lost: LostReportSummary[];
  claims: ClaimDetail[];
}

export interface NotificationItem { id: string; text: string; link: string; created_at: string; read: boolean; }

export interface DeskQueue {
  en_route: PublicFoundItem[]; at_desk: PublicFoundItem[]; reviews: ClaimDetail[];
  desk_id?: string | null; // caller's own desk (desk staff only)
}
