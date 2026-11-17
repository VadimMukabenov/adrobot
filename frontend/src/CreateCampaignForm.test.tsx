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
