import { Layers, Plus, Search } from "lucide-react";
import type { CampaignSummary } from "../types";

type Props = {
  campaigns: CampaignSummary[];
  selected: number | null;
  query: string;
  loading: boolean;
  onQuery: (q: string) => void;
  onSelect: (id: number) => void;
  onCreate: () => void;
};

export function CampaignList({
  campaigns,
  selected,
  query,
  loading,
  onQuery,
  onSelect,
  onCreate,
}: Props) {
  const filtered = campaigns.filter(
    (c) =>
      c.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()) ||
      String(c.id) === query,
  );
  return (
    <aside className="sidebar" aria-label="Campaigns">
      <h2>Campaigns</h2>
      <label className="search-combo campaign-search">
        <Search size={18} />
        <input
          aria-label="Search campaigns"
          placeholder="Search campaigns…"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
        />
      </label>
      <nav aria-label="Select a campaign" className="campaign-list">
        {loading && <p className="muted">Loading campaigns…</p>}
        {!loading && filtered.length === 0 && (
          <p className="muted">No campaigns match your search.</p>
        )}
        {filtered.map((c) => (
          <button
            type="button"
            key={c.id}
            className={c.id === selected ? "selected" : ""}
            aria-current={c.id === selected ? "page" : undefined}
            onClick={() => onSelect(c.id)}
          >
            <Layers size={19} aria-hidden="true" />
            <span title={c.name}>{c.name}</span>
          </button>
        ))}
      </nav>
      <button className="button primary new-campaign" onClick={onCreate}>
        <Plus size={20} />
        New campaign
      </button>
    </aside>
  );
}
