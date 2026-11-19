import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, errorText, post } from "../api";
import type { Campaign, Stream, StreamAction } from "../types";

type Selection = { id: number | null };
type View = {
  selection: Selection;
  campaign: Campaign | null;
  error: string;
  notice: string;
};

export function useCampaignEditor(selected: number | null) {
  const [reload, setReload] = useState(0);
  // A visit has its own identity: leaving A and returning to A must not accept
  // a write response from the earlier visit, even though the numeric ID matches.
  const selection = useMemo(() => ({ id: selected }), [selected, reload]);
  const currentSelection = useRef(selection);
  currentSelection.current = selection;
  const [view, setView] = useState<View>({
    selection,
    campaign: null,
    error: "",
    notice: "",
  });
  const [busy, setBusy] = useState<Set<number>>(new Set());
  const [refreshingIds, setRefreshingIds] = useState<Set<number>>(new Set());
  const mutations = useRef(new Map<number, number>());
  const refreshes = useRef(new Set<number>());
  const reads = useRef(0);
  const mounted = useRef(false);
  const current = (visit: Selection) =>
    mounted.current && currentSelection.current === visit;
  const currentRead = (visit: Selection, read: number) =>
    current(visit) && reads.current === read;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const read = ++reads.current;
    setView({ selection, campaign: null, error: "", notice: "" });
    if (selected !== null) {
      void (async () => {
        try {
          let campaign: Campaign;
          try {
            campaign = await api<Campaign>(`/campaigns/${selected}`, {
              signal: controller.signal,
            });
          } catch (error) {
            if (controller.signal.aborted || !currentRead(selection, read))
              return;
            if (!(error instanceof ApiError) || error.status !== 404)
              throw error;
            campaign = await post<Campaign>(`/campaigns/${selected}/fetch`);
          }
          if (!controller.signal.aborted && currentRead(selection, read)) {
            setView({ selection, campaign, error: "", notice: "" });
          }
        } catch (error) {
          if (!controller.signal.aborted && currentRead(selection, read)) {
            setView({
              selection,
              campaign: null,
              error: errorText(error),
              notice: "",
            });
          }
        }
      })();
    }
    return () => controller.abort();
  }, [selection, selected]);

  const campaign = view.selection === selection ? view.campaign : null;
  const updateView = (visit: Selection, update: (previous: View) => View) => {
    if (current(visit))
      setView((previous) =>
        previous.selection === visit ? update(previous) : previous,
      );
  };
  async function readBack(id: number, error?: string) {
    const visit = currentSelection.current;
    if (!current(visit) || visit.id !== id) return;
    // A new visit may have loaded the operation's intermediate state. Read the
    // settled server state instead of applying a response from an earlier visit.
    const read = ++reads.current;
    if (error) updateView(visit, (previous) => ({ ...previous, error }));
    try {
      const data = await api<Campaign>(`/campaigns/${id}`);
      if (currentRead(visit, read))
        updateView(visit, (previous) => ({ ...previous, campaign: data }));
    } catch (readError) {
      if (currentRead(visit, read))
        updateView(visit, (previous) => ({
          ...previous,
          error: previous.error || errorText(readError),
        }));
    }
  }
  async function refresh() {
    if (
      !current(selection) ||
      !campaign ||
      refreshes.current.has(campaign.id) ||
      [...mutations.current.values()].includes(campaign.id)
    )
      return;
    const id = campaign.id;
    const visit = selection;
    refreshes.current.add(id);
    setRefreshingIds(new Set(refreshes.current));
    updateView(visit, (previous) => ({ ...previous, error: "", notice: "" }));
    try {
      const data = await post<Campaign>(`/campaigns/${id}/fetch`);
      updateView(visit, (previous) => ({
        ...previous,
        campaign: data,
        notice: "Refreshed from Keitaro.",
      }));
    } catch (error) {
      updateView(visit, (previous) => ({
        ...previous,
        error: errorText(error),
      }));
    } finally {
      refreshes.current.delete(id);
      if (mounted.current) setRefreshingIds(new Set(refreshes.current));
    }
  }
  async function mutate(
    stream: Stream,
    action: StreamAction | "edit",
    edit?: object,
  ) {
    if (
      !current(selection) ||
      !campaign ||
      mutations.current.has(stream.id) ||
      refreshes.current.has(campaign.id)
    )
      return;
    const id = campaign.id;
    const visit = selection;
    // React state batches updates, so use a synchronous lock before the request.
    mutations.current.set(stream.id, id);
    setBusy(new Set(mutations.current.keys()));
    updateView(visit, (previous) => ({ ...previous, error: "", notice: "" }));
    try {
      const data = await post<Stream>(`/streams/${stream.id}/${action}`, {
        expected_revision: stream.revision,
        ...edit,
      });
      if (!current(visit)) {
        await readBack(id);
        return;
      }
      updateView(visit, (previous) => ({
        ...previous,
        campaign: previous.campaign && {
          ...previous.campaign,
          streams: previous.campaign.streams.map((item) =>
            item.id === data.id ? data : item,
          ),
        },
        notice:
          action === "push"
            ? "Published and confirmed in Keitaro."
            : action === "cancel"
              ? "Local changes cancelled."
              : action === "reconcile"
                ? "Remote state checked."
                : "Draft saved locally.",
      }));
    } catch (error) {
      // Read back uncertain outcomes; never retry the write automatically.
      await readBack(id, errorText(error));
    } finally {
      mutations.current.delete(stream.id);
      if (mounted.current) setBusy(new Set(mutations.current.keys()));
    }
  }
  return {
    campaign,
    busy: new Set(
      [...busy].filter((id) => mutations.current.get(id) === selected),
    ),
    refreshing: selected !== null && refreshingIds.has(selected),
    error: view.selection === selection ? view.error : "",
    notice: view.selection === selection ? view.notice : "",
    refresh,
    mutate,
    retry: () => setReload((value) => value + 1),
  };
}
