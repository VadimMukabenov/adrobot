import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorText } from "../api";
import type { CampaignSummary, Lookups } from "../types";

const defaultPrefix = "test_mukabenov_";
const emptyLookups: Lookups = { domains: [], groups: [], traffic_sources: [] };

export function useCampaignIndex() {
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [lookups, setLookups] = useState<Lookups>(emptyLookups);
  const [prefix, setPrefix] = useState(defaultPrefix);
  const [query, updateQuery] = useState(defaultPrefix);
  const [selected, setSelected] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState({ list: "", metadata: "" });
  const controllerRef = useRef<AbortController | null>(null);
  const queryChanged = useRef(false);
  const setQuery = useCallback((value: string) => {
    queryChanged.current = true;
    updateQuery(value);
  }, []);
  const clearError = useCallback(
    () => setErrors({ list: "", metadata: "" }),
    [],
  );

  const loadIndex = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const options = { signal: controller.signal };
    const current = () => !controller.signal.aborted;
    setLoading(true);
    clearError();
    // Metadata must not delay the list or the campaign editor. Only the
    // preferred prefix and list depend on each other for initial selection.
    const health = api<{ campaign_prefix: string }>("/health", options)
      .then((data) => data.campaign_prefix)
      .catch(() => defaultPrefix)
      .then((preferred) => {
        if (current()) {
          setPrefix(preferred);
          if (!queryChanged.current) updateQuery(preferred);
        }
        return preferred;
      });
    const list = api<CampaignSummary[]>("/campaigns", options)
      .then((data) => {
        if (current()) setCampaigns(data);
        return data;
      })
      .catch((error) => {
        if (current())
          setErrors((previous) => ({ ...previous, list: errorText(error) }));
        return [];
      })
      .finally(() => {
        if (current()) setLoading(false);
      });
    const metadata = api<Lookups>("/lookups", options)
      .then((data) => {
        if (current()) setLookups(data);
      })
      .catch((error) => {
        if (current())
          setErrors((previous) => ({
            ...previous,
            metadata: errorText(error),
          }));
      });
    const selection = Promise.all([health, list]).then(([preferred, data]) => {
      if (current())
        setSelected(
          (id) =>
            id ?? data.find((c) => c.name.startsWith(preferred))?.id ?? null,
        );
    });
    await Promise.all([selection, metadata]);
  }, [clearError]);

  useEffect(() => {
    void loadIndex();
    return () => controllerRef.current?.abort();
  }, [loadIndex]);

  return {
    campaigns,
    lookups,
    prefix,
    query,
    setQuery,
    selected,
    setSelected,
    loading,
    error: errors.list || errors.metadata,
    clearError,
    loadIndex,
  };
}
