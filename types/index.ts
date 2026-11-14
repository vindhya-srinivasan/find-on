// SHARED CONTRACT — edited only by Person 2, after the team agrees in chat.
// Copied from "FindOn — Team Tasks" > Shared contracts.

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
export interface Question { id: string; question: string; detail_indexes: number[]; }

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
