import { useEffect, useRef, useState } from "react";
import { ArrowLeft, LoaderCircle } from "lucide-react";
import { api, ApiError, createCampaign, errorText } from "../api";
import type { Creation, Lookups, Offer, Operation } from "../types";
import {
  currentCreation,
  savedCreations,
  saveCreation,
  forgetCreation,
} from "../model/creationStorage";
import { CountryPicker, OfferPicker } from "./CampaignPickers";

type Props = {
  fresh?: boolean;
  lookups: Lookups;
  prefix: string;
  onBack: () => void;
  onCreated: (id: number) => void;
};

const phases: Record<string, string> = {
  validating_settings: "Checking Keitaro settings…",
  starting: "Preparing campaign…",
  creating_campaign: "Creating campaign…",
  campaign_created: "Campaign created. Preparing streams…",
  creating_stream_1: "Creating country redirect…",
  creating_stream_2: "Creating offer stream…",
  verifying_streams: "Checking campaign and both streams…",
  enabling_campaign: "Activating campaign and confirming the result…",
  complete: "Campaign confirmed.",
};

export function CreateCampaignForm({
  fresh = false,
  lookups,
  prefix,
  onBack,
  onCreated,
}: Props) {
  const [saved] = useState(() => (fresh ? null : currentCreation()));
  const [savedRequests, setSavedRequests] = useState<Creation[]>(() => {
    try {
      return savedCreations();
    } catch {
      return [];
    }
  });
  const [name, setName] = useState(saved?.name || prefix);
  const [country, setCountry] = useState(saved?.country || "AU");
  const [domain, setDomain] = useState(
    String(saved?.domain_id || lookups.domains[0]?.id || ""),
  );
  const [group, setGroup] = useState(
    String(saved?.group_id || lookups.groups[0]?.id || ""),
  );
  const [source, setSource] = useState(
    String(saved?.traffic_source_id || lookups.traffic_sources[0]?.id || ""),
  );
  // Options can arrive after the form opens; use the same defaults in the
  // controls and the submitted payload.
  const selectedDomain = domain || String(lookups.domains[0]?.id || "");
  const selectedGroup = group || String(lookups.groups[0]?.id || "");
  const selectedSource = source || String(lookups.traffic_sources[0]?.id || "");
  const [offer, setOffer] = useState<Offer | null>(
    saved
      ? { id: saved.offer_id, name: `Offer ${saved.offer_id}`, state: "active" }
      : null,
  );
  const [request, setRequest] = useState<Creation | null>(saved);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState("validating_settings");
  const [elapsed, setElapsed] = useState(0);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!busy) return;
    const started = performance.now();
    const timer = setInterval(
      () => setElapsed(Math.floor((performance.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [busy]);
  function selectRequest(value: Creation | null) {
    try {
      if (value) saveCreation(value);
      setSavedRequests(savedCreations());
      setRequest(value);
      setName(value?.name || prefix);
      setCountry(value?.country || "AU");
      setDomain(String(value?.domain_id || lookups.domains[0]?.id || ""));
      setGroup(String(value?.group_id || lookups.groups[0]?.id || ""));
      setSource(
        String(
          value?.traffic_source_id || lookups.traffic_sources[0]?.id || "",
        ),
      );
      setOffer(
        value
          ? {
              id: value.offer_id,
              name: `Offer ${value.offer_id}`,
              state: "active",
            }
          : null,
      );
      setOperation(null);
      setError("");
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function submit() {
    if (inFlight.current) return;
    inFlight.current = true;
    const payload = request || {
      name,
      country: country.trim().toUpperCase(),
      domain_id: Number(selectedDomain),
      group_id: Number(selectedGroup),
      traffic_source_id: Number(selectedSource),
      offer_id: offer!.id,
      operation_id: crypto.randomUUID(),
    };
    setRequest(payload);
    setBusy(true);
    setError("");
    setPhase("validating_settings");
    setElapsed(0);
    // Retain operation identity if the tab is closed before the remote response arrives.
    try {
      saveCreation(payload);
      const result = await createCampaign(payload, (progress) => {
        if (mounted.current) setPhase(progress.phase);
      });
      setOperation(result);
      if (result.status === "confirmed" && result.campaign_id) {
        forgetCreation(payload.operation_id);
        if (mounted.current) onCreated(result.campaign_id);
      }
    } catch (e) {
      setError(errorText(e));
      if (e instanceof ApiError && e.status === 422) {
        // A validation response alone does not prove that no remote creation exists.
        try {
          const existing = await api<Operation>(
            `/operations/${payload.operation_id}`,
          );
          setOperation(existing);
        } catch (lookupError) {
          if (lookupError instanceof ApiError && lookupError.status === 404) {
            setRequest(null);
            forgetCreation(payload.operation_id);
          }
        }
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const locked = busy || !!request;
  return (
    <section className="create-page">
      <button className="back-button" onClick={onBack} disabled={busy}>
        <ArrowLeft size={17} />
        Back to campaigns
      </button>
      <h1>New campaign</h1>
      <p className="muted">
        Choose where visitors go: one country goes to Google; everyone else goes
        to your selected offer. Create campaign publishes this setup to Keitaro.
      </p>
      {request && !busy && (
        <div className="notice warning" role="note">
          <strong>Resume previous creation: {request.name}</strong>
          <p>
            Settings are locked because this request may already exist in
            Keitaro. Resume checks and continues the same operation without
            creating a duplicate.
          </p>
          <button
            type="button"
            className="button"
            onClick={() => selectRequest(null)}
          >
            Start a new campaign
          </button>
        </div>
      )}
      {!request && savedRequests.length > 0 && (
        <details className="notice">
          <summary>
            Previous creations available to resume ({savedRequests.length})
          </summary>
          <p>
            These requests may already exist in Keitaro. Resume one to check its
            result.
          </p>
          {savedRequests.map((item) => (
            <p key={item.operation_id}>
              <button
                type="button"
                className="button"
                onClick={() => selectRequest(item)}
              >
                Resume {item.name}
              </button>{" "}
              {item.country} · {item.operation_id}
            </p>
          ))}
        </details>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="create-form"
      >
        <div>
          <label className="field-label" htmlFor="campaign-name">
            Campaign name
          </label>
          <div className="campaign-name-input">
            <span aria-hidden="true">{prefix}</span>
            <input
              id="campaign-name"
              aria-label="Campaign name"
              required
              value={name.startsWith(prefix) ? name.slice(prefix.length) : name}
              disabled={locked}
              minLength={1}
              aria-describedby="campaign-name-help"
              placeholder="campaign1"
              onChange={(e) =>
                setName(
                  prefix +
                    (e.target.value.startsWith(prefix)
                      ? e.target.value.slice(prefix.length)
                      : e.target.value),
                )
              }
            />
          </div>
        </div>
        <small id="campaign-name-help">
          The prefix is fixed. Enter a campaign name, for example demo.
        </small>
        <div>
          <span className="field-label">Country</span>
          <CountryPicker
            value={country}
            disabled={locked}
            onChange={setCountry}
          />
          <small>
            Visitors from this country go to Google. Search by name or country
            code.
          </small>
        </div>
        <div className="form-grid">
          <label>
            Domain
            <select
              aria-label="Domain"
              required
              value={selectedDomain}
              disabled={locked}
              onChange={(e) => setDomain(e.target.value)}
            >
              {lookups.domains.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
            <small>Tracking link domain.</small>
          </label>
          <label>
            Group
            <select
              aria-label="Group"
              required
              value={selectedGroup}
              disabled={locked}
              onChange={(e) => setGroup(e.target.value)}
            >
              {lookups.groups.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
            <small>Folder for the campaign in Keitaro.</small>
          </label>
          <label>
            Traffic source
            <select
              aria-label="Traffic source"
              required
              value={selectedSource}
              disabled={locked}
              onChange={(e) => setSource(e.target.value)}
            >
              {lookups.traffic_sources.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
            <small>Where this campaign’s visitors come from.</small>
          </label>
        </div>
        <div>
          <span className="field-label">Offer</span>
          <p className="stream-help">
            The destination page for visitors outside the selected country. Open
            the list to choose an available offer, or search by name or ID.
          </p>
          <OfferPicker disabled={locked} value={offer} onChange={setOffer} />
        </div>
        <div className="create-preview">
          <strong>Campaign routing</strong>
          <p>1. Visitors from {country || "the selected country"} → Google</p>
          <p>
            2. All other visitors →{" "}
            {offer ? `offer ${offer.id}` : "the selected offer"} (100%)
          </p>
        </div>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        {busy && (
          <div className="notice" role="status" aria-live="polite">
            <strong>{phases[phase] || "Checking saved creation…"}</strong>
            <p>{elapsed}s elapsed · Waiting for confirmation from Keitaro.</p>
            <small>
              You do not need to click again. The same operation is kept to
              prevent duplicates.
            </small>
          </div>
        )}
        {!busy && operation && operation.status !== "confirmed" && (
          <div className="notice warning" role="status">
            <strong>Not fully confirmed · {operation.phase}</strong>
            <p>{operation.message}</p>
            <small>
              Operation: {operation.operation_id}
              {operation.campaign_id
                ? ` · Campaign ${operation.campaign_id}`
                : ""}
            </small>
          </div>
        )}
        {(!selectedDomain || !selectedGroup || !selectedSource) && (
          <p className="muted" role="status">
            Waiting for campaign options. If the lists stay empty, return to
            campaigns and retry loading.
          </p>
        )}
        <button
          type="submit"
          className="button primary"
          disabled={
            busy ||
            (!request && (!country || !name.slice(prefix.length).trim())) ||
            !offer ||
            !selectedDomain ||
            !selectedGroup ||
            !selectedSource
          }
        >
          {busy && <LoaderCircle size={18} className="spin" />}
          {busy
            ? "Creating campaign…"
            : request
              ? "Reconcile and resume this creation"
              : "Create campaign"}
        </button>
        {request && (
          <small className="muted">
            The same operation ID is kept on retry to prevent duplicate
            campaigns.
          </small>
        )}
      </form>
    </section>
  );
}
