import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CreateCampaignForm } from "./components/CreateCampaignForm";

const lookups = {
  domains: [{ id: 1, name: "demo.example" }],
  groups: [{ id: 2, name: "Tests" }],
  traffic_sources: [{ id: 3, name: "Demo" }],
};
const pending = {
  name: "test_demo_saved",
  country: "CA",
  domain_id: 1,
  group_id: 2,
  traffic_source_id: 3,
  offer_id: 20,
  operation_id: "saved-operation-12345",
};
beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

it("shows immediate creation progress and reads streamed phases without early success", async () => {
  localStorage.setItem("adrobot.creation", JSON.stringify(pending));
  const onCreated = vi.fn();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(stream, {
        headers: { "Content-Type": "application/x-ndjson" },
      }),
    ),
  );
  render(
    <CreateCampaignForm
      lookups={lookups}
      prefix="test_demo_"
      onBack={vi.fn()}
      onCreated={onCreated}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: /reconcile and resume/i }),
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "Checking Keitaro settings",
  );
  expect(onCreated).not.toHaveBeenCalled();
  const send = (type: string, phase: string, status = "running") =>
    controller.enqueue(
      new TextEncoder().encode(
        JSON.stringify({
          type,
          operation: {
            operation_id: pending.operation_id,
            phase,
            status,
            campaign_id: 81,
          },
        }) + "\n",
      ),
    );
  send("progress", "creating_stream_1");
  await screen.findByText(/Creating country redirect/);
  expect(onCreated).not.toHaveBeenCalled();
  expect(
    JSON.parse(localStorage.getItem("adrobot.creation")!).operation_id,
  ).toBe(pending.operation_id);
  send("result", "complete", "confirmed");
  controller.close();
  await waitFor(() => expect(onCreated).toHaveBeenCalledExactlyOnceWith(81));
  expect(localStorage.getItem("adrobot.creation")).toBeNull();
});

it("recovers the same unfinished creation after a page reload without auto publishing", () => {
  localStorage.setItem("adrobot.creation", JSON.stringify(pending));
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  render(
    <CreateCampaignForm
      lookups={lookups}
      prefix="test_demo_"
      onBack={vi.fn()}
      onCreated={vi.fn()}
    />,
  );
  expect(screen.getByLabelText("Campaign name")).toHaveValue("test_demo_saved");
  expect(
    screen.getByRole("button", { name: /reconcile and resume/i }),
  ).toBeEnabled();
  expect(fetch).not.toHaveBeenCalled();
});

it("keeps the operation after an interrupted progress stream and never repeats the POST", async () => {
  localStorage.setItem("adrobot.creation", JSON.stringify(pending));
  const onCreated = vi.fn();
  const event =
    JSON.stringify({
      type: "progress",
      operation: {
        operation_id: pending.operation_id,
        status: "running",
        phase: "creating_campaign",
      },
    }) + "\n";
  const fetch = vi.fn().mockResolvedValue(
    new Response(event, {
      headers: { "Content-Type": "application/x-ndjson" },
    }),
  );
  vi.stubGlobal("fetch", fetch);
  render(
    <CreateCampaignForm
      lookups={lookups}
      prefix="test_demo_"
      onBack={vi.fn()}
      onCreated={onCreated}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: /reconcile and resume/i }),
  );
  await screen.findByRole("alert");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(onCreated).not.toHaveBeenCalled();
  expect(
    JSON.parse(localStorage.getItem("adrobot.creation")!).operation_id,
  ).toBe(pending.operation_id);
  expect(
    screen.getByRole("button", { name: /reconcile and resume/i }),
  ).toBeEnabled();
});

it("does not navigate an old form after the user leaves during creation", async () => {
  localStorage.setItem("adrobot.creation", JSON.stringify(pending));
  let finish!: (value: Response) => void;
  const onCreated = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
    ),
  );
  const form = render(
    <CreateCampaignForm
      lookups={lookups}
      prefix="test_demo_"
      onBack={vi.fn()}
      onCreated={onCreated}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: /reconcile and resume/i }),
  );
  form.unmount();
  finish(
    new Response(JSON.stringify({ status: "confirmed", campaign_id: 81 })),
  );
  await waitFor(() =>
    expect(localStorage.getItem("adrobot.creation")).toBeNull(),
  );
  expect(onCreated).not.toHaveBeenCalled();
});

it("unlocks the form after server validation failure so input can be corrected", async () => {
  localStorage.setItem("adrobot.creation", JSON.stringify(pending));
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: "Invalid country" }), {
          status: 422,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: "Not found" }), { status: 404 }),
      ),
  );
  render(
    <CreateCampaignForm
      lookups={lookups}
      prefix="test_demo_"
      onBack={vi.fn()}
      onCreated={vi.fn()}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: /reconcile and resume/i }),
  );
  await waitFor(() =>
    expect(screen.getByLabelText("Campaign name")).toBeEnabled(),
  );
  expect(screen.getByRole("alert")).toHaveTextContent("Invalid country");
  expect(localStorage.getItem("adrobot.creation")).toBeNull();
});

