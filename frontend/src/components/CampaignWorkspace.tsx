import { Globe2, Layers, RefreshCw, Route } from "lucide-react";
import type {
  Campaign,
  EditAction,
  Lookups,
  Stream,
  StreamAction,
} from "../types";
import { VisitorLink } from "./VisitorLink";
import { StreamEditor } from "./StreamEditor";

type Props = {
  emulator?: boolean;
  campaign: Campaign;
  lookups: Lookups;
  prefix: string;
  busy: Set<number>;
  refreshing: boolean;
  refresh: () => Promise<void>;
  mutate: (
    stream: Stream,
    action: StreamAction | "edit",
    edit?: object,
  ) => Promise<void>;
};

export function CampaignWorkspace({
  emulator = false,
  campaign,
  lookups,
  prefix,
  busy,
  refreshing,
  refresh,
  mutate,
}: Props) {
  const lookupName = (key: keyof Lookups, id: number) =>
    lookups[key].find((item) => item.id === id)?.name || String(id);
  return (
    <>
      <div className="campaign-header">
        <h1>{campaign.name}</h1>
        <button
          className="button outline refresh"
          disabled={refreshing || busy.size > 0}
          onClick={() => void refresh()}
        >
          <RefreshCw size={18} className={refreshing ? "spin" : ""} />
          {refreshing ? "Refreshing…" : "Refresh from Keitaro"}
        </button>
      </div>
      <div className="metadata">
        <span>
          <Globe2 size={17} />
          Domain: {lookupName("domains", campaign.domain_id)}
        </span>
        <span>
          <Layers size={17} />
          Group: {lookupName("groups", campaign.group_id)}
        </span>
        <span>
          <Route size={17} />
          Source: {lookupName("traffic_sources", campaign.traffic_source_id)}
        </span>
      </div>
      {campaign.visitor_url && (
        <VisitorLink
          key={campaign.visitor_url}
          url={campaign.visitor_url}
          emulator={emulator}
        />
      )}
      <aside className="workflow-guide" aria-label="How to use this editor">
        <strong>Edit offer traffic in three steps</strong>
        <ol>
          <li>Find an offer below and click Add offer.</li>
          <li>
            Set its traffic percentage, or let unpinned offers share traffic
            equally.
          </li>
          <li>
            Click Publish to Keitaro to apply the draft. Discard draft undoes
            local edits.
          </li>
        </ol>
        <p>
          Edits are saved locally and survive reloads. Keitaro changes only when
          you publish.
        </p>
      </aside>
      {!campaign.writable && (
        <p className="notice warning">
          Read only. Writing is restricted to {prefix} campaigns.
        </p>
      )}
      {campaign.streams.map((s, index) => (
        <StreamEditor
          key={s.id}
          stream={s}
          index={index + 1}
          busy={busy.has(s.id) || refreshing}
          writable={campaign.writable}
          onEdit={(action: EditAction, offerId, share) =>
            void mutate(s, "edit", {
              action,
              offer_id: offerId,
              ...(share !== undefined ? { share } : {}),
            })
          }
          onAction={(action) => void mutate(s, action)}
        />
      ))}
      {campaign.streams.length === 0 && (
        <p className="muted">This campaign has no streams.</p>
      )}
    </>
  );
}
