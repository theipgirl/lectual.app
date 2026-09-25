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
      assessment_intent: {
        Row: {
          assessment_id: string
          created_at: string
          email: string
          id: string
          price_shown_cents: number
        }
        Insert: {
          assessment_id: string
          created_at?: string
          email: string
          id?: string
          price_shown_cents: number
        }
        Update: {
          assessment_id?: string
          created_at?: string
          email?: string
          id?: string
          price_shown_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "assessment_intent_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "crm_assessment"
            referencedColumns: ["id"]
          },
        ]
      }
      concierge_consent: {
        Row: {
          created_at: string
          founder_id: string
          id: string
          opted_in: boolean
          opted_in_at: string | null
          opted_out_at: string | null
          source: string | null
        }
        Insert: {
          created_at?: string
          founder_id: string
          id?: string
          opted_in?: boolean
          opted_in_at?: string | null
          opted_out_at?: string | null
          source?: string | null
        }
        Update: {
          created_at?: string
          founder_id?: string
          id?: string
          opted_in?: boolean
          opted_in_at?: string | null
          opted_out_at?: string | null
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "concierge_consent_founder_id_fkey"
            columns: ["founder_id"]
            isOneToOne: true
            referencedRelation: "founder"
            referencedColumns: ["id"]
          },
        ]
      }
      concierge_message: {
        Row: {
          body: string | null
          created_at: string
          direction: string
          id: string
          media_url: string | null
          thread_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          direction: string
          id?: string
          media_url?: string | null
          thread_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          direction?: string
          id?: string
          media_url?: string | null
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "concierge_message_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "concierge_thread"
            referencedColumns: ["id"]
          },
        ]
      }
      concierge_thread: {
        Row: {
          channel: string
          created_at: string
          e164: string | null
          founder_id: string
          id: string
        }
        Insert: {
          channel: string
          created_at?: string
          e164?: string | null
          founder_id: string
          id?: string
        }
        Update: {
          channel?: string
          created_at?: string
          e164?: string | null
          founder_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "concierge_thread_founder_id_fkey"
            columns: ["founder_id"]
            isOneToOne: false
            referencedRelation: "founder"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_activity: {
        Row: {
          actor_id: string | null
          actor_type: Database["public"]["Enums"]["crm_actor_type"]
          created_at: string
          id: string
          lead_id: string | null
          matter_id: string | null
          org_id: string
          payload: Json
          type: Database["public"]["Enums"]["crm_activity_type"]
        }
        Insert: {
          actor_id?: string | null
          actor_type: Database["public"]["Enums"]["crm_actor_type"]
          created_at?: string
          id?: string
          lead_id?: string | null
          matter_id?: string | null
          org_id: string
          payload?: Json
          type: Database["public"]["Enums"]["crm_activity_type"]
        }
        Update: {
          actor_id?: string | null
          actor_type?: Database["public"]["Enums"]["crm_actor_type"]
          created_at?: string
          id?: string
          lead_id?: string | null
          matter_id?: string | null
          org_id?: string
          payload?: Json
          type?: Database["public"]["Enums"]["crm_activity_type"]
        }
        Relationships: [
          {
            foreignKeyName: "crm_activity_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_lead"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activity_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "crm_matter"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activity_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "crm_org"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_ai_enrichment: {
        Row: {
          cost_usd: number
          created_at: string
          id: string
          input_hash: string
          layer: Database["public"]["Enums"]["crm_ai_enrichment_layer"]
          lead_id: string
          model: string
          org_id: string
          output: Json
          prompt_version: string
          type: Database["public"]["Enums"]["crm_ai_enrichment_type"]
        }
        Insert: {
          cost_usd?: number
          created_at?: string
          id?: string
          input_hash: string
          layer: Database["public"]["Enums"]["crm_ai_enrichment_layer"]
          lead_id: string
          model: string
          org_id: string
          output?: Json
          prompt_version: string
          type: Database["public"]["Enums"]["crm_ai_enrichment_type"]
        }
        Update: {
          cost_usd?: number
          created_at?: string
          id?: string
          input_hash?: string
          layer?: Database["public"]["Enums"]["crm_ai_enrichment_layer"]
          lead_id?: string
          model?: string
          org_id?: string
          output?: Json
          prompt_version?: string
          type?: Database["public"]["Enums"]["crm_ai_enrichment_type"]
        }
        Relationships: [
          {
            foreignKeyName: "crm_ai_enrichment_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_lead"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_ai_enrichment_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "crm_org"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_assessment: {
        Row: {
          answers: Json
          created_at: string
          email: string | null
          id: string
          ip_type: string | null
          name: string | null
          phone: string | null
          readiness: string | null
          readiness_score: number | null
          risk_flags: string[]
          routed_attorney_id: string | null
          source_slug: string | null
          urgency: string | null
        }
        Insert: {
          answers?: Json
          created_at?: string
          email?: string | null
          id?: string
          ip_type?: string | null
          name?: string | null
          phone?: string | null
          readiness?: string | null
          readiness_score?: number | null
          risk_flags?: string[]
          routed_attorney_id?: string | null
          source_slug?: string | null
          urgency?: string | null
        }
        Update: {
          answers?: Json
          created_at?: string
          email?: string | null
          id?: string
          ip_type?: string | null
          name?: string | null
          phone?: string | null
          readiness?: string | null
          readiness_score?: number | null
          risk_flags?: string[]
          routed_attorney_id?: string | null
          source_slug?: string | null
          urgency?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_assessment_routed_attorney_id_fkey"
            columns: ["routed_attorney_id"]
            isOneToOne: false
            referencedRelation: "crm_attorney"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_attorney: {
        Row: {
          booking_url: string
          brand_on_primary_hex: string
          brand_primary_hex: string
          created_at: string
          display_name: string
          firm_name: string
          handles_premium: boolean
          id: string
          slug: string
        }
        Insert: {
          booking_url: string
          brand_on_primary_hex?: string
          brand_primary_hex?: string
          created_at?: string
          display_name: string
          firm_name: string
          handles_premium?: boolean
          id?: string
          slug: string
        }
        Update: {
          booking_url?: string
          brand_on_primary_hex?: string
          brand_primary_hex?: string
          created_at?: string
          display_name?: string
          firm_name?: string
          handles_premium?: boolean
          id?: string
          slug?: string
        }
        Relationships: []
      }
      crm_automation_rule: {
        Row: {
          actions: Json
          active: boolean
          conditions: Json
          created_at: string
          created_by: string | null
          description: string
          dry_run: boolean
          id: string
          name: string
          org_id: string
          trigger_config: Json
          trigger_type: Database["public"]["Enums"]["crm_automation_trigger"]
          updated_at: string
        }
        Insert: {
          actions?: Json
          active?: boolean
          conditions?: Json
          created_at?: string
          created_by?: string | null
          description?: string
          dry_run?: boolean
          id?: string
          name: string
          org_id: string
          trigger_config?: Json
          trigger_type: Database["public"]["Enums"]["crm_automation_trigger"]
          updated_at?: string
        }
        Update: {
          actions?: Json
          active?: boolean
          conditions?: Json
          created_at?: string
          created_by?: string | null
          description?: string
          dry_run?: boolean
          id?: string
          name?: string
          org_id?: string
          trigger_config?: Json
          trigger_type?: Database["public"]["Enums"]["crm_automation_trigger"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_automation_rule_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "crm_org"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_automation_run: {
        Row: {
          actions_taken: Json
          created_at: string
          dry_run: boolean
          id: string
          lead_id: string | null
          matched: boolean
          note: string | null
          org_id: string
          rule_id: string | null
          trigger_type: Database["public"]["Enums"]["crm_automation_trigger"]
        }
        Insert: {
          actions_taken?: Json
          created_at?: string
          dry_run?: boolean
          id?: string
          lead_id?: string | null
          matched?: boolean
          note?: string | null
          org_id: string
          rule_id?: string | null
          trigger_type: Database["public"]["Enums"]["crm_automation_trigger"]
        }
        Update: {
          actions_taken?: Json
          created_at?: string
          dry_run?: boolean
          id?: string
          lead_id?: string | null
          matched?: boolean
          note?: string | null
          org_id?: string
          rule_id?: string | null
          trigger_type?: Database["public"]["Enums"]["crm_automation_trigger"]
        }
        Relationships: [
          {
            foreignKeyName: "crm_automation_run_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_lead"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_automation_run_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "crm_org"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_automation_run_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "crm_automation_rule"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_claim_library: {
        Row: {
          claim: string
          context: string
          created_at: string
          created_by: string | null
          id: string
          notes: string
          org_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          source: string | null
          status: Database["public"]["Enums"]["crm_claim_status"]
          updated_at: string
        }
        Insert: {
          claim: string
          context?: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string
          org_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          source?: string | null
          status?: Database["public"]["Enums"]["crm_claim_status"]
          updated_at?: string
        }
        Update: {
          claim?: string
          context?: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string
          org_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          source?: string | null
          status?: Database["public"]["Enums"]["crm_claim_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_claim_library_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "crm_org"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_claim_review_log: {
        Row: {
          claim_id: string
          id: string
          notes: string
          org_id: string
          reviewed_at: string
          reviewed_by: string | null
          status: Database["public"]["Enums"]["crm_claim_status"]
        }
        Insert: {
          claim_id: string
          id?: string
          notes?: string
          org_id: string
          reviewed_at?: string
          reviewed_by?: string | null
          status: Database["public"]["Enums"]["crm_claim_status"]
        }
        Update: {
          claim_id?: string
          id?: string
          notes?: string
          org_id?: string
          reviewed_at?: string
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["crm_claim_status"]
        }
        Relationships: [
          {
            foreignKeyName: "crm_claim_review_log_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "crm_claim_library"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_claim_review_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "crm_org"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_connected_account: {
        Row: {
          category: string
          composio_connection_id: string | null
          config: Json
          created_at: string
          id: string
          org_id: string
          provider: string
          status: string
          webhook_secret: string | null
        }
        Insert: {
          category: string
          composio_connection_id?: string | null
          config?: Json
          created_at?: string
          id?: string
          org_id: string
          provider: string
          status?: string
          webhook_secret?: string | null
        }
        Update: {
          category?: string
          composio_connection_id?: string | null
          config?: Json
          created_at?: string
          id?: string
          org_id?: string
          provider?: string
          status?: string
          webhook_secret?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_connected_account_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "crm_org"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_consult_note: {
        Row: {
          assessment_id: string | null
          class_count: number
          classes: Json
          created_at: string
          id: string
          lead_id: string | null
          notes: Json
          org_id: string
          qualification_tier: string | null
          raw_transcript_ref: string | null
          recommended_package_id: string | null
          transcript_source: string | null
        }
        Insert: {
          assessment_id?: string | null
          class_count?: number
          classes?: Json
          created_at?: string
          id?: string
          lead_id?: string | null
          notes?: Json
          org_id: string
          qualification_tier?: string | null
          raw_transcript_ref?: string | null
          recommended_package_id?: string | null
          transcript_source?: string | null
        }
        Update: {
          assessment_id?: string | null
          class_count?: number
          classes?: Json
          created_at?: string
          id?: string
          lead_id?: string | null
          notes?: Json
          org_id?: string
          qualification_tier?: string | null
          raw_transcript_ref?: string | null
          recommended_package_id?: string | null
          transcript_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_consult_note_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "crm_assessment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_consult_note_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "crm_org"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_consult_note_recommended_package_id_fkey"
            columns: ["recommended_package_id"]
            isOneToOne: false
            referencedRelation: "crm_package"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_discovery_session: {
        Row: {
          ai_summary: string | null
          audio_url: string | null
          consultation_form: Json
          ended_at: string | null
          extracted_marks: Json | null
          id: string
          lead_id: string
          org_id: string
          outcome: Database["public"]["Enums"]["crm_discovery_outcome"]
          phase_answers: Json
          runner_id: string | null
          started_at: string
          transcript: string | null
        }
        Insert: {
          ai_summary?: string | null
          audio_url?: string | null
          consultation_form?: Json
          ended_at?: string | null
          extracted_marks?: Json | null
          id?: string
          lead_id: string
          org_id: string
          outcome?: Database["public"]["Enums"]["crm_discovery_outcome"]
          phase_answers?: Json
          runner_id?: string | null
          started_at?: string
          transcript?: string | null
        }
        Update: {
          ai_summary?: string | null
          audio_url?: string | null
          consultation_form?: Json
          ended_at?: string | null
          extracted_marks?: Json | null
          id?: string
          lead_id?: string
          org_id?: string
          outcome?: Database["public"]["Enums"]["crm_discovery_outcome"]
          phase_answers?: Json
          runner_id?: string | null
          started_at?: string
          transcript?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_discovery_session_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_lead"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_discovery_session_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "crm_org"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_drip_enrollment: {
        Row: {
          completed_at: string | null
          current_step: number
          enrolled_at: string
          id: string
          lead_id: string
          next_step_at: string | null
          org_id: string
          sequence_id: string
          status: Database["public"]["Enums"]["crm_drip_enrollment_status"]
        }
        Insert: {
          completed_at?: string | null
          current_step?: number
          enrolled_at?: string
          id?: string
          lead_id: string
          next_step_at?: string | null
          org_id: string
          sequence_id: string
          status?: Database["public"]["Enums"]["crm_drip_enrollment_status"]
        }
        Update: {
          completed_at?: string | null
          current_step?: number
          enrolled_at?: string
          id?: string
          lead_id?: string
          next_step_at?: string | null
          org_id?: string
          sequence_id?: string
          status?: Database["public"]["Enums"]["crm_drip_enrollment_status"]
        }
        Relationships: [
          {
            foreignKeyName: "crm_drip_enrollment_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_lead"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_drip_enrollment_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "crm_org"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_drip_enrollment_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "crm_drip_sequence"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_drip_sequence: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          description: string
          id: string
          name: string
          org_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          name: string
          org_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          name?: string
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_drip_sequence_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "crm_org"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_drip_step: {
        Row: {
          config: Json
          delay_hours: number
          id: string
          order_index: number
          org_id: string
          sequence_id: string
          template_id: string | null
          type: Database["public"]["Enums"]["crm_drip_step_type"]
        }
        Insert: {
          config?: Json
          delay_hours?: number
          id?: string
          order_index: number
          org_id: string
          sequence_id: string
          template_id?: string | null
          type: Database["public"]["Enums"]["crm_drip_step_type"]
        }
        Update: {
          config?: Json
          delay_hours?: number
          id?: string
          order_index?: number
          org_id?: string
          sequence_id?: string
          template_id?: string | null
          type?: Database["public"]["Enums"]["crm_drip_step_type"]
        }
        Relationships: [
          {
            foreignKeyName: "crm_drip_step_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "crm_org"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_drip_step_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "crm_drip_sequence"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_drip_step_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "crm_email_template"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_email_template: {
        Row: {
          body_html: string
          body_text: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          org_id: string
          subject: string
          updated_at: string
          variables: Json
        }
        Insert: {
          body_html: string
          body_text?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          org_id: string
          subject: string
          updated_at?: string
          variables?: Json
        }
        Update: {
          body_html?: string
          body_text?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          org_id?: string
          subject?: string
          updated_at?: string
          variables?: Json
        }
        Relationships: [
          {
            foreignKeyName: "crm_email_template_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "crm_org"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_firm_brain_entry: {
        Row: {
          body: string
          category: Database["public"]["Enums"]["crm_brain_category"]
          created_at: string
          created_by: string | null
          data: Json | null
          id: string
          key: string
          org_id: string
          title: string
          updated_at: string
        }
        Insert: {
          body?: string
          category?: Database["public"]["Enums"]["crm_brain_category"]
          created_at?: string
          created_by?: string | null
          data?: Json | null
          id?: string
          key: string
          org_id: string
          title: string
          updated_at?: string
        }
        Update: {
          body?: string
          category?: Database["public"]["Enums"]["crm_brain_category"]
          created_at?: string
          created_by?: string | null
          data?: Json | null
          id?: string
          key?: string
          org_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_firm_brain_entry_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "crm_org"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_firm_settings: {
        Row: {
          org_id: string
          post_consult_autodraft_legal: boolean
          post_consult_autosend_email: boolean
          updated_at: string
        }
        Insert: {
          org_id: string
          post_consult_autodraft_legal?: boolean
          post_consult_autosend_email?: boolean
          updated_at?: string
        }
        Update: {
          org_id?: string
          post_consult_autodraft_legal?: boolean
          post_consult_autosend_email?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_firm_settings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "crm_org"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_lead: {
        Row: {
          ai_enriched_at: string | null
          ai_red_flags: string[]
          ai_summary: string | null
          assigned_to: string | null
          business_name: string | null
          created_at: string
          current_stage_id: string
          email: string
          first_name: string
          founder_id: string | null
          id: string
          last_activity_at: string | null
          // last_inbound_at / last_outbound_at / mark_text / nurture_* /
          // practice_area / referral_* / sheet_key / temperature*:
          // hand-added to mirror supabase/migrations/0055_intake_dashboard.sql
          // until the next `generate_typescript_types` run folds them in —
          // same convention 0049 used for crm_matter.lawmatics_id.
          last_inbound_at: string | null
          last_name: string
          last_outbound_at: string | null
          lawmatics_id: string | null
          lawmatics_synced_at: string | null
          mark_text: string | null
          nurture_campaign: string | null
          nurture_last_sent_at: string | null
          org_id: string
          phone: string | null
          practice_area: string | null
          qualification_score: number | null
          referral_detail: string | null
          referral_source: string | null
          sheet_key: string | null
          stage_entered_at: string
          temperature: Database["public"]["Enums"]["crm_lead_temperature"] | null
          temperature_set_at: string | null
          temperature_set_by: string | null
          updated_at: string
          urgency_band: Database["public"]["Enums"]["crm_urgency_band"]
          value_band: Database["public"]["Enums"]["crm_value_band"]
          website: string | null
        }
        Insert: {
          ai_enriched_at?: string | null
          ai_red_flags?: string[]
          ai_summary?: string | null
          assigned_to?: string | null
          business_name?: string | null
          created_at?: string
          current_stage_id: string
          email: string
          first_name: string
          founder_id?: string | null
          id?: string
          last_activity_at?: string | null
          last_inbound_at?: string | null
          last_name: string
          last_outbound_at?: string | null
          lawmatics_id?: string | null
          lawmatics_synced_at?: string | null
          mark_text?: string | null
          nurture_campaign?: string | null
          nurture_last_sent_at?: string | null
          org_id: string
          phone?: string | null
          practice_area?: string | null
          qualification_score?: number | null
          referral_detail?: string | null
          referral_source?: string | null
          sheet_key?: string | null
          stage_entered_at?: string
          temperature?: Database["public"]["Enums"]["crm_lead_temperature"] | null
          temperature_set_at?: string | null
          temperature_set_by?: string | null
          updated_at?: string
          urgency_band?: Database["public"]["Enums"]["crm_urgency_band"]
          value_band?: Database["public"]["Enums"]["crm_value_band"]
          website?: string | null
        }
        Update: {
          ai_enriched_at?: string | null
          ai_red_flags?: string[]
          ai_summary?: string | null
          assigned_to?: string | null
          business_name?: string | null
          created_at?: string
          current_stage_id?: string
          email?: string
          first_name?: string
          founder_id?: string | null
          id?: string
          last_activity_at?: string | null
          last_inbound_at?: string | null
          last_name?: string
          last_outbound_at?: string | null
          lawmatics_id?: string | null
          lawmatics_synced_at?: string | null
          mark_text?: string | null
          nurture_campaign?: string | null
          nurture_last_sent_at?: string | null
          org_id?: string
          phone?: string | null
          practice_area?: string | null
          qualification_score?: number | null
          referral_detail?: string | null
          referral_source?: string | null
          sheet_key?: string | null
          stage_entered_at?: string
          temperature?: Database["public"]["Enums"]["crm_lead_temperature"] | null
          temperature_set_at?: string | null
          temperature_set_by?: string | null
          updated_at?: string
          urgency_band?: Database["public"]["Enums"]["crm_urgency_band"]
          value_band?: Database["public"]["Enums"]["crm_value_band"]
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_lead_current_stage_id_fkey"
            columns: ["current_stage_id"]
            isOneToOne: false
            referencedRelation: "crm_stage"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_lead_founder_id_fkey"
            columns: ["founder_id"]
            isOneToOne: false
            referencedRelation: "founder"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_lead_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "crm_org"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_lead_tag: {
        Row: {
          applied_at: string
          applied_by: string | null
          confidence: number | null
          lead_id: string
          needs_review: boolean
          org_id: string
          source: Database["public"]["Enums"]["crm_tag_source"]
          tag_id: string
        }
        Insert: {
          applied_at?: string
          applied_by?: string | null
          confidence?: number | null
          lead_id: string
          needs_review?: boolean
          org_id: string
          source: Database["public"]["Enums"]["crm_tag_source"]
          tag_id: string
        }
        Update: {
          applied_at?: string
          applied_by?: string | null
          confidence?: number | null
          lead_id?: string
          needs_review?: boolean
          org_id?: string
          source?: Database["public"]["Enums"]["crm_tag_source"]
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_lead_tag_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_lead"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_lead_tag_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "crm_org"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_lead_tag_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "crm_tag"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_litigation_detail: {
        Row: {
          case_number: string | null
          case_status: string | null
          case_style: string | null
          county: string | null
          court_division: string | null
          created_at: string
          default_status: string | null
          filed_on: string | null
          judge: string | null
          matter_id: string
          missed_hearing: string | null
          motion_to_dismiss: string | null
          next_hearing_at: string | null
          next_hearing_purpose: string | null
          notes: string | null
          notice_of_appearance: string | null
          org_id: string
          role: string | null
          updated_at: string
        }
        Insert: {
          case_number?: string | null
          case_status?: string | null
          case_style?: string | null
          county?: string | null
          court_division?: string | null
          created_at?: string
          default_status?: string | null
          filed_on?: string | null
          judge?: string | null
          matter_id: string
          missed_hearing?: string | null
          motion_to_dismiss?: string | null
          next_hearing_at?: string | null
          next_hearing_purpose?: string | null
          notes?: string | null
          notice_of_appearance?: string | null
          org_id: string
          role?: string | null
          updated_at?: string
        }
        Update: {
          case_number?: string | null
          case_status?: string | null
          case_style?: string | null
          county?: string | null
          court_division?: string | null
          created_at?: string
          default_status?: string | null
          filed_on?: string | null
          judge?: string | null
          matter_id?: string
          missed_hearing?: string | null
          motion_to_dismiss?: string | null
          next_hearing_at?: string | null
          next_hearing_purpose?: string | null
          notes?: string | null
          notice_of_appearance?: string | null
          org_id?: string
          role?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_litigation_detail_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: true
            referencedRelation: "crm_matter"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_litigation_detail_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "crm_org"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_matter: {
        Row: {
          assigned_to: string | null
          created_at: string
          examining_attorney: string | null
          filing_basis: Database["public"]["Enums"]["crm_filing_basis"] | null
          filing_date: string | null
          goods_services: string | null
          id: string
          international_classes: number[] | null
          // lawmatics_id / lawmatics_synced_at / notes / referral_source:
          // hand-added to mirror supabase/migrations/0049_matter_lawmatics_fields.sql
          // until the next `generate_typescript_types` run folds them in —
          // same convention 0044/0047 used for assigned_to and the document
          // center tables.
          lawmatics_id: string | null
          lawmatics_synced_at: string | null
          lead_id: string | null
          mark_text: string | null
          matter_number: string
          notes: string | null
          opened_at: string
          org_id: string
          owner_name: string | null
          package_name: string | null
          practice_pipeline: string | null
          referral_source: string | null
          registration_date: string | null
          registration_number: string | null
          serial_number: string | null
          stage_entered_at: string | null
          stage_id: string | null
          status: string
          title: string | null
          type: Database["public"]["Enums"]["crm_matter_type"]
          updated_at: string
          uspto_status: string | null
          uspto_status_as_of: string | null
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          examining_attorney?: string | null
          filing_basis?: Database["public"]["Enums"]["crm_filing_basis"] | null
          filing_date?: string | null
          goods_services?: string | null
          id?: string
          international_classes?: number[] | null
          lawmatics_id?: string | null
          lawmatics_synced_at?: string | null
          lead_id?: string | null
          mark_text?: string | null
          matter_number: string
          notes?: string | null
          opened_at?: string
          org_id: string
          owner_name?: string | null
          package_name?: string | null
          practice_pipeline?: string | null
          referral_source?: string | null
          registration_date?: string | null
          registration_number?: string | null
          serial_number?: string | null
          stage_entered_at?: string | null
          stage_id?: string | null
          status?: string
          title?: string | null
          type: Database["public"]["Enums"]["crm_matter_type"]
          updated_at?: string
          uspto_status?: string | null
          uspto_status_as_of?: string | null
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          examining_attorney?: string | null
          filing_basis?: Database["public"]["Enums"]["crm_filing_basis"] | null
          filing_date?: string | null
          goods_services?: string | null
          id?: string
          international_classes?: number[] | null
          lawmatics_id?: string | null
          lawmatics_synced_at?: string | null
          lead_id?: string | null
          mark_text?: string | null
          matter_number?: string
          notes?: string | null
          opened_at?: string
          org_id?: string
          owner_name?: string | null
          package_name?: string | null
          practice_pipeline?: string | null
          referral_source?: string | null
          registration_date?: string | null
          registration_number?: string | null
          serial_number?: string | null
          stage_entered_at?: string | null
          stage_id?: string | null
          status?: string
          title?: string | null
          type?: Database["public"]["Enums"]["crm_matter_type"]
          updated_at?: string
          uspto_status?: string | null
          uspto_status_as_of?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_matter_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_lead"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_matter_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "crm_org"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_matter_stage_fk"
            columns: ["stage_id", "org_id"]
            isOneToOne: false
            referencedRelation: "crm_matter_stage"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      // crm_document_draft: supabase/migrations/0045_document_center.sql.
      // Hand-added (not yet run through `generate_typescript_types`, per this
      // session's decision not to apply that migration to the live dev/prod
      // projects from an agent worktree — see the Document Center build
      // report). Shaped to match exactly what codegen would produce; replace
      // this block with the generated one on the next real codegen run and
      // this comment goes away with it.
      crm_document_draft: {
        Row: {
          created_at: string
          created_by: string | null
          doc_type: string
          error_message: string | null
          file_name: string | null
          generated_at: string | null
          id: string
          matter_id: string
          org_id: string
          payload: Json
          queue_item_id: string | null
          status: string
          storage_path: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          doc_type: string
          error_message?: string | null
          file_name?: string | null
          generated_at?: string | null
          id?: string
          matter_id: string
          org_id: string
          payload?: Json
          queue_item_id?: string | null
          status?: string
          storage_path?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          doc_type?: string
          error_message?: string | null
          file_name?: string | null
          generated_at?: string | null
          id?: string
          matter_id?: string
          org_id?: string
          payload?: Json
          queue_item_id?: string | null
          status?: string
          storage_path?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_document_draft_matter_fk"
            columns: ["matter_id", "org_id"]
            isOneToOne: false
            referencedRelation: "crm_matter"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "crm_document_draft_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "crm_org"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_matter_deadline: {
        Row: {
          anchor_date: string | null
          anchor_event: string | null
          attorney_confirmed: boolean
          calculation_basis: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          created_by: string | null
          due_date: string
          extensions_used: number
          id: string
          is_extendable: boolean
          kind: Database["public"]["Enums"]["crm_deadline_kind"]
          matter_id: string
          max_extensions: number | null
          notes: string | null
          org_id: string
          satisfied_at: string | null
          source: Database["public"]["Enums"]["crm_deadline_source"]
          status: Database["public"]["Enums"]["crm_deadline_status"]
          title: string | null
          updated_at: string
        }
        Insert: {
          anchor_date?: string | null
          anchor_event?: string | null
          attorney_confirmed?: boolean
          calculation_basis?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          due_date: string
          extensions_used?: number
          id?: string
          is_extendable?: boolean
          kind: Database["public"]["Enums"]["crm_deadline_kind"]
          matter_id: string
          max_extensions?: number | null
          notes?: string | null
          org_id: string
          satisfied_at?: string | null
          source?: Database["public"]["Enums"]["crm_deadline_source"]
          status?: Database["public"]["Enums"]["crm_deadline_status"]
          title?: string | null
          updated_at?: string
        }
        Update: {
          anchor_date?: string | null
          anchor_event?: string | null
          attorney_confirmed?: boolean
          calculation_basis?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          due_date?: string
          extensions_used?: number
          id?: string
          is_extendable?: boolean
          kind?: Database["public"]["Enums"]["crm_deadline_kind"]
          matter_id?: string
          max_extensions?: number | null
          notes?: string | null
          org_id?: string
          satisfied_at?: string | null
          source?: Database["public"]["Enums"]["crm_deadline_source"]
          status?: Database["public"]["Enums"]["crm_deadline_status"]
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_matter_deadline_matter_fk"
            columns: ["matter_id", "org_id"]
            isOneToOne: false
            referencedRelation: "crm_matter"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "crm_matter_deadline_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "crm_org"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_matter_stage: {
        Row: {
          code: string
          created_at: string
          id: string
          is_open: boolean
          label: string
          order_index: number
          org_id: string
          updated_at: string
          waiting_on: Database["public"]["Enums"]["crm_matter_waiting_on"]
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_open?: boolean
          label: string
          order_index: number
          org_id: string
          updated_at?: string
          waiting_on?: Database["public"]["Enums"]["crm_matter_waiting_on"]
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_open?: boolean
          label?: string
          order_index?: number
          org_id?: string
          updated_at?: string
          waiting_on?: Database["public"]["Enums"]["crm_matter_waiting_on"]
        }
        Relationships: [
          {
            foreignKeyName: "crm_matter_stage_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "crm_org"
            referencedColumns: ["id"]
          },
        ]
      }
      // crm_notification: supabase/migrations/0056_time_and_notifications.sql
      // (blueprint §13.3). Hand-added until the next
      // `generate_typescript_types` run folds it in — same convention
      // crm_document_draft and the 0055 crm_lead columns use.
      crm_notification: {
        Row: {
          activity_id: string | null
          actor_id: string | null
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["crm_notification_kind"]
          lead_id: string | null
          matter_id: string | null
          org_id: string
          payload: Json
          read_at: string | null
          user_id: string
        }
        Insert: {
          activity_id?: string | null
          actor_id?: string | null
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["crm_notification_kind"]
          lead_id?: string | null
          matter_id?: string | null
          org_id: string
          payload?: Json
          read_at?: string | null
          user_id: string
        }
        Update: {
          activity_id?: string | null
          actor_id?: string | null
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["crm_notification_kind"]
          lead_id?: string | null
          matter_id?: string | null
          org_id?: string
          payload?: Json
          read_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_notification_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "crm_activity"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_notification_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_lead"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_notification_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "crm_matter"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_notification_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "crm_org"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_org: {
        Row: {
          created_at: string
          id: string
          modules: string[]
          name: string
          queue_org_key: string | null
          slug: string
        }
        Insert: {
          created_at?: string
          id?: string
          modules?: string[]
          name: string
          queue_org_key?: string | null
          slug: string
        }
        Update: {
          created_at?: string
          id?: string
          modules?: string[]
          name?: string
          queue_org_key?: string | null
          slug?: string
        }
        Relationships: []
      }
      crm_org_member: {
        Row: {
          created_at: string
          id: string
          org_id: string
          role: Database["public"]["Enums"]["crm_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          role?: Database["public"]["Enums"]["crm_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          role?: Database["public"]["Enums"]["crm_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_org_member_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "crm_org"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_org_theme: {
        Row: {
          accent_color: string
          font_body: string
          font_display: string
          ink_color: string
          logo_url: string | null
          org_id: string
          primary_color: string
          surface_color: string
          updated_at: string
        }
        Insert: {
          accent_color?: string
          font_body?: string
          font_display?: string
          ink_color?: string
          logo_url?: string | null
          org_id: string
          primary_color?: string
          surface_color?: string
          updated_at?: string
        }
        Update: {
          accent_color?: string
          font_body?: string
          font_display?: string
          ink_color?: string
          logo_url?: string | null
          org_id?: string
          primary_color?: string
          surface_color?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_org_theme_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "crm_org"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_org_voice_profile: {
        Row: {
          attorney_name: string | null
          org_id: string
          signature: string | null
          tone: string
          updated_at: string
        }
        Insert: {
          attorney_name?: string | null
          org_id: string
          signature?: string | null
          tone?: string
          updated_at?: string
        }
        Update: {
          attorney_name?: string | null
          org_id?: string
          signature?: string | null
          tone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_org_voice_profile_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "crm_org"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_package: {
        Row: {
          additional_class_cents: number
          bundle_rule: Json
          classes: number
          created_at: string
          description: string | null
          id: string
          name: string
          org_id: string
          price_cents: number
        }
        Insert: {
          additional_class_cents?: number
          bundle_rule?: Json
          classes?: number
          created_at?: string
          description?: string | null
          id?: string
          name: string
          org_id: string
          price_cents: number
        }
        Update: {
          additional_class_cents?: number
          bundle_rule?: Json
          classes?: number
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          org_id?: string
          price_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "crm_package_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "crm_org"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_post_consult_action: {
        Row: {
          consult_note_id: string
          created_at: string
          id: string
          kind: string
          org_id: string
          payload: Json
          status: string
        }
        Insert: {
          consult_note_id: string
          created_at?: string
          id?: string
          kind: string
          org_id: string
          payload?: Json
          status?: string
        }
        Update: {
          consult_note_id?: string
          created_at?: string
          id?: string
          kind?: string
          org_id?: string
          payload?: Json
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_post_consult_action_consult_note_id_fkey"
            columns: ["consult_note_id"]
            isOneToOne: false
            referencedRelation: "crm_consult_note"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_post_consult_action_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "crm_org"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_stage: {
        Row: {
          aging_threshold_days: number | null
          category: Database["public"]["Enums"]["crm_stage_category"]
          created_at: string
          id: string
          name: string
          order_index: number
          org_id: string
        }
        Insert: {
          aging_threshold_days?: number | null
          category: Database["public"]["Enums"]["crm_stage_category"]
          created_at?: string
          id?: string
          name: string
          order_index: number
          org_id: string
        }
        Update: {
          aging_threshold_days?: number | null
          category?: Database["public"]["Enums"]["crm_stage_category"]
          created_at?: string
          id?: string
          name?: string
          order_index?: number
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_stage_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "crm_org"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_tag: {
        Row: {
          code: string
          color: string | null
          description: string | null
          dimension: Database["public"]["Enums"]["crm_tag_dimension"]
          id: string
          label: string
          org_id: string
        }
        Insert: {
          code: string
          color?: string | null
          description?: string | null
          dimension: Database["public"]["Enums"]["crm_tag_dimension"]
          id?: string
          label: string
          org_id: string
        }
        Update: {
          code?: string
          color?: string | null
          description?: string | null
          dimension?: Database["public"]["Enums"]["crm_tag_dimension"]
          id?: string
          label?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_tag_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "crm_org"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_task: {
        Row: {
          assignee_id: string | null
          created_at: string
          due_at: string | null
          id: string
          lead_id: string | null
          matter_id: string | null
          org_id: string
          status: Database["public"]["Enums"]["crm_task_status"]
          title: string
          type: Database["public"]["Enums"]["crm_task_type"]
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          created_at?: string
          due_at?: string | null
          id?: string
          lead_id?: string | null
          matter_id?: string | null
          org_id: string
          status?: Database["public"]["Enums"]["crm_task_status"]
          title: string
          type?: Database["public"]["Enums"]["crm_task_type"]
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          created_at?: string
          due_at?: string | null
          id?: string
          lead_id?: string | null
          matter_id?: string | null
          org_id?: string
          status?: Database["public"]["Enums"]["crm_task_status"]
          title?: string
          type?: Database["public"]["Enums"]["crm_task_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_task_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_lead"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_task_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "crm_matter"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_task_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "crm_org"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_team_status_note: {
        Row: {
          created_at: string
          id: string
          link_url: string | null
          note: string | null
          org_id: string
          updated_at: string
          updated_by: string | null
          week_start: string
        }
        Insert: {
          created_at?: string
          id?: string
          link_url?: string | null
          note?: string | null
          org_id: string
          updated_at?: string
          updated_by?: string | null
          week_start: string
        }
        Update: {
          created_at?: string
          id?: string
          link_url?: string | null
          note?: string | null
          org_id?: string
          updated_at?: string
          updated_by?: string | null
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_team_status_note_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "crm_org"
            referencedColumns: ["id"]
          },
        ]
      }
      // crm_time_entry: supabase/migrations/0056_time_and_notifications.sql
      // (blueprint §13.1). Internal effort, never a client invoice — there is
      // no rate or billable column here because the schema has none. Hand-
      // added until the next `generate_typescript_types` run.
      crm_time_entry: {
        Row: {
          created_at: string
          ended_at: string | null
          id: string
          lead_id: string | null
          matter_id: string | null
          note: string | null
          org_id: string
          seconds: number
          started_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          ended_at?: string | null
          id?: string
          lead_id?: string | null
          matter_id?: string | null
          note?: string | null
          org_id: string
          seconds?: number
          started_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          id?: string
          lead_id?: string | null
          matter_id?: string | null
          note?: string | null
          org_id?: string
          seconds?: number
          started_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_time_entry_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_lead"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_time_entry_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "crm_matter"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_time_entry_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "crm_org"
            referencedColumns: ["id"]
          },
        ]
      }
      // crm_contact / crm_matter_contact: supabase/migrations/0048_crm_contact.sql.
      // Hand-added (not yet run through `generate_typescript_types`), same
      // convention as crm_document_draft above — shaped to match exactly what
      // codegen would produce; replace with the generated blocks on the next
      // real codegen run.
      crm_contact: {
        Row: {
          business_name: string | null
          company_name: string | null
          created_at: string
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          notes: string | null
          org_id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          business_name?: string | null
          company_name?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          notes?: string | null
          org_id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          business_name?: string | null
          company_name?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          notes?: string | null
          org_id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_contact_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "crm_org"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_matter_contact: {
        Row: {
          contact_id: string
          created_at: string
          id: string
          matter_id: string
          org_id: string
          role: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          id?: string
          matter_id: string
          org_id: string
          role?: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          id?: string
          matter_id?: string
          org_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_matter_contact_contact_fk"
            columns: ["contact_id", "org_id"]
            isOneToOne: false
            referencedRelation: "crm_contact"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "crm_matter_contact_matter_fk"
            columns: ["matter_id", "org_id"]
            isOneToOne: false
            referencedRelation: "crm_matter"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "crm_matter_contact_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "crm_org"
            referencedColumns: ["id"]
          },
        ]
      }
      founder: {
        Row: {
          created_at: string
          default_tz: string | null
          email: string | null
          id: string
          name: string | null
          phone: string | null
        }
        Insert: {
          created_at?: string
          default_tz?: string | null
          email?: string | null
          id: string
          name?: string | null
          phone?: string | null
        }
        Update: {
          created_at?: string
          default_tz?: string | null
          email?: string | null
          id?: string
          name?: string | null
          phone?: string | null
        }
        Relationships: []
      }
      user_org_preference: {
        Row: {
          active_org_id: string | null
          user_id: string
        }
        Insert: {
          active_org_id?: string | null
          user_id: string
        }
        Update: {
          active_org_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_org_preference_active_org_id_fkey"
            columns: ["active_org_id"]
            isOneToOne: false
            referencedRelation: "crm_org"
            referencedColumns: ["id"]
          },
        ]
      }
      vault_certificate: {
        Row: {
          anchored_at: string | null
          created_at: string
          id: string
          ots_proof: string | null
          pdf_url: string | null
          qr_verify_token: string
          sha256: string
          status: string
          vault_entry_id: string
        }
        Insert: {
          anchored_at?: string | null
          created_at?: string
          id?: string
          ots_proof?: string | null
          pdf_url?: string | null
          qr_verify_token: string
          sha256: string
          status?: string
          vault_entry_id: string
        }
        Update: {
          anchored_at?: string | null
          created_at?: string
          id?: string
          ots_proof?: string | null
          pdf_url?: string | null
          qr_verify_token?: string
          sha256?: string
          status?: string
          vault_entry_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vault_certificate_vault_entry_id_fkey"
            columns: ["vault_entry_id"]
            isOneToOne: false
            referencedRelation: "vault_entry"
            referencedColumns: ["id"]
          },
        ]
      }
      vault_entry: {
        Row: {
          captured_at: string
          classification: Json
          created_at: string
          entry_type: string
          founder_id: string
          id: string
          media_url: string | null
          nice_class: number[]
          raw_text: string | null
          shared_with_org_id: string | null
          source: string
          status: string
          title: string | null
          transcription: string | null
        }
        Insert: {
          captured_at?: string
          classification?: Json
          created_at?: string
          entry_type: string
          founder_id: string
          id?: string
          media_url?: string | null
          nice_class?: number[]
          raw_text?: string | null
          shared_with_org_id?: string | null
          source?: string
          status?: string
          title?: string | null
          transcription?: string | null
        }
        Update: {
          captured_at?: string
          classification?: Json
          created_at?: string
          entry_type?: string
          founder_id?: string
          id?: string
          media_url?: string | null
          nice_class?: number[]
          raw_text?: string | null
          shared_with_org_id?: string | null
          source?: string
          status?: string
          title?: string | null
          transcription?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vault_entry_founder_id_fkey"
            columns: ["founder_id"]
            isOneToOne: false
            referencedRelation: "founder"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_org_id: { Args: never; Returns: string }
      current_org_role: { Args: never; Returns: string }
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      discovery_merge: {
        Args: {
          p_ai_summary: string
          p_consult: Json
          p_id: string
          p_phase: Json
          p_transcript: string
        }
        Returns: {
          ai_summary: string | null
          audio_url: string | null
          consultation_form: Json
          ended_at: string | null
          extracted_marks: Json | null
          id: string
          lead_id: string
          org_id: string
          outcome: Database["public"]["Enums"]["crm_discovery_outcome"]
          phase_answers: Json
          runner_id: string | null
          started_at: string
          transcript: string | null
        }
        SetofOptions: {
          from: "*"
          to: "crm_discovery_session"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      provision_org: {
        Args: { p_name: string; p_slug: string }
        Returns: string
      }
      seed_org_defaults: { Args: { p_org: string }; Returns: undefined }
      set_active_org: { Args: { p_org_id: string }; Returns: undefined }
      // 0050_platform_admin.sql — Lectual staff who may enter any firm.
      is_platform_admin: { Args: never; Returns: boolean }
      // Names ONLY. The single cross-org read in the schema; it must never
      // grow queue_org_key or any client-identifying column (see 0030).
      platform_admin_orgs: {
        Args: never
        Returns: { id: string; name: string; slug: string }[]
      }
      audit_org_switch: { Args: { p_org_id: string }; Returns: undefined }
      verify_certificate: {
        Args: { token: string }
        Returns: {
          anchored_at: string | null
          created_at: string
          id: string
          ots_proof: string | null
          pdf_url: string | null
          qr_verify_token: string
          sha256: string
          status: string
          vault_entry_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "vault_certificate"
          isOneToOne: false
          isSetofReturn: true
        }
      }
    }
    Enums: {
      crm_activity_type:
        | "note"
        | "email_sent"
        | "email_received"
        | "email_opened"
        | "email_clicked"
        | "call_logged"
        | "stage_changed"
        | "tag_applied"
        | "tag_removed"
        | "matter_opened"
        | "matter_updated"
        | "discovery_started"
        | "discovery_completed"
        | "ai_insight"
        | "task_created"
        | "task_completed"
        | "automation_fired"
        | "queue_drafted"
        | "queue_resolved"
        // 0056: a start/stop of an internal time entry, so the timeline can
        // say "clock event" without a fabricated note (blueprint §13.1).
        | "time_logged"
      crm_actor_type: "user" | "system" | "ai" | "automation" | "pathset"
      crm_ai_enrichment_layer: "layer1" | "layer2" | "layer3"
      crm_ai_enrichment_type:
        | "tag_suggestion"
        | "urgency_band"
        | "value_band"
        | "call_summary"
        | "mark_extraction"
        | "lead_score"
        | "insight"
      crm_automation_trigger:
        | "lead_created"
        | "stage_changed"
        | "tag_applied"
        | "tag_removed"
        | "discovery_completed"
        | "matter_opened"
        | "task_completed"
        | "inactivity"
        | "manual"
      crm_brain_category:
        | "identity"
        | "voice"
        | "pricing"
        | "engagement_norms"
        | "decision_log"
        | "client_language"
        | "template"
        | "stage_mapping"
        | "other"
      crm_claim_status: "proposed" | "approved" | "forbidden"
      crm_deadline_kind:
        | "office_action_response"
        | "statement_of_use"
        | "sou_extension_request"
        | "opposition_window"
        | "section_8_declaration"
        | "section_15_declaration"
        | "section_9_renewal"
        | "priority_filing"
        | "other"
        | "hearing"
        | "hearing_request"
        | "motion_response"
        | "notice_of_appeal"
        | "set_aside_default"
        | "status_check"
        | "trial"
      crm_deadline_source: "calculated" | "official_notice" | "manual"
      crm_deadline_status: "open" | "satisfied" | "waived" | "superseded"
      crm_discovery_outcome:
        | "booked_lss"
        | "no_show"
        | "nurture"
        | "turned_away"
        | "referred_out"
        | "pending"
      crm_drip_enrollment_status:
        | "active"
        | "paused"
        | "completed"
        | "cancelled"
      crm_drip_step_type: "email" | "task" | "wait" | "condition"
      crm_filing_basis: "1a" | "1b" | "44d" | "44e" | "66a"
      crm_lead_temperature: "hot" | "warm" | "cold"
      crm_matter_type: "TM" | "PATENT" | "CR" | "BL" | "EL" | "SO" | "LIT"
      crm_matter_waiting_on: "firm" | "client" | "uspto" | "court"
      // 0056 (blueprint §13.3). In-app bell only — no email, no SMS.
      crm_notification_kind:
        | "mentioned"
        | "assigned"
        | "lead_replied"
        | "time_running"
      crm_role:
        | "owner"
        | "admin"
        | "senior_admin"
        | "intake"
        | "paralegal"
        | "law_clerk"
        | "social_media"
        | "attorney"
        | "clerk"
        | "viewer"
      crm_stage_category: "open" | "won" | "lost" | "nurture"
      crm_tag_dimension:
        | "PA"
        | "SERV"
        | "URG"
        | "VAL"
        | "QUAL"
        | "SRC"
        | "EVENT"
        | "FU"
        | "BILL"
        | "OPS"
        | "SEG"
        | "CAMP"
      crm_tag_source: "auto" | "ai" | "human"
      crm_task_status: "open" | "completed" | "cancelled" | "snoozed"
      crm_task_type: "email" | "call" | "review" | "filing" | "custom"
      crm_urgency_band: "2d" | "3d" | "5d" | "7d" | "14d" | "none"
      crm_value_band: "LOW" | "MID" | "HIGH" | "PREMIUM" | "UNKNOWN"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      crm_activity_type: [
        "note",
        "email_sent",
        "email_received",
        "email_opened",
        "email_clicked",
        "call_logged",
        "stage_changed",
        "tag_applied",
        "tag_removed",
        "matter_opened",
        "matter_updated",
        "discovery_started",
        "discovery_completed",
        "ai_insight",
        "task_created",
        "task_completed",
        "automation_fired",
        "queue_drafted",
        "queue_resolved",
        "time_logged",
      ],
      crm_actor_type: ["user", "system", "ai", "automation", "pathset"],
      crm_ai_enrichment_layer: ["layer1", "layer2", "layer3"],
      crm_ai_enrichment_type: [
        "tag_suggestion",
        "urgency_band",
        "value_band",
        "call_summary",
        "mark_extraction",
        "lead_score",
        "insight",
      ],
      crm_automation_trigger: [
        "lead_created",
        "stage_changed",
        "tag_applied",
        "tag_removed",
        "discovery_completed",
        "matter_opened",
        "task_completed",
        "inactivity",
        "manual",
      ],
      crm_brain_category: [
        "identity",
        "voice",
        "pricing",
        "engagement_norms",
        "decision_log",
        "client_language",
        "template",
        "stage_mapping",
        "other",
      ],
      crm_claim_status: ["proposed", "approved", "forbidden"],
      crm_deadline_kind: [
        "office_action_response",
        "statement_of_use",
        "sou_extension_request",
        "opposition_window",
        "section_8_declaration",
        "section_15_declaration",
        "section_9_renewal",
        "priority_filing",
        "other",
        "hearing",
        "hearing_request",
        "motion_response",
        "notice_of_appeal",
        "set_aside_default",
        "status_check",
        "trial",
      ],
      crm_deadline_source: ["calculated", "official_notice", "manual"],
      crm_deadline_status: ["open", "satisfied", "waived", "superseded"],
      crm_discovery_outcome: [
        "booked_lss",
        "no_show",
        "nurture",
        "turned_away",
        "referred_out",
        "pending",
      ],
      crm_drip_enrollment_status: [
        "active",
        "paused",
        "completed",
        "cancelled",
      ],
      crm_drip_step_type: ["email", "task", "wait", "condition"],
      crm_filing_basis: ["1a", "1b", "44d", "44e", "66a"],
      crm_matter_type: ["TM", "PATENT", "CR", "BL", "EL", "SO", "LIT"],
      crm_matter_waiting_on: ["firm", "client", "uspto", "court"],
      crm_notification_kind: [
        "mentioned",
        "assigned",
        "lead_replied",
        "time_running",
      ],
      crm_role: [
        "owner",
        "admin",
        "senior_admin",
        "intake",
        "paralegal",
        "law_clerk",
        "social_media",
        "attorney",
        "clerk",
        "viewer",
      ],
      crm_stage_category: ["open", "won", "lost", "nurture"],
      crm_tag_dimension: [
        "PA",
        "SERV",
        "URG",
        "VAL",
        "QUAL",
        "SRC",
        "EVENT",
        "FU",
        "BILL",
        "OPS",
        "SEG",
        "CAMP",
      ],
      crm_tag_source: ["auto", "ai", "human"],
      crm_task_status: ["open", "completed", "cancelled", "snoozed"],
      crm_task_type: ["email", "call", "review", "filing", "custom"],
      crm_urgency_band: ["2d", "3d", "5d", "7d", "14d", "none"],
      crm_value_band: ["LOW", "MID", "HIGH", "PREMIUM", "UNKNOWN"],
    },
  },
} as const
