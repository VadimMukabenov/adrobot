import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import App from "./App";
import type { Campaign } from "./types";

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
const lookups = { domains: [], groups: [], traffic_sources: [] };
const campaign = (id: number, revision = 1): Campaign => ({
  id,
  name: `test_mukabenov_${id}`,
  domain_id: 1,
  group_id: 2,
  traffic_source_id: 3,
  available: true,
  writable: true,
  streams: [
    {
      id: id * 10,
      name: "Offers",
      revision,
      dirty: true,
      editable: true,
      available: true,
      status: "ready",
      messages: [],
      total: 100,
      offers: [
        {
          offer_id: 1,
          name: "Product",
          share: 100,
          pinned: false,
          removed: false,
          available: true,
        },
      ],
    },
  ],
});
function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function serve(
  override?: (
    url: string,
    options?: RequestInit,
  ) => Promise<Response> | undefined,
) {
  const fetch = vi.fn((url: string, options?: RequestInit) => {
    const custom = override?.(url, options);
    if (custom) return custom;
    if (url === "/api/connection")
      return Promise.resolve(
        response({ configured: true, url: "https://tracker.example" }),
      );
    if (url === "/api/health")
      return Promise.resolve(response({ campaign_prefix: "test_mukabenov_" }));
    if (url === "/api/campaigns")
      return Promise.resolve(response([campaign(1), campaign(2)]));
    if (url === "/api/lookups") return Promise.resolve(response(lookups));
    if (url === "/api/campaigns/1")
      return Promise.resolve(response(campaign(1)));
    if (url === "/api/campaigns/2")
      return Promise.resolve(response(campaign(2)));
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

it("shows campaign choices while unrelated metadata is still loading", async () => {
  const metadata = deferred();
  serve((url) => (url === "/api/lookups" ? metadata.promise : undefined));
  render(<App />);
  expect(
    await screen.findByRole("button", { name: "test_mukabenov_2" }),
  ).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "New campaign" }));
  expect(screen.getByText(/Waiting for campaign options/)).toBeInTheDocument();
  await act(async () => metadata.resolve(response(lookups)));
});

it("does not replace a search typed before the index response arrives", async () => {
  const health = deferred();
  serve((url) => (url === "/api/health" ? health.promise : undefined));
  render(<App />);
  const search = await screen.findByRole("textbox", {
    name: "Search campaigns",
  });
  fireEvent.change(search, { target: { value: "my search" } });
  await act(async () =>
    health.resolve(response({ campaign_prefix: "test_mukabenov_" })),
  );
  expect(search).toHaveValue("my search");
});

