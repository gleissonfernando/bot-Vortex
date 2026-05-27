export type Member = {
  id: string;
  guild_id: string;
  discord_user_id: string;
  username: string;
  display_name: string;
  avatar_url?: string | null;
  highest_role_name?: string | null;
  status: 'active' | 'inactive';
  last_seen_at?: string | null;
  total_seconds?: number;
  session_count?: number;
  last_point_at?: string | null;
  absence_count?: number;
};

export type AttendanceSession = {
  id: string;
  opened_at: string;
  closed_at?: string | null;
  total_seconds: number;
  source: string;
  opened_by?: string | null;
  closed_by?: string | null;
};

export type FrequencyDay = {
  date_key: string;
  points: number;
  sessions?: number;
  total_seconds: number;
};

export type AbsenceRecord = {
  id: string;
  guild_id: string;
  discord_user_id: string;
  member_id?: string | null;
  member_name: string;
  username?: string | null;
  avatar_url?: string | null;
  status: string;
  reason?: string | null;
  starts_at?: string | null;
  started_at?: string | null;
  ends_at?: string | null;
  created_at?: string | null;
  approved_at?: string | null;
  approved_by_id?: string | null;
  approved_by_name?: string | null;
  rejected_at?: string | null;
  rejected_by_id?: string | null;
  rejected_by_name?: string | null;
  removed_at?: string | null;
  removed_by_id?: string | null;
  removed_by_name?: string | null;
  finished_at?: string | null;
  decided_at?: string | null;
  decided_by_id?: string | null;
  decided_by_name?: string | null;
  period_days: number;
};
