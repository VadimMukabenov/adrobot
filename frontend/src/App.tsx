import { useCallback, useEffect, useRef, useState } from "react";
import { Globe2, Layers, RefreshCw, Route } from "lucide-react";
import { api, ApiError, errorText, post } from "./api";
import type {
  Campaign,
  CampaignSummary,
  EditAction,
  Lookups,
  Stream,
  StreamAction,
} from "./types";
import { CampaignList } from "./components/CampaignList";
import { CreateCampaignForm } from "./components/CreateCampaignForm";
import { StreamEditor } from "./components/StreamEditor";

import { SetupConnection } from "./components/SetupConnection";

const emptyLookups: Lookups = { domains: [], groups: [], traffic_sources: [] };

export default function App() {
  const [ready, setReady] = useState(false);
  const connected = useCallback(() => setReady(true), []);
  return ready ? <CampaignApp /> : <SetupConnection onConnected={connected} />;
}

function CampaignApp() {
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [lookups, setLookups] = useState<Lookups>(emptyLookups);
  const [prefix, setPrefix] = useState("test_mukabenov_");
  const [query, setQuery] = useState("test_mukabenov_");
  const [selected, setSelected] = useState<number | null>(null);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<Set<number>>(new Set());
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [notice, setNotice] = useState("");
  const selectionRef = useRef(selected);
  selectionRef.current = selected;

  const loadIndex = useCallback(async () => {
    setLoading(true);
    setError("");
    const [health, list, metadata] = await Promise.allSettled([
      api<{ campaign_prefix: string }>("/health"),
      api<CampaignSummary[]>("/campaigns"),
      api<Lookups>("/lookups"),
    ]);
    const preferred =
      health.status === "fulfilled"
        ? health.value.campaign_prefix
        : "test_mukabenov_";
    setPrefix(preferred);
    setQuery(preferred);
    if (list.status === "fulfilled") {
      setCampaigns(list.value);
      setSelected(
        (id) =>
          id ??
          list.value.find((c) => c.name.startsWith(preferred))?.id ??
          null,
      );
    } else setError(errorText(list.reason));
    if (metadata.status === "fulfilled") setLookups(metadata.value);
    else setError(errorText(metadata.reason));
    setLoading(false);
  }, []);
  useEffect(() => {
    void loadIndex();
  }, [loadIndex]);

  useEffect(() => {
    if (selected === null) {
      setCampaign(null);
      return;
    }
    const controller = new AbortController();
    setCampaign(null);
    setError("");
    setNotice("");
    (async () => {
      try {
        let data: Campaign;
        try {
          data = await api<Campaign>(`/campaigns/${selected}`, {
            signal: controller.signal,
          });
        } catch (e) {
          if (!(e instanceof ApiError) || e.status !== 404) throw e;
          data = await post<Campaign>(`/campaigns/${selected}/fetch`);
        }
        if (!controller.signal.aborted) setCampaign(data);
      } catch (e) {
        if (!controller.signal.aborted) setError(errorText(e));
      }
    })();
    return () => controller.abort();
  }, [selected, reload]);

  async function refresh() {
    if (!campaign) return;
    const id = campaign.id;
    setRefreshing(true);
    setError("");
    setNotice("");
    try {
      const data = await post<Campaign>(`/campaigns/${id}/fetch`);
      if (selectionRef.current === id) {
        setCampaign(data);
        setNotice("Refreshed from Keitaro.");
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setRefreshing(false);
    }
  }
  async function mutate(
    stream: Stream,
    action: StreamAction | "edit",
    edit?: object,
  ) {
    if (!campaign) return;
    const id = campaign.id;
    setBusy((previous) => new Set(previous).add(stream.id));
    setError("");
    setNotice("");
    try {
      const data = await post<Stream>(`/streams/${stream.id}/${action}`, {
        expected_revision: stream.revision,
        ...edit,
      });
      if (selectionRef.current === id) {
        setCampaign(
          (previous) =>
            previous && {
              ...previous,
              streams: previous.streams.map((s) =>
                s.id === data.id ? data : s,
              ),
            },
        );
        setNotice(
          action === "push"
            ? "Published and confirmed in Keitaro."
            : action === "cancel"
              ? "Local changes cancelled."
              : action === "reconcile"
                ? "Remote state checked."
                : "Draft saved locally.",
        );
      }
    } catch (e) {
      setError(errorText(e));
      try {
        const data = await api<Campaign>(`/campaigns/${id}`);
        if (selectionRef.current === id) setCampaign(data);
      } catch {
        /* Retain current view if reload also fails. */
      }
    } finally {
      setBusy((previous) => {
        const next = new Set(previous);
        next.delete(stream.id);
        return next;
      });
    }
  }
  const lookupName = (key: keyof Lookups, id: number) =>
    lookups[key].find((x) => x.id === id)?.name || String(id);
  return (
    <div className="app">
      <header className="app-header">
        <strong>Adrobot</strong>
        <span>Keitaro campaign editor</span>
      </header>
      <div className="app-layout">
        <CampaignList
          campaigns={campaigns}
          selected={creating ? null : selected}
          query={query}
          loading={loading}
          onQuery={setQuery}
          onSelect={(id) => {
            setCreating(false);
            setSelected(id);
          }}
          onCreate={() => {
            setCreating(true);
            setError("");
            setNotice("");
          }}
        />
        <main className="main-content">
          {error && (
            <div role="alert" className="notice error">
              {error}
              {!campaign && (
                <button
                  className="text-button"
                  onClick={() => {
                    void loadIndex();
                    setReload((value) => value + 1);
                  }}
                >
                  Retry
                </button>
              )}
            </div>
          )}
          {notice && (
            <div role="status" className="notice success">
              {notice}
            </div>
          )}
          {creating ? (
            <CreateCampaignForm
              lookups={lookups}
              prefix={prefix}
              onBack={() => setCreating(false)}
              onCreated={(id) => {
                setCreating(false);
                setSelected(id);
                void loadIndex();
              }}
            />
          ) : campaign ? (
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
                  Source:{" "}
                  {lookupName("traffic_sources", campaign.traffic_source_id)}
                </span>
              </div>
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
          ) : (
            !error && (
              <div className="empty-state">
                <Layers size={36} />
                <h1>{selected ? "Loading campaign…" : "Choose a campaign"}</h1>
                <p>Select an existing campaign or create one to get started.</p>
              </div>
            )
          )}
        </main>
      </div>
    </div>
  );
}
