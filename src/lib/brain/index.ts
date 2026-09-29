import type { Database } from "@/lib/db/types";

export type BrainEntry = Database["public"]["Tables"]["crm_firm_brain_entry"]["Row"];
export type BrainCategory = Database["public"]["Enums"]["crm_brain_category"];
export type ClaimEntry = Database["public"]["Tables"]["crm_claim_library"]["Row"];
export type ClaimStatus = Database["public"]["Enums"]["crm_claim_status"];

export * from "./entries";
export * from "./claims";
