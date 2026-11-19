export type AppMode = "live" | "demo" | "emulator";
export type Offer = { id: number; name: string; state: string };
export type Link = {
  offer_id: number;
  name: string;
  share: number;
  pinned: boolean;
  removed: boolean;
  available: boolean;
};
export type Stream = {
  id: number;
  name: string;
  revision: number;
  editable: boolean;
  available: boolean;
  dirty: boolean;
  status: string;
  messages: string[];
  offers: Link[];
  total: number;
};
export type CampaignSummary = {
  id: number;
  name: string;
  state?: string;
  visitor_url?: string | null;
  visitor_url_observed_at?: string;
};
export type Campaign = CampaignSummary & {
  domain_id: number;
  group_id: number;
  traffic_source_id: number;
  available: boolean;
  writable: boolean;
  streams: Stream[];
};
export type Lookup = { id: number; name: string };
export type Lookups = {
  domains: Lookup[];
  groups: Lookup[];
  traffic_sources: Lookup[];
};
export type EditAction = "add" | "remove" | "restore" | "pin" | "unpin";
export type StreamAction = "push" | "cancel" | "reconcile";
export type Creation = {
  name: string;
  country: string;
  offer_id: number;
  domain_id: number;
  group_id: number;
  traffic_source_id: number;
  operation_id: string;
};
export type Operation = {
  operation_id: string;
  status: string;
  phase: string;
  campaign_id?: number;
  message?: string;
};
