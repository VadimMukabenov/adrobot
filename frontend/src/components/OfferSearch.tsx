import { useEffect, useId, useState } from "react";
import { Plus, Search } from "lucide-react";
import { api, errorText } from "../api";
import type { Offer } from "../types";

type Props = {
  disabled?: boolean;
  onSelect: (offer: Offer) => void;
  label?: string;
};

export function OfferSearch({
  disabled = false,
  onSelect,
  label = "Add offer",
}: Props) {
  const [query, setQuery] = useState("");
  const [offers, setOffers] = useState<Offer[]>([]);
  const [selected, setSelected] = useState<Offer | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const listId = useId();
  useEffect(() => {
    if (!query.trim() || selected) {
      setOffers([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      api<Offer[]>(`/offers?q=${encodeURIComponent(query)}`, {
        signal: controller.signal,
      })
        .then((rows) => {
          setOffers(rows.slice(0, 30));
          setHighlight(0);
          setError("");
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(errorText(e));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, selected]);
  function choose(offer: Offer) {
    setSelected(offer);
    setQuery(`${offer.id} · ${offer.name}`);
    setOpen(false);
    setOffers([]);
  }
  return (
    <div className="offer-search">
      <div className="search-combo">
        <Search size={18} aria-hidden="true" />
        <input
          aria-label="Search offers by ID or name"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open && offers.length > 0}
          aria-controls={listId}
          aria-activedescendant={
            open && offers[highlight] ? `${listId}-${highlight}` : undefined
          }
          placeholder="Search offers by ID or name"
          value={query}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(null);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setHighlight((i) => Math.min(i + 1, offers.length - 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight((i) => Math.max(i - 1, 0));
            }
            if (e.key === "Enter" && open && offers[highlight]) {
              e.preventDefault();
              choose(offers[highlight]);
            }
          }}
        />
        {open && query && !selected && (
          <div className="offer-results" role="listbox" id={listId}>
            {loading ? (
              <div className="search-hint">Searching Keitaro…</div>
            ) : offers.length ? (
              offers.map((o, i) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={i === highlight}
                  id={`${listId}-${i}`}
                  className={i === highlight ? "highlighted" : ""}
                  key={o.id}
                  onClick={() => choose(o)}
                >
                  <strong>{o.id}</strong>
                  <span>{o.name}</span>
                </button>
              ))
            ) : (
              <div className="search-hint">
                {error || "No matching active offers."}
              </div>
            )}
          </div>
        )}
      </div>
      <button
        type="button"
        className="button primary"
        disabled={disabled || !selected}
        onClick={() => {
          if (selected) {
            onSelect(selected);
            setSelected(null);
            setQuery("");
          }
        }}
      >
        <Plus size={18} aria-hidden="true" />
        {label}
      </button>
    </div>
  );
}
