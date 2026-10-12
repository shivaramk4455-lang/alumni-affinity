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
      call_signals: {
        Row: {
          call_id: string
          created_at: string
          id: number
          kind: string
          payload: Json | null
          sender_id: string
        }
        Insert: {
          call_id: string
          created_at?: string
          id?: never
          kind: string
          payload?: Json | null
          sender_id: string
        }
        Update: {
          call_id?: string
          created_at?: string
          id?: never
          kind?: string
          payload?: Json | null
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_signals_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_signals_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "my_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_signals_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      calls: {
        Row: {
          answered_at: string | null
          callee_id: string
          caller_id: string
          conversation_id: string
          decline_reason: string | null
          ended_at: string | null
          id: string
          started_at: string
          status: string
        }
        Insert: {
          answered_at?: string | null
          callee_id: string
          caller_id: string
          conversation_id: string
          decline_reason?: string | null
          ended_at?: string | null
          id?: string
          started_at?: string
          status?: string
        }
        Update: {
          answered_at?: string | null
          callee_id?: string
          caller_id?: string
          conversation_id?: string
          decline_reason?: string | null
          ended_at?: string | null
          id?: string
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "calls_callee_id_fkey"
            columns: ["callee_id"]
            isOneToOne: false
            referencedRelation: "my_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_callee_id_fkey"
            columns: ["callee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_caller_id_fkey"
            columns: ["caller_id"]
            isOneToOne: false
            referencedRelation: "my_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_caller_id_fkey"
            columns: ["caller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      consent_events: {
        Row: {
          granted: boolean
          id: string
          note: string | null
          policy_version: string
          purpose: string
          recorded_at: string
          user_id: string
        }
        Insert: {
          granted?: boolean
          id?: string
          note?: string | null
          policy_version: string
          purpose: string
          recorded_at?: string
          user_id: string
        }
        Update: {
          granted?: boolean
          id?: string
          note?: string | null
          policy_version?: string
          purpose?: string
          recorded_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "consent_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_reveals: {
        Row: {
          access_count: number
          first_revealed_at: string
          id: string
          last_revealed_at: string
          revealed_id: string
          viewer_id: string
        }
        Insert: {
          access_count?: number
          first_revealed_at?: string
          id?: string
          last_revealed_at?: string
          revealed_id: string
          viewer_id: string
        }
        Update: {
          access_count?: number
          first_revealed_at?: string
          id?: string
          last_revealed_at?: string
          revealed_id?: string
          viewer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_reveals_revealed_id_fkey"
            columns: ["revealed_id"]
            isOneToOne: false
            referencedRelation: "my_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_reveals_revealed_id_fkey"
            columns: ["revealed_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_reveals_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: false
            referencedRelation: "my_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_reveals_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
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
      deletion_receipts: {
        Row: {
          auth_deleted: boolean
          deleted_at: string
          id: string
          note: string | null
          policy_version: string
          purposes: string[]
          storage_objects_removed: number
          user_id: string
        }
        Insert: {
          auth_deleted?: boolean
          deleted_at?: string
          id?: string
          note?: string | null
          policy_version: string
          purposes?: string[]
          storage_objects_removed?: number
          user_id: string
        }
        Update: {
          auth_deleted?: boolean
          deleted_at?: string
          id?: string
          note?: string | null
          policy_version?: string
          purposes?: string[]
          storage_objects_removed?: number
          user_id?: string
        }
        Relationships: []
      }
      interests: {
        Row: {
          created_at: string
          decided_at: string | null
          expires_at: string
          id: string
          message: string | null
          recipient_id: string
          reminder_sent_at: string | null
          sender_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          expires_at?: string
          id?: string
          message?: string | null
          recipient_id: string
          reminder_sent_at?: string | null
          sender_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          expires_at?: string
          id?: string
          message?: string | null
          recipient_id?: string
          reminder_sent_at?: string | null
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
      member_activity: {
        Row: { enabled: boolean; last_active_at: string | null; updated_at: string; user_id: string }
        Insert: { enabled?: boolean; last_active_at?: string | null; updated_at?: string; user_id: string }
        Update: { enabled?: boolean; last_active_at?: string | null; updated_at?: string; user_id?: string }
        Relationships: [
          {
            foreignKeyName: "member_activity_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "my_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_activity_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_outbox: {
        Row: {
          attempts: number
          channel: string
          created_at: string
          id: string
          idempotency_key: string
          last_error: string | null
          payload: Json
          scheduled_for: string
          sent_at: string | null
          status: string
          template: string
          user_id: string
        }
        Insert: {
          attempts?: number
          channel: string
          created_at?: string
          id?: string
          idempotency_key: string
          last_error?: string | null
          payload?: Json
          scheduled_for?: string
          sent_at?: string | null
          status?: string
          template: string
          user_id: string
        }
        Update: {
          attempts?: number
          channel?: string
          created_at?: string
          id?: string
          idempotency_key?: string
          last_error?: string | null
          payload?: Json
          scheduled_for?: string
          sent_at?: string | null
          status?: string
          template?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_outbox_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_outbox_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          digest_skip_when_empty: boolean
          email_alerts: boolean
          email_digest: boolean
          sms_alerts: boolean
          updated_at: string
          user_id: string
          whatsapp_alerts: boolean
        }
        Insert: {
          digest_skip_when_empty?: boolean
          email_alerts?: boolean
          email_digest?: boolean
          sms_alerts?: boolean
          updated_at?: string
          user_id: string
          whatsapp_alerts?: boolean
        }
        Update: {
          digest_skip_when_empty?: boolean
          email_alerts?: boolean
          email_digest?: boolean
          sms_alerts?: boolean
          updated_at?: string
          user_id?: string
          whatsapp_alerts?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "my_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
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
      partner_preferences: {
        Row: {
          caste_preference: string | null
          cities: string[]
          created_at: string
          diets: string[]
          genders: string[]
          institutions: string[]
          marital_statuses: string[]
          max_age: number | null
          max_height_cm: number | null
          min_age: number | null
          min_height_cm: number | null
          religions: string[]
          relocations: string[]
          shield_employer: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          caste_preference?: string | null
          cities?: string[]
          created_at?: string
          diets?: string[]
          genders?: string[]
          institutions?: string[]
          marital_statuses?: string[]
          max_age?: number | null
          max_height_cm?: number | null
          min_age?: number | null
          min_height_cm?: number | null
          religions?: string[]
          relocations?: string[]
          shield_employer?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          caste_preference?: string | null
          cities?: string[]
          created_at?: string
          diets?: string[]
          genders?: string[]
          institutions?: string[]
          marital_statuses?: string[]
          max_age?: number | null
          max_height_cm?: number | null
          min_age?: number | null
          min_height_cm?: number | null
          religions?: string[]
          relocations?: string[]
          shield_employer?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "my_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      photo_view_requests: {
        Row: {
          created_at: string
          decided_at: string | null
          id: string
          owner_id: string
          requester_id: string
          status: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          id?: string
          owner_id: string
          requester_id: string
          status?: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          id?: string
          owner_id?: string
          requester_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "photo_view_requests_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "my_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photo_view_requests_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photo_view_requests_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "my_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photo_view_requests_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_dismissals: {
        Row: {
          created_at: string
          dismissed_id: string
          dismisser_id: string
          id: string
        }
        Insert: {
          created_at?: string
          dismissed_id: string
          dismisser_id: string
          id?: string
        }
        Update: {
          created_at?: string
          dismissed_id?: string
          dismisser_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_dismissals_dismissed_id_fkey"
            columns: ["dismissed_id"]
            isOneToOne: false
            referencedRelation: "my_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_dismissals_dismissed_id_fkey"
            columns: ["dismissed_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_dismissals_dismisser_id_fkey"
            columns: ["dismisser_id"]
            isOneToOne: false
            referencedRelation: "my_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_dismissals_dismisser_id_fkey"
            columns: ["dismisser_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_photos: {
        Row: {
          created_at: string
          id: string
          is_primary: boolean
          path: string
          position: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_primary?: boolean
          path: string
          position?: number
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_primary?: boolean
          path?: string
          position?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_photos_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_photos_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_views: {
        Row: {
          id: string
          viewed_at: string
          viewed_id: string
          viewer_id: string
        }
        Insert: {
          id?: string
          viewed_at?: string
          viewed_id: string
          viewer_id: string
        }
        Update: {
          id?: string
          viewed_at?: string
          viewed_id?: string
          viewer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_views_viewed_id_fkey"
            columns: ["viewed_id"]
            isOneToOne: false
            referencedRelation: "my_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_views_viewed_id_fkey"
            columns: ["viewed_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_views_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: false
            referencedRelation: "my_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_views_viewer_id_fkey"
            columns: ["viewer_id"]
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
          caste: string | null
          city: string | null
          contact_phone: string | null
          created_at: string
          created_by: string | null
          degree: string | null
          diet: string | null
          employer: string | null
          full_name: string
          gender: string | null
          gotra: string | null
          grad_year: number | null
          height_cm: number | null
          id: string
          institution: string | null
          is_admin: boolean
          is_visible: boolean
          linkedin_url: string | null
          marital_status: string | null
          mother_tongue: string | null
          onboarded: boolean
          paused_reason: string | null
          paused_until: string | null
          photo_path: string | null
          photo_visibility: string
          profession: string | null
          religion: string | null
          relocation: string | null
          residency_status: string | null
          show_profile_views: boolean
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
          caste?: string | null
          city?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          degree?: string | null
          diet?: string | null
          employer?: string | null
          full_name?: string
          gender?: string | null
          gotra?: string | null
          grad_year?: number | null
          height_cm?: number | null
          id: string
          institution?: string | null
          is_admin?: boolean
          is_visible?: boolean
          linkedin_url?: string | null
          marital_status?: string | null
          mother_tongue?: string | null
          onboarded?: boolean
          paused_reason?: string | null
          paused_until?: string | null
          photo_path?: string | null
          photo_visibility?: string
          profession?: string | null
          religion?: string | null
          relocation?: string | null
          residency_status?: string | null
          show_profile_views?: boolean
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
          caste?: string | null
          city?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          degree?: string | null
          diet?: string | null
          employer?: string | null
          full_name?: string
          gender?: string | null
          gotra?: string | null
          grad_year?: number | null
          height_cm?: number | null
          id?: string
          institution?: string | null
          is_admin?: boolean
          is_visible?: boolean
          linkedin_url?: string | null
          marital_status?: string | null
          mother_tongue?: string | null
          onboarded?: boolean
          paused_reason?: string | null
          paused_until?: string | null
          photo_path?: string | null
          photo_visibility?: string
          profession?: string | null
          religion?: string | null
          relocation?: string | null
          residency_status?: string | null
          show_profile_views?: boolean
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
          handled_at: string | null
          handled_by: string | null
          id: string
          outcome: string | null
          reason: string
          reported_profile_id: string
          reporter_id: string
          resolution_note: string | null
          status: string
        }
        Insert: {
          created_at?: string
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          outcome?: string | null
          reason: string
          reported_profile_id: string
          reporter_id: string
          resolution_note?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          outcome?: string | null
          reason?: string
          reported_profile_id?: string
          reporter_id?: string
          resolution_note?: string | null
          status?: string
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
      subscription_plans: {
        Row: {
          active: boolean
          amount_paise: number
          code: string
          currency: string
          display_order: number
          intro_requests: number | null
          label: string
          placement_weight: number
          razorpay_plan_id: string | null
          sellable: boolean
          service_note: string | null
        }
        Insert: {
          active?: boolean
          amount_paise: number
          code: string
          currency?: string
          display_order?: number
          intro_requests?: number | null
          label: string
          placement_weight?: number
          razorpay_plan_id?: string | null
          sellable?: boolean
          service_note?: string | null
        }
        Update: {
          active?: boolean
          amount_paise?: number
          code?: string
          currency?: string
          display_order?: number
          intro_requests?: number | null
          label?: string
          placement_weight?: number
          razorpay_plan_id?: string | null
          sellable?: boolean
          service_note?: string | null
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          id: string
          period_end: string | null
          period_start: string | null
          plan_code: string
          razorpay_order_id: string | null
          razorpay_subscription_id: string
          requests_used: number
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          id?: string
          period_end?: string | null
          period_start?: string | null
          plan_code: string
          razorpay_order_id?: string | null
          razorpay_subscription_id: string
          requests_used?: number
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          id?: string
          period_end?: string | null
          period_start?: string | null
          plan_code?: string
          razorpay_order_id?: string | null
          razorpay_subscription_id?: string
          requests_used?: number
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_plan_code_fkey"
            columns: ["plan_code"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_user_id_fkey"
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
          caste: string | null
          city: string | null
          contact_phone: string | null
          created_at: string | null
          created_by: string | null
          degree: string | null
          diet: string | null
          employer: string | null
          full_name: string | null
          gender: string | null
          gotra: string | null
          grad_year: number | null
          height_cm: number | null
          id: string | null
          institution: string | null
          is_admin: boolean | null
          is_visible: boolean | null
          linkedin_url: string | null
          marital_status: string | null
          mother_tongue: string | null
          onboarded: boolean | null
          paused_reason: string | null
          paused_until: string | null
          photo_path: string | null
          photo_visibility: string | null
          profession: string | null
          religion: string | null
          relocation: string | null
          residency_status: string | null
          show_profile_views: boolean | null
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
          caste?: string | null
          city?: string | null
          contact_phone?: string | null
          created_at?: string | null
          degree?: string | null
          diet?: string | null
          employer?: string | null
          full_name?: string | null
          gender?: string | null
          gotra?: string | null
          grad_year?: number | null
          height_cm?: number | null
          id?: string | null
          institution?: string | null
          is_admin?: boolean | null
          is_visible?: boolean | null
          linkedin_url?: string | null
          marital_status?: string | null
          mother_tongue?: string | null
          onboarded?: boolean | null
          paused_reason?: string | null
          paused_until?: string | null
          photo_path?: string | null
          photo_visibility?: string | null
          profession?: string | null
          religion?: string | null
          relocation?: string | null
          residency_status?: string | null
          show_profile_views?: boolean | null
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
          caste?: string | null
          city?: string | null
          contact_phone?: string | null
          created_at?: string | null
          degree?: string | null
          diet?: string | null
          employer?: string | null
          full_name?: string | null
          gender?: string | null
          gotra?: string | null
          grad_year?: number | null
          height_cm?: number | null
          id?: string | null
          institution?: string | null
          is_admin?: boolean | null
          is_visible?: boolean | null
          linkedin_url?: string | null
          marital_status?: string | null
          mother_tongue?: string | null
          onboarded?: boolean | null
          paused_reason?: string | null
          paused_until?: string | null
          photo_path?: string | null
          photo_visibility?: string | null
          profession?: string | null
          religion?: string | null
          relocation?: string | null
          residency_status?: string | null
          show_profile_views?: boolean | null
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
      can_send_introduction: { Args: { _user?: string }; Returns: boolean }
      claim_due_notifications: {
        Args: { _limit?: number }
        Returns: {
          attempts: number
          channel: string
          created_at: string
          id: string
          idempotency_key: string
          last_error: string | null
          payload: Json
          scheduled_for: string
          sent_at: string | null
          status: string
          template: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "notification_outbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      count_intro_usage: { Args: { _user: string }; Returns: number }
      desk_network_health: { Args: never; Returns: Json }
      desk_reports: {
        Args: { _limit?: number }
        Returns: {
          created_at: string
          handled_at: string
          id: string
          outcome: string
          reason: string
          reported_name: string
          reported_profile_id: string
          reported_visible: boolean
          reporter_id: string
          reporter_name: string
          resolution_note: string
          status: string
        }[]
      }
      desk_review_queue: {
        Args: { _limit?: number; _offset?: number }
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
      desk_update_report: {
        Args: {
          _id: string
          _note?: string
          _outcome?: string
          _status: string
        }
        Returns: undefined
      }
      enqueue_notification: {
        Args: {
          _idempotency_key?: string
          _payload?: Json
          _template: string
          _user: string
        }
        Returns: number
      }
      entitlement: {
        Args: { _user: string }
        Returns: {
          active: boolean
          intro_requests: number
          placement_weight: number
          plan_code: string
          requests_remaining: number
          requests_used: number
        }[]
      }
      expire_stale_interests: { Args: never; Returns: number }
      finish_notification: {
        Args: { _error?: string; _id: string; _ok: boolean }
        Returns: undefined
      }
      get_or_create_conversation: {
        Args: { _interest_id: string }
        Returns: string
      }
      get_profile_partner_preferences: {
        Args: { _profile: string }
        Returns: {
          caste_preference: string | null
          cities: string[]
          diets: string[]
          genders: string[]
          institutions: string[]
          marital_statuses: string[]
          max_age: number | null
          max_height_cm: number | null
          min_age: number | null
          min_height_cm: number | null
          relocations: string[]
          religions: string[]
        }[]
      }
      directory_match_signals: {
        Args: { _candidate_ids: string[] }
        Returns: {
          activity_bucket: string | null
          candidate_id: string
          matches_their_preferences: boolean
          matches_your_preferences: boolean
          mutual_match: boolean
        }[]
      }
      discover_members: {
        Args: {
          _city?: string | null
          _feed?: string
          _page?: number
          _page_size?: number
          _profession?: string | null
          _sort?: string
          _with_photo?: boolean
          _institution?: string | null
          _relocation?: string | null
          _gender?: string | null
          _diet?: string | null
          _marital_status?: string | null
          _residency?: string | null
          _mother_tongue?: string | null
          _religion?: string | null
          _min_height?: number | null
          _min_birth_year?: number | null
          _max_birth_year?: number | null
          _search?: string | null
        }
        Returns: {
          activity_bucket: string | null
          birth_year: number | null
          caste: string | null
          city: string | null
          created_at: string
          degree: string | null
          diet: string | null
          full_name: string
          gender: string | null
          gotra: string | null
          grad_year: number | null
          height_cm: number | null
          id: string
          institution: string | null
          matches_their_preferences: boolean
          matches_your_preferences: boolean
          marital_status: string | null
          mutual_match: boolean
          mother_tongue: string | null
          photo_path: string | null
          photo_visibility: string
          profession: string | null
          religion: string | null
          relocation: string | null
          residency_status: string | null
          total_count: number
        }[]
      }
      notification_channels_for: {
        Args: { _template: string; _user: string }
        Returns: string[]
      }
      notify_counterparty: {
        Args: { _event: string; _user: string }
        Returns: undefined
      }
      placement_weight: { Args: { _user: string }; Returns: number }
      reciprocity_multiplier: { Args: { _user: string }; Returns: number }
      record_consent: {
        Args: {
          _granted: boolean
          _note?: string
          _policy_version: string
          _purpose: string
        }
        Returns: string
      }
      record_intro_usage: { Args: { _user?: string }; Returns: undefined }
      record_member_activity: { Args: never; Returns: undefined }
      record_profile_view: { Args: { _viewed: string }; Returns: undefined }
      response_rate: { Args: { _user: string }; Returns: number }
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
      set_member_activity_tracking: {
        Args: { _enabled: boolean; _policy_version: string }
        Returns: undefined
      }
      sweep_stale_calls: { Args: never; Returns: number }
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