it("does not show an old refresh failure on another campaign", async () => {
  const refresh = deferred();
  serve((url) =>
    url === "/api/campaigns/1/fetch" ? refresh.promise : undefined,
  );
  render(<App />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Refresh from Keitaro" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "test_mukabenov_2" }));
  await screen.findByRole("heading", { name: "test_mukabenov_2" });
  await act(async () =>
    refresh.resolve(response({ detail: "Old refresh failed" }, 502)),
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Refresh from Keitaro" }),
  ).toBeEnabled();
});

it("does not show an old mutation failure or reload it into a new campaign", async () => {
  const mutation = deferred();
  const fetch = serve((url) =>
    url === "/api/streams/10/push" ? mutation.promise : undefined,
  );
  render(<App />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Push to Keitaro" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "test_mukabenov_2" }));
  await screen.findByRole("heading", { name: "test_mukabenov_2" });
  await act(async () =>
    mutation.resolve(response({ detail: "Old write failed" }, 502)),
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(
    fetch.mock.calls.filter(([url]) => url === "/api/campaigns/1"),
  ).toHaveLength(1);
});

it("ignores a mutation success after leaving and returning to the same campaign", async () => {
  const mutation = deferred();
  let loads = 0;
  serve((url) => {
    if (url === "/api/streams/10/push") return mutation.promise;
    if (url === "/api/campaigns/1")
      return Promise.resolve(response(campaign(1, ++loads)));
  });
  render(<App />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Push to Keitaro" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "test_mukabenov_2" }));
  await screen.findByRole("heading", { name: "test_mukabenov_2" });
  fireEvent.click(screen.getByRole("button", { name: "test_mukabenov_1" }));
  await screen.findByRole("heading", { name: "test_mukabenov_1" });
  await act(async () =>
    mutation.resolve(response({ ...campaign(1).streams[0], dirty: false })),
  );
  expect(screen.getByRole("button", { name: "Push to Keitaro" })).toBeEnabled();
  expect(screen.getByText("Unpublished changes")).toBeInTheDocument();
  expect(
    screen.queryByText("Published and confirmed in Keitaro."),
  ).not.toBeInTheDocument();
});

it.each(["success", "failure"])(
  "reads settled state after returning to a campaign with a pending push (%s)",
  async (outcome) => {
    const mutation = deferred();
    const readBack = deferred();
    let reads = 0;
    const fetch = serve((url) => {
      if (url === "/api/streams/10/push") return mutation.promise;
      if (url === "/api/campaigns/1") {
        if (++reads === 3) return readBack.promise;
        const data = campaign(1, reads);
        if (reads === 2) data.streams[0].status = "pushing";
        return Promise.resolve(response(data));
      }
    });
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Push to Keitaro" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "test_mukabenov_2" }));
    await screen.findByRole("heading", { name: "test_mukabenov_2" });
    fireEvent.click(screen.getByRole("button", { name: "test_mukabenov_1" }));
    await screen.findByText("Publication is running. Editing is locked.");
    await act(async () =>
      mutation.resolve(
        outcome === "success"
          ? response({ ...campaign(1).streams[0], dirty: false })
          : response({ detail: "Response lost" }, 502),
      ),
    );
    await waitFor(() => expect(reads).toBe(3));
    expect(
      screen.getByRole("button", { name: "Push to Keitaro" }),
    ).toHaveAttribute("aria-busy", "true");
    expect(
      screen.getByRole("button", { name: "Refresh from Keitaro" }),
    ).toBeDisabled();
    const settled = campaign(1, 3);
    settled.streams[0].status = outcome === "success" ? "ready" : "uncertain";
    settled.streams[0].dirty = outcome !== "success";
    await act(async () => readBack.resolve(response(settled)));
    expect(
      screen.queryByText("Publication is running. Editing is locked."),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Push to Keitaro" }),
    ).toHaveAttribute("aria-busy", "false");
    expect(
      screen.getByRole("button", { name: "Refresh from Keitaro" }),
    ).toBeEnabled();
    if (outcome === "success") {
      expect(screen.queryByText("Unpublished changes")).not.toBeInTheDocument();
      expect(
        screen.queryByText("Published and confirmed in Keitaro."),
      ).not.toBeInTheDocument();
    } else {
      expect(screen.getByRole("button", { name: "Reconcile" })).toBeEnabled();
      expect(screen.getByRole("alert")).toHaveTextContent("Response lost");
    }
    expect(
      fetch.mock.calls.filter(([url]) => url === "/api/streams/10/push"),
    ).toHaveLength(1);
  },
);

it.each([200, 404])(
  "does not let an earlier campaign read (%s) overwrite settled push read-back",
  async (status) => {
    const mutation = deferred();
    const returningRead = deferred();
    let reads = 0;
    serve((url) => {
      if (url === "/api/streams/10/push") return mutation.promise;
      if (url === "/api/campaigns/1") {
        if (++reads === 2) return returningRead.promise;
        const data = campaign(1, reads);
        if (reads === 3) data.streams[0].dirty = false;
        return Promise.resolve(response(data));
      }
    });
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Push to Keitaro" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "test_mukabenov_2" }));
    await screen.findByRole("heading", { name: "test_mukabenov_2" });
    fireEvent.click(screen.getByRole("button", { name: "test_mukabenov_1" }));
    await waitFor(() => expect(reads).toBe(2));
    await act(async () => mutation.resolve(response(campaign(1).streams[0])));
    await screen.findByRole("heading", { name: "test_mukabenov_1" });
    expect(screen.queryByText("Unpublished changes")).not.toBeInTheDocument();
    const stale = campaign(1, 2);
    stale.streams[0].status = "pushing";
    await act(async () =>
      returningRead.resolve(
        response(status === 200 ? stale : { detail: "Not found" }, status),
      ),
    );
    expect(
      screen.queryByText("Publication is running. Editing is locked."),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Unpublished changes")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  },
);

it("ignores settled push read-back after navigating to another campaign", async () => {
  const mutation = deferred();
  const readBack = deferred();
  let reads = 0;
  serve((url) => {
    if (url === "/api/streams/10/push") return mutation.promise;
    if (url === "/api/campaigns/1" && ++reads === 3) return readBack.promise;
  });
  render(<App />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Push to Keitaro" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "test_mukabenov_2" }));
  await screen.findByRole("heading", { name: "test_mukabenov_2" });
  fireEvent.click(screen.getByRole("button", { name: "test_mukabenov_1" }));
  await screen.findByRole("heading", { name: "test_mukabenov_1" });
  await act(async () => mutation.resolve(response(campaign(1).streams[0])));
  await waitFor(() => expect(reads).toBe(3));
  fireEvent.click(screen.getByRole("button", { name: "test_mukabenov_2" }));
  await screen.findByRole("heading", { name: "test_mukabenov_2" });
  await act(async () => readBack.resolve(response(campaign(1))));
  expect(
    screen.getByRole("heading", { name: "test_mukabenov_2" }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Refresh from Keitaro" }),
  ).toBeEnabled();
});

it("sends only one mutation when two events happen before controls re-render", async () => {
  const mutation = deferred();
  const fetch = serve((url) =>
    url === "/api/streams/10/push" ? mutation.promise : undefined,
  );
  render(<App />);
  const push = await screen.findByRole("button", { name: "Push to Keitaro" });
  act(() => {
    push.click();
    push.click();
  });
  expect(
    fetch.mock.calls.filter(([url]) => url === "/api/streams/10/push"),
  ).toHaveLength(1);
  await act(async () =>
    mutation.resolve(response({ ...campaign(1).streams[0], dirty: false })),
  );
  expect(
    screen.getByRole("button", { name: "Push to Keitaro" }),
  ).toBeDisabled();
});

it("does not import a campaign after its aborted read returns 404", async () => {
  const read = deferred();
  const fetch = serve((url) =>
    url === "/api/campaigns/1" ? read.promise : undefined,
  );
  render(<App />);
  await waitFor(() =>
    expect(fetch.mock.calls.some(([url]) => url === "/api/campaigns/1")).toBe(
      true,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "test_mukabenov_2" }));
  await screen.findByRole("heading", { name: "test_mukabenov_2" });
  await act(async () => read.resolve(response({ detail: "Not found" }, 404)));
  expect(
    fetch.mock.calls.some(([url]) => url === "/api/campaigns/1/fetch"),
  ).toBe(false);
});

it.each(["live", undefined, "future-mode"])(
  "treats connection mode %s as live",
  async (mode) => {
    serve((url) =>
      url === "/api/connection"
        ? Promise.resolve(
            response({
              configured: true,
              url: "https://tracker.example",
              mode,
            }),
          )
        : undefined,
    );
    render(<App />);
    await screen.findByRole("heading", { name: "test_mukabenov_1" });
    expect(screen.queryByText(/Local demo/)).not.toBeInTheDocument();
  },
);

it("labels configured demo mode without opening credential setup", async () => {
  serve((url) =>
    url === "/api/connection"
      ? Promise.resolve(response({ configured: true, url: "", mode: "demo" }))
      : undefined,
  );
  render(<App />);
  await screen.findByRole("heading", { name: "test_mukabenov_1" });
  expect(
    screen.getByRole("note", { name: "Local demo mode" }),
  ).toHaveTextContent(/sample data.*no.*external Keitaro/i);
  expect(screen.queryByLabelText("Admin API key")).not.toBeInTheDocument();
});

it("keeps a newer index when an earlier reload finishes last", async () => {
  localStorage.setItem(
    "adrobot.creation",
    JSON.stringify({
      name: "test_mukabenov_new",
      country: "AU",
      domain_id: 1,
      group_id: 2,
      traffic_source_id: 3,
      offer_id: 1,
      operation_id: "creation-in-progress-123",
    }),
  );
  const oldIndex = deferred();
  let indexes = 0;
  let createdReads = 0;
  serve((url, options) => {
    if (url === "/api/lookups")
      return Promise.resolve(
        response({
          domains: [{ id: 1, name: "Domain" }],
          groups: [{ id: 2, name: "Group" }],
          traffic_sources: [{ id: 3, name: "Source" }],
        }),
      );
    if (url === "/api/campaigns" && options?.method === "POST")
      return Promise.resolve(response({ status: "confirmed", campaign_id: 3 }));
    if (url === "/api/campaigns") {
      indexes++;
      if (indexes === 2) return oldIndex.promise;
      if (indexes === 3) return Promise.resolve(response([campaign(3)]));
    }
    if (url === "/api/campaigns/3")
      return Promise.resolve(
        ++createdReads === 1
          ? response({ detail: "Temporary read failure" }, 502)
          : response(campaign(3)),
      );
  });
  render(<App />);
  await screen.findByRole("heading", { name: "test_mukabenov_1" });
  fireEvent.click(screen.getByRole("button", { name: "New campaign" }));
  fireEvent.click(screen.getByRole("button", { name: /Reconcile and resume/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
  await screen.findByRole("button", { name: "test_mukabenov_3" });
  await act(async () => oldIndex.resolve(response([campaign(1)])));
  expect(
    screen.getByRole("button", { name: "test_mukabenov_3" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "test_mukabenov_1" }),
  ).not.toBeInTheDocument();
  localStorage.clear();
});

it("ignores a late campaign read after selecting another campaign", async () => {
  const read = deferred();
  const fetch = serve((url) =>
    url === "/api/campaigns/1" ? read.promise : undefined,
  );
  render(<App />);
  await waitFor(() =>
    expect(fetch.mock.calls.some(([url]) => url === "/api/campaigns/1")).toBe(
      true,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "test_mukabenov_2" }));
  await screen.findByRole("heading", { name: "test_mukabenov_2" });
  await act(async () => read.resolve(response(campaign(1))));
  expect(
    screen.getByRole("heading", { name: "test_mukabenov_2" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "test_mukabenov_1" }),
  ).not.toBeInTheDocument();
});

it("keeps an in-flight mutation on another campaign from blocking the current refresh", async () => {
  const mutation = deferred();
  serve((url) =>
    url === "/api/streams/10/push" ? mutation.promise : undefined,
  );
  render(<App />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Push to Keitaro" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "test_mukabenov_2" }));
  await screen.findByRole("heading", { name: "test_mukabenov_2" });
  expect(
    screen.getByRole("button", { name: "Refresh from Keitaro" }),
  ).toBeEnabled();
  await act(async () => mutation.resolve(response(campaign(1).streams[0])));
});

it("offers a metadata retry while keeping an already loaded campaign usable", async () => {
  let metadataReads = 0;
  serve((url) =>
    url === "/api/lookups"
      ? Promise.resolve(
          ++metadataReads === 1
            ? response({ detail: "Options unavailable" }, 502)
            : response({
                domains: [{ id: 1, name: "Recovered domain" }],
                groups: [],
                traffic_sources: [],
              }),
        )
      : undefined,
  );
  render(<App />);
  await screen.findByRole("heading", { name: "test_mukabenov_1" });
  expect(screen.getByRole("alert")).toHaveTextContent("Options unavailable");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText("Domain: Recovered domain");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("reads back an uncertain mutation without automatically repeating the write", async () => {
  let reads = 0;
  const fetch = serve((url) => {
    if (url === "/api/campaigns/1") {
      const data = campaign(1);
      if (++reads > 1) {
        data.streams[0].status = "uncertain";
        data.streams[0].messages = [
          "Check remote state before publishing again.",
        ];
      }
      return Promise.resolve(response(data));
    }
    if (url === "/api/streams/10/push")
      return Promise.reject(new Error("Response lost"));
  });
  render(<App />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Push to Keitaro" }),
  );
  await screen.findByRole("button", { name: "Reconcile" });
  expect(screen.getByRole("alert")).toHaveTextContent("Response lost");
  expect(
    screen.getByRole("button", { name: "Push to Keitaro" }),
  ).toBeDisabled();
  expect(
    fetch.mock.calls.filter(([url]) => url === "/api/streams/10/push"),
  ).toHaveLength(1);
  expect(
    fetch.mock.calls.filter(([url]) => url === "/api/campaigns/1"),
  ).toHaveLength(2);
});
