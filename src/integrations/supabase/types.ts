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
        Relationships: []
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
        Relationships: []
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
        Relationships: []
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
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
