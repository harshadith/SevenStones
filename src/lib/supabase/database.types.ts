export type Team = "seekers" | "guardians";
export type RoomStatus = "waiting" | "playing" | "finished";
export type GamePhase =
  | "waiting"
  | "throwing"
  | "broken"
  | "rebuild"
  | "seekers_win"
  | "guardians_win";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string;
          created_at: string;
        };
        Insert: {
          id: string;
          display_name: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          display_name?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      rooms: {
        Row: {
          id: string;
          name: string;
          invite_code_hash: string;
          passphrase_salt: string;
          passphrase_hash: string;
          host_id: string;
          status: RoomStatus;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          invite_code_hash: string;
          passphrase_salt: string;
          passphrase_hash: string;
          host_id: string;
          status?: RoomStatus;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          invite_code_hash?: string;
          passphrase_salt?: string;
          passphrase_hash?: string;
          host_id?: string;
          status?: RoomStatus;
          created_at?: string;
        };
        Relationships: [];
      };
      room_members: {
        Row: {
          room_id: string;
          user_id: string;
          team: Team;
          joined_at: string;
        };
        Insert: {
          room_id: string;
          user_id: string;
          team: Team;
          joined_at?: string;
        };
        Update: {
          room_id?: string;
          user_id?: string;
          team?: Team;
          joined_at?: string;
        };
        Relationships: [];
      };
      game_states: {
        Row: {
          room_id: string;
          phase: GamePhase;
          stack_height: number;
          seekers_score: number;
          guardians_score: number;
          thrower_id: string | null;
          tagged_seekers: string[];
          last_hash: string;
          action_seq: number;
          updated_at: string;
        };
        Insert: {
          room_id: string;
          phase?: GamePhase;
          stack_height?: number;
          seekers_score?: number;
          guardians_score?: number;
          thrower_id?: string | null;
          tagged_seekers?: string[];
          last_hash?: string;
          action_seq?: number;
          updated_at?: string;
        };
        Update: {
          room_id?: string;
          phase?: GamePhase;
          stack_height?: number;
          seekers_score?: number;
          guardians_score?: number;
          thrower_id?: string | null;
          tagged_seekers?: string[];
          last_hash?: string;
          action_seq?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      game_actions: {
        Row: {
          id: string;
          room_id: string;
          seq: number;
          actor_id: string;
          action_type: string;
          payload: Json;
          prev_hash: string;
          action_hash: string;
          nonce: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          room_id: string;
          seq: number;
          actor_id: string;
          action_type: string;
          payload?: Json;
          prev_hash: string;
          action_hash: string;
          nonce: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          room_id?: string;
          seq?: number;
          actor_id?: string;
          action_type?: string;
          payload?: Json;
          prev_hash?: string;
          action_hash?: string;
          nonce?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      chat_messages: {
        Row: {
          id: string;
          room_id: string;
          sender_id: string;
          ciphertext: string;
          iv: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          room_id: string;
          sender_id: string;
          ciphertext: string;
          iv: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          room_id?: string;
          sender_id?: string;
          ciphertext?: string;
          iv?: string;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      create_room_secure: {
        Args: {
          p_name: string;
          p_invite_code_hash: string;
          p_passphrase_salt: string;
          p_passphrase_hash: string;
          p_host_team: Team;
        };
        Returns: string;
      };
      join_room_secure: {
        Args: {
          p_invite_code_hash: string;
          p_passphrase_hash: string;
          p_team: Team;
        };
        Returns: string;
      };
      submit_game_action: {
        Args: {
          p_room_id: string;
          p_action_type: string;
          p_payload: Json;
          p_prev_hash: string;
          p_action_hash: string;
          p_nonce: string;
          p_seq: number;
        };
        Returns: Json;
      };
      get_room_salt_by_invite: {
        Args: {
          p_invite_code_hash: string;
        };
        Returns: string;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Room = Database["public"]["Tables"]["rooms"]["Row"];
export type RoomMember = Database["public"]["Tables"]["room_members"]["Row"];
export type GameState = Database["public"]["Tables"]["game_states"]["Row"];
export type GameAction = Database["public"]["Tables"]["game_actions"]["Row"];
export type ChatMessage = Database["public"]["Tables"]["chat_messages"]["Row"];
