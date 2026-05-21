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