it("retains an existing operation after validation error instead of starting another campaign", async () => {
  localStorage.setItem("adrobot.creation", JSON.stringify(pending));
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "Offer unavailable" }), {
        status: 422,
      }),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          operation_id: pending.operation_id,
          status: "uncertain",
          phase: "campaign_created",
          campaign_id: 8,
        }),
        { status: 200 },
      ),
    );
  vi.stubGlobal("fetch", fetch);
  render(
    <CreateCampaignForm
      lookups={lookups}
      prefix="test_demo_"
      onBack={vi.fn()}
      onCreated={vi.fn()}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: /reconcile and resume/i }),
  );
  await screen.findByText(/campaign_created/);
  expect(screen.getByLabelText("Campaign name")).toBeDisabled();
  expect(
    JSON.parse(localStorage.getItem("adrobot.creation")!).operation_id,
  ).toBe(pending.operation_id);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("uses options that arrive after opening the form when creating a campaign", async () => {
  const onCreated = vi.fn();
  let submitted: unknown;
  vi.stubGlobal("fetch", async (url: string, options?: RequestInit) => {
    if (url === "/api/offers?q=20")
      return new Response(
        JSON.stringify([{ id: 20, name: "Demo offer", state: "active" }]),
      );
    if (url === "/api/campaigns" && options?.method === "POST") {
      submitted = JSON.parse(String(options.body));
      return new Response(
        JSON.stringify({ status: "confirmed", campaign_id: 81 }),
      );
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  const props = { prefix: "test_demo_", onBack: vi.fn(), onCreated };
  const { rerender } = render(
    <CreateCampaignForm
      {...props}
      lookups={{ domains: [], groups: [], traffic_sources: [] }}
    />,
  );
  fireEvent.change(screen.getByLabelText("Campaign name"), {
    target: { value: "test_demo_launch" },
  });
  rerender(<CreateCampaignForm {...props} lookups={lookups} />);
  fireEvent.change(
    screen.getByRole("combobox", { name: "Search offers by ID or name" }),
    { target: { value: "20" } },
  );
  fireEvent.click(await screen.findByRole("option", { name: /Demo offer/ }));
  fireEvent.click(screen.getByRole("button", { name: "Select offer" }));
  const create = screen.getByRole("button", { name: "Create campaign" });
  expect(create).toBeEnabled();
  fireEvent.click(create);
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith(81));
  expect(submitted).toMatchObject({
    name: "test_demo_launch",
    country: "AU",
    domain_id: 1,
    group_id: 2,
    traffic_source_id: 3,
    offer_id: 20,
  });
});

it("does not clear a newer saved creation when an unmounted older request confirms", async () => {
  localStorage.setItem("adrobot.creation", JSON.stringify(pending));
  let finish!: (value: Response) => void;
  const fetch = vi.fn().mockReturnValue(
    new Promise<Response>((resolve) => {
      finish = resolve;
    }),
  );
  vi.stubGlobal("fetch", fetch);
  const form = render(
    <CreateCampaignForm
      lookups={lookups}
      prefix="test_demo_"
      onBack={vi.fn()}
      onCreated={vi.fn()}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: /reconcile and resume/i }),
  );
  form.unmount();
  const newer = {
    ...pending,
    name: "test_demo_new",
    operation_id: "newer-operation-12345",
  };
  localStorage.setItem("adrobot.creation", JSON.stringify(newer));
  finish(
    new Response(JSON.stringify({ status: "confirmed", campaign_id: 81 })),
  );
  await waitFor(() =>
    expect(
      JSON.parse(localStorage.getItem("adrobot.creation")!).operation_id,
    ).toBe(newer.operation_id),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(
    JSON.parse(localStorage.getItem("adrobot.creation")!).operation_id,
  ).toBe(newer.operation_id);
});

it("does not send a new creation when saving its recovery identity fails", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  localStorage.setItem("adrobot.creation", JSON.stringify(pending));
  render(
    <CreateCampaignForm
      lookups={lookups}
      prefix="test_demo_"
      onBack={vi.fn()}
      onCreated={vi.fn()}
    />,
  );
  const write = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new Error("Storage full");
    });
  fireEvent.click(
    screen.getByRole("button", { name: /reconcile and resume/i }),
  );
  await screen.findByRole("alert");
  expect(fetch).not.toHaveBeenCalled();
  expect(
    JSON.parse(localStorage.getItem("adrobot.creation")!).operation_id,
  ).toBe(pending.operation_id);
  write.mockRestore();
});
