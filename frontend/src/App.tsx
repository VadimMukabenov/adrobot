import { useCallback, useState } from "react";
import { Layers } from "lucide-react";
import { CampaignList } from "./components/CampaignList";
import { CreateCampaignForm } from "./components/CreateCampaignForm";
import { CampaignWorkspace } from "./components/CampaignWorkspace";
import { SetupConnection, type AppMode } from "./components/SetupConnection";
import { useCampaignIndex } from "./model/useCampaignIndex";
import { useCampaignEditor } from "./model/useCampaignEditor";

export default function App() {
  const [mode, setMode] = useState<AppMode | null>(null);
  const connected = useCallback((mode: AppMode) => setMode(mode), []);
  return mode ? (
    <CampaignApp mode={mode} />
  ) : (
    <SetupConnection onConnected={connected} />
  );
}

function CampaignApp({ mode }: { mode: AppMode }) {
  const index = useCampaignIndex();
  const {
    campaigns,
    lookups,
    prefix,
    query,
    setQuery,
    selected,
    setSelected,
    loading,
    loadIndex,
  } = index;
  const [creating, setCreating] = useState(false);
  const [creationKey, setCreationKey] = useState(0);
  const editor = useCampaignEditor(creating ? null : selected);
  const { campaign, busy, refreshing, notice, refresh, mutate, retry } = editor;
  const error = index.error || editor.error;
  const indexedCampaign = campaigns.find((item) => item.id === campaign?.id);
  const visitorSource =
    indexedCampaign &&
    (indexedCampaign.visitor_url_observed_at || "") >=
      (campaign?.visitor_url_observed_at || "")
      ? indexedCampaign
      : campaign;
  return (
    <div className="app">
      <header className="app-header">
        <strong>Adrobot</strong>
        <span>Keitaro campaign editor</span>
      </header>
      {mode === "demo" && (
        <div className="demo-banner" role="note" aria-label="Local demo mode">
          <strong>Local demo</strong> · Sample data stored on this server. No
          changes are sent to external Keitaro.
        </div>
      )}
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
            setCreationKey((value) => value + 1);
            setCreating(true);
          }}
        />
        <main className="main-content">
          {error && (
            <div role="alert" className="notice error">
              {error}
              {(index.error || !campaign) && (
                <button
                  className="text-button"
                  onClick={() => {
                    void loadIndex();
                    retry();
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
              key={creationKey}
              fresh
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
            <CampaignWorkspace
              campaign={{
                ...campaign,
                visitor_url: visitorSource?.visitor_url,
              }}
              lookups={lookups}
              prefix={prefix}
              busy={busy}
              refreshing={refreshing}
              refresh={refresh}
              mutate={mutate}
            />
          ) : (
            !error && (
              <div className="empty-state">
                <Layers size={36} />
                <h1>{selected ? "Loading campaign…" : "Choose a campaign"}</h1>
                <p>
                  Choose a campaign on the left to change how its traffic is
                  split between offers (destination pages). New campaign creates
                  a country redirect to Google and an offer for all other
                  visitors.
                </p>
              </div>
            )
          )}
        </main>
      </div>
    </div>
  );
}
