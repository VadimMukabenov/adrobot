import { useEffect, useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { api, errorText } from "../api";
import type { Offer } from "../types";

type Choice = { id: string; label: string; search?: string };
type PickerProps = {
  label: string;
  value: Choice | null;
  items: Choice[];
  disabled?: boolean;
  loading?: boolean;
  error?: string;
  onChange: (choice: Choice | null) => void;
  onSearch: (query: string) => void;
};

function SearchPicker({
  label,
  value,
  items,
  disabled,
  loading,
  error,
  onChange,
  onSearch,
}: PickerProps) {
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const listId = useId();
  useEffect(() => {
    if (value) setQuery(null);
  }, [value?.id]);
  function choose(choice: Choice) {
    onChange(choice);
    setQuery(null);
    setOpen(false);
  }
  const expanded = open && !disabled;
  return (
    <div
      className="campaign-picker"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setOpen(false);
          setQuery(null);
        }
      }}
    >
      <div className="picker-input">
        <input
          required
          role="combobox"
          aria-label={label}
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-activedescendant={
            expanded && !loading && items[highlight]
              ? `${listId}-${highlight}`
              : undefined
          }
          autoComplete="off"
          placeholder={`Choose ${label.toLowerCase()}…`}
          value={query ?? value?.label ?? ""}
          disabled={disabled}
          onFocus={() => {
            setOpen(true);
            setHighlight(0);
            onSearch("");
          }}
          onClick={() => {
            if (!open) {
              setOpen(true);
              setHighlight(0);
              onSearch("");
            }
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setHighlight(0);
            onChange(null);
            onSearch(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setOpen(false);
            }
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              if (!open) {
                setOpen(true);
                onSearch("");
                setHighlight(0);
              } else
                setHighlight((i) =>
                  Math.max(
                    0,
                    Math.min(
                      items.length - 1,
                      i + (e.key === "ArrowDown" ? 1 : -1),
                    ),
                  ),
                );
            }
            if (e.key === "Enter" && expanded) {
              e.preventDefault();
              if (!loading && items[highlight]) choose(items[highlight]);
            }
          }}
        />
        <ChevronDown size={16} aria-hidden="true" />
      </div>
      {expanded && (
        <div
          className="offer-results"
          role="listbox"
          tabIndex={-1}
          aria-label={label}
          id={listId}
        >
          {loading ? (
            <div className="search-hint" role="status">
              Loading offers from Keitaro…
            </div>
          ) : error ? (
            <div className="search-hint" role="alert">
              {error}
            </div>
          ) : items.length ? (
            items.map((choice, i) => (
              <button
                type="button"
                tabIndex={-1}
                role="option"
                id={`${listId}-${i}`}
                key={choice.id}
                aria-selected={value?.id === choice.id}
                className={i === highlight ? "highlighted" : ""}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(choice)}
              >
                {choice.label}
              </button>
            ))
          ) : (
            <div className="search-hint">
              No matching {label === "Country" ? "countries" : "active offers"}.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ISO 3166-1 alpha-2 codes; the same set is validated by the backend.
const codes =
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW";
const ru = new Intl.DisplayNames(["ru"], { type: "region" });
const en = new Intl.DisplayNames(["en"], { type: "region" });
const countries: Choice[] = codes
  .split(" ")
  .map((id) => ({
    id,
    label: `${ru.of(id)} (${id})`,
    search: `${id} ${ru.of(id)} ${en.of(id)}`.toLocaleLowerCase(),
  }))
  .sort((a, b) => a.label.localeCompare(b.label, "ru"));

export function CountryPicker({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (code: string) => void;
}) {
  const [query, setQuery] = useState("");
  const exactCode = countries.find((c) => c.id === query.trim().toUpperCase());
  return (
    <SearchPicker
      label="Country"
      value={countries.find((c) => c.id === value) ?? null}
      items={
        exactCode
          ? [exactCode]
          : countries.filter((c) =>
              c.search?.includes(query.trim().toLocaleLowerCase()),
            )
      }
      disabled={disabled}
      onSearch={setQuery}
      onChange={(choice) => onChange(choice?.id ?? "")}
    />
  );
}

export function OfferPicker({
  value,
  disabled,
  onChange,
}: {
  value: Offer | null;
  disabled: boolean;
  onChange: (offer: Offer | null) => void;
}) {
  const [search, setSearch] = useState<{ query: string } | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (search === null || disabled) return;
    const { query } = search;
    const controller = new AbortController();
    setOffers([]);
    setLoading(true);
    setError("");
    const timer = window.setTimeout(
      () => {
        api<Offer[]>(`/offers?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        })
          .then((rows) => {
            if (!controller.signal.aborted) setOffers(rows);
          })
          .catch((e) => {
            if (!controller.signal.aborted) setError(errorText(e));
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false);
          });
      },
      query ? 200 : 0,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [search, disabled]);
  return (
    <SearchPicker
      label="Offer"
      value={
        value
          ? { id: String(value.id), label: `${value.id} · ${value.name}` }
          : null
      }
      items={offers.map((o) => ({
        id: String(o.id),
        label: `${o.id} · ${o.name}`,
      }))}
      disabled={disabled}
      loading={loading}
      error={error}
      onSearch={(query) => setSearch({ query })}
      onChange={(choice) =>
        onChange(
          choice
            ? (offers.find((o) => String(o.id) === choice.id) ?? null)
            : null,
        )
      }
    />
  );
}
