export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      conversations: {
        Row: {
          created_at: string
          id: string
          interest_id: string
          last_message_at: string | null
          participant_a: string
          participant_b: string
        }
        Insert: {
          created_at?: string
          id?: string
          interest_id: string
          last_message_at?: string | null
          participant_a: string
          participant_b: string
        }
        Update: {
          created_at?: string
          id?: string
          interest_id?: string
          last_message_at?: string | null
          participant_a?: string
          participant_b?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_interest_id_fkey"
            columns: ["interest_id"]
            isOneToOne: true
            referencedRelation: "interests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_participant_a_fkey"
            columns: ["participant_a"]
            isOneToOne: false
            referencedRelation: "my_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_participant_a_fkey"
            columns: ["participant_a"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_participant_b_fkey"
            columns: ["participant_b"]
            isOneToOne: false
            referencedRelation: "my_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_participant_b_fkey"
            columns: ["participant_b"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      copilot_recommendations: {
        Row: {
          candidate_id: string
          copilot_id: string
          created_at: string
          family_note: string | null
          id: string
          recommended_profile_id: string
          updated_at: string
        }
        Insert: {
          candidate_id: string
          copilot_id: string
          created_at?: string
          family_note?: string | null
          id?: string
          recommended_profile_id: string
          updated_at?: string
        }
        Update: {
          candidate_id?: string
          copilot_id?: string
          created_at?: string
          family_note?: string | null
          id?: string
          recommended_profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "copilot_rec_candidate_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "my_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copilot_rec_candidate_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copilot_rec_profile_fkey"
            columns: ["recommended_profile_id"]
            isOneToOne: false
            referencedRelation: "my_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copilot_rec_profile_fkey"
            columns: ["recommended_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copilot_recommendations_copilot_id_fkey"
            columns: ["copilot_id"]
            isOneToOne: false
            referencedRelation: "copilots"
            referencedColumns: ["id"]
          },
        ]
      }
      copilots: {
        Row: {
          candidate_id: string
          copilot_email: string
          copilot_name: string | null
          copilot_user_id: string | null
          created_at: string
          id: string
          invite_code: string
          relation: string | null
          status: string
          updated_at: string
        }
        Insert: {
          candidate_id: string
          copilot_email: string
          copilot_name?: string | null
          copilot_user_id?: string | null
          created_at?: string
          id?: string
          invite_code?: string
          relation?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          candidate_id?: string
          copilot_email?: string
          copilot_name?: string | null
          copilot_user_id?: string | null
          created_at?: string
          id?: string
          invite_code?: string
          relation?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "copilots_candidate_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "my_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copilots_candidate_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copilots_user_fkey"
            columns: ["copilot_user_id"]
            isOneToOne: false
            referencedRelation: "my_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copilots_user_fkey"
            columns: ["copilot_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      interests: {
        Row: {
          created_at: string
          id: string
          message: string | null
          recipient_id: string
          sender_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          message?: string | null
          recipient_id: string
          sender_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string | null
          recipient_id?: string
          sender_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "interests_recipient_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "my_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interests_recipient_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interests_sender_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "my_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interests_sender_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          conversation_id: string
          created_at: string
          id: string
          read_at: string | null
          sender_id: string
        }
        Insert: {
          body: string
          conversation_id: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_id: string
        }
        Update: {
          body?: string
          conversation_id?: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "my_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          kind: string
          link: string | null
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          kind: string
          link?: string | null
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          kind?: string
          link?: string | null
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          alumni_email: string | null
          alumni_email_verified: boolean
          bio: string | null
          birth_year: number | null
          city: string | null
          contact_phone: string | null
          created_at: string
          degree: string | null
          employer: string | null
          full_name: string
          gender: string | null
          grad_year: number | null
          id: string
          institution: string | null
          is_admin: boolean
          is_visible: boolean
          linkedin_url: string | null
          onboarded: boolean
          photo_path: string | null
          photo_visibility: string
          profession: string | null
          relocation: string | null
          updated_at: string
          values_statement: string | null
          verification_decided_at: string | null
          verification_decided_by: string | null
          verification_doc_path: string | null
          verification_note: string | null
          verification_status: string
        }
        Insert: {
          alumni_email?: string | null
          alumni_email_verified?: boolean
          bio?: string | null
          birth_year?: number | null
          city?: string | null
          contact_phone?: string | null
          created_at?: string
          degree?: string | null
          employer?: string | null
          full_name?: string
          gender?: string | null
          grad_year?: number | null
          id: string
          institution?: string | null
          is_admin?: boolean
          is_visible?: boolean
          linkedin_url?: string | null
          onboarded?: boolean
          photo_path?: string | null
          photo_visibility?: string
          profession?: string | null
          relocation?: string | null
          updated_at?: string
          values_statement?: string | null
          verification_decided_at?: string | null
          verification_decided_by?: string | null
          verification_doc_path?: string | null
          verification_note?: string | null
          verification_status?: string
        }
        Update: {
          alumni_email?: string | null
          alumni_email_verified?: boolean
          bio?: string | null
          birth_year?: number | null
          city?: string | null
          contact_phone?: string | null
          created_at?: string
          degree?: string | null
          employer?: string | null
          full_name?: string
          gender?: string | null
          grad_year?: number | null
          id?: string
          institution?: string | null
          is_admin?: boolean
          is_visible?: boolean
          linkedin_url?: string | null
          onboarded?: boolean
          photo_path?: string | null
          photo_visibility?: string
          profession?: string | null
          relocation?: string | null
          updated_at?: string
          values_statement?: string | null
          verification_decided_at?: string | null
          verification_decided_by?: string | null
          verification_doc_path?: string | null
          verification_note?: string | null
          verification_status?: string
        }
        Relationships: []
      }
      reports: {
        Row: {
          created_at: string
          id: string
          reason: string
          reported_profile_id: string
          reporter_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          reason: string
          reported_profile_id: string
          reporter_id: string
        }
        Update: {
          created_at?: string
          id?: string
          reason?: string
          reported_profile_id?: string
          reporter_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_reported_fkey"
            columns: ["reported_profile_id"]
            isOneToOne: false
            referencedRelation: "my_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_reported_fkey"
            columns: ["reported_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_reporter_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "my_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_reporter_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_profiles: {
        Row: {
          created_at: string
          profile_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          profile_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          profile_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_profiles_profile_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "my_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_profiles_profile_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_profiles_user_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_profiles_user_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      my_profile: {
        Row: {
          alumni_email: string | null
          alumni_email_verified: boolean | null
          bio: string | null
          birth_year: number | null
          city: string | null
          contact_phone: string | null
          created_at: string | null
          degree: string | null
          employer: string | null
          full_name: string | null
          gender: string | null
          grad_year: number | null
          id: string | null
          institution: string | null
          is_admin: boolean | null
          is_visible: boolean | null
          linkedin_url: string | null
          onboarded: boolean | null
          photo_path: string | null
          photo_visibility: string | null
          profession: string | null
          relocation: string | null
          updated_at: string | null
          values_statement: string | null
          verification_decided_at: string | null
          verification_decided_by: string | null
          verification_doc_path: string | null
          verification_note: string | null
          verification_status: string | null
        }
        Insert: {
          alumni_email?: string | null
          alumni_email_verified?: boolean | null
          bio?: string | null
          birth_year?: number | null
          city?: string | null
          contact_phone?: string | null
          created_at?: string | null
          degree?: string | null
          employer?: string | null
          full_name?: string | null
          gender?: string | null
          grad_year?: number | null
          id?: string | null
          institution?: string | null
          is_admin?: boolean | null
          is_visible?: boolean | null
          linkedin_url?: string | null
          onboarded?: boolean | null
          photo_path?: string | null
          photo_visibility?: string | null
          profession?: string | null
          relocation?: string | null
          updated_at?: string | null
          values_statement?: string | null
          verification_decided_at?: string | null
          verification_decided_by?: string | null
          verification_doc_path?: string | null
          verification_note?: string | null
          verification_status?: string | null
        }
        Update: {
          alumni_email?: string | null
          alumni_email_verified?: boolean | null
          bio?: string | null
          birth_year?: number | null
          city?: string | null
          contact_phone?: string | null
          created_at?: string | null
          degree?: string | null
          employer?: string | null
          full_name?: string | null
          gender?: string | null
          grad_year?: number | null
          id?: string | null
          institution?: string | null
          is_admin?: boolean | null
          is_visible?: boolean | null
          linkedin_url?: string | null
          onboarded?: boolean | null
          photo_path?: string | null
          photo_visibility?: string | null
          profession?: string | null
          relocation?: string | null
          updated_at?: string | null
          values_statement?: string | null
          verification_decided_at?: string | null
          verification_decided_by?: string | null
          verification_doc_path?: string | null
          verification_note?: string | null
          verification_status?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      accept_copilot_invite: { Args: { _code: string }; Returns: string }
      desk_reports: {
        Args: { _limit?: number }
        Returns: {
          created_at: string
          id: string
          reason: string
          reported_name: string
          reported_profile_id: string
          reported_visible: boolean
          reporter_id: string
          reporter_name: string
        }[]
      }
      desk_review_queue: {
        Args: never
        Returns: {
          alumni_email: string
          city: string
          created_at: string
          degree: string
          full_name: string
          grad_year: number
          id: string
          institution: string
          photo_path: string
          verification_doc_path: string
          verification_status: string
        }[]
      }
      get_or_create_conversation: {
        Args: { _interest_id: string }
        Returns: string
      }
      reveal_contact: {
        Args: { _profile: string }
        Returns: {
          contact_phone: string
          linkedin_url: string
          profile_id: string
        }[]
      }
      reveal_contacts: {
        Args: { _profiles: string[] }
        Returns: {
          contact_phone: string
          linkedin_url: string
          profile_id: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
