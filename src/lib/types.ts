export type Role = 'FE' | 'BE' | 'FS' | 'QA';
export type Track = 'FE' | 'BE' | 'QA';
export type TicketKind = 'FE' | 'BE' | 'QA' | 'FS' | 'UNSET';
export type DeckId = 'fibonacci' | 'modified' | 'tshirt' | 'powers';
export type ThemeId = 'neptune' | 'mars' | 'jupiter' | 'saturn' | 'uranus';

export interface Team {
  id: string;
  name: string;
  owner_id: string;
  invite_code: string;
  deck: DeckId;
  theme: ThemeId;
  created_at: string;
}

export interface Member {
  id: string;
  team_id: string;
  user_id: string | null;
  display_name: string;
  roles: Role[];
  avatar: string;
  is_owner: boolean;
  is_facilitator: boolean;
  bubble_best: number;
  created_at: string;
}

export interface Session {
  id: string;
  team_id: string;
  name: string;
  status: 'active' | 'closed';
  current_ticket_id: string | null;
  current_round_id: string | null;
  created_at: string;
  closed_at: string | null;
}

export type Estimates = Partial<Record<Track, string>>;

export interface Ticket {
  id: string;
  team_id: string;
  session_id: string;
  title: string;
  url: string | null;
  kind: TicketKind;
  qa_needed: boolean;
  position: number;
  status: 'pending' | 'voting' | 'revealed' | 'estimated' | 'skipped';
  estimates: Estimates;
  created_at: string;
}

export interface Round {
  id: string;
  team_id: string;
  session_id: string;
  ticket_id: string;
  round_no: number;
  tracks: Track[];
  status: 'voting' | 'revealed' | 'cancelled';
  timer_ends_at: string | null;
  started_at: string;
  revealed_at: string | null;
}

export interface Vote {
  id: string;
  round_id: string;
  member_id: string;
  track: Track;
  value: string;
}

export interface VoteMark {
  round_id: string;
  member_id: string;
  track: Track;
}

export interface Guess {
  round_id: string;
  member_id: string;
  track: Track;
  value: number;
}

export type FunEvent =
  | { kind: 'poke'; from: string; to: string; nudge?: boolean }
  | { kind: 'throw'; from: string; to: string; item: string }
  | { kind: 'react'; from: string; emoji: string }
  | { kind: 'score'; from: string; score: number };

export type ConnStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';

export interface PresenceInfo {
  member_id: string;
  room: string | null;
}
