import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CreateCampaignForm } from "./components/CreateCampaignForm";
const lookups = {
  domains: [{ id: 1, name: "demo.example" }],
  groups: [{ id: 2, name: "Tests" }],
  traffic_sources: [{ id: 3, name: "Demo" }],
};
const offers = [{ id: 18813, name: "Flexacil Peru", state: "active" }];
let submitted: Record<string, unknown> | undefined;
beforeEach(() => {
  localStorage.clear();
  submitted = undefined;
  vi.stubGlobal("fetch", async (url: string, options?: RequestInit) => {
    if (url.startsWith("/api/offers"))
      return new Response(JSON.stringify(offers));
    if (url === "/api/campaigns") {
      submitted = JSON.parse(String(options?.body));
      return new Response(
        JSON.stringify({ status: "confirmed", campaign_id: 81 }),
      );
    }
    throw new Error(`Unexpected request: ${url}`);
  });
});
afterEach(() => vi.unstubAllGlobals());
function form() {
  return render(
    <CreateCampaignForm
      fresh
      lookups={lookups}
      prefix="test_mukabenov_"
      onBack={vi.fn()}
      onCreated={vi.fn()}
    />,
  );
}
it("browses existing offers without knowing their names or IDs and selects directly", async () => {
  form();
  fireEvent.focus(screen.getByRole("combobox", { name: "Offer" }));
  fireEvent.click(
    await screen.findByRole("option", { name: /18813.*Flexacil Peru/ }),
  );
  expect(screen.getByRole("combobox", { name: "Offer" })).toHaveValue(
    "18813 · Flexacil Peru",
  );
  expect(
    screen.queryByRole("button", { name: "Select offer" }),
  ).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Campaign name"), {
    target: { value: "launch" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create campaign" }));
  await waitFor(() =>
    expect(submitted).toMatchObject({
      name: "test_mukabenov_launch",
      offer_id: 18813,
    }),
  );
});
it("searches countries by Russian name and sends the selected ISO code", async () => {
  form();
  const country = screen.getByRole("combobox", { name: "Country" });
  fireEvent.change(country, { target: { value: "Нидер" } });
  fireEvent.click(screen.getByRole("option", { name: "Нидерланды (NL)" }));
  expect(country).toHaveValue("Нидерланды (NL)");
  fireEvent.change(screen.getByLabelText("Campaign name"), {
    target: { value: "netherlands" },
  });
  fireEvent.focus(screen.getByRole("combobox", { name: "Offer" }));
  fireEvent.click(await screen.findByRole("option", { name: /Flexacil Peru/ }));
  fireEvent.click(screen.getByRole("button", { name: "Create campaign" }));
  await waitFor(() =>
    expect(submitted).toMatchObject({
      country: "NL",
      name: "test_mukabenov_netherlands",
    }),
  );
});
it("keeps the prefix outside the editable name and prevents empty names", () => {
  form();
  expect(screen.getByLabelText("Campaign name")).toHaveValue("");
  expect(screen.getByText("test_mukabenov_", { exact: true })).toBeVisible();
  fireEvent.focus(screen.getByRole("combobox", { name: "Country" }));
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Country" }), {
    key: "Escape",
  });
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Create campaign" }),
  ).toBeDisabled();
});
it("supports country code and English-name keyboard selection without submitting the form", () => {
  form();
  const country = screen.getByRole("combobox", { name: "Country" });
  fireEvent.change(country, { target: { value: "Germany" } });
  fireEvent.keyDown(country, { key: "Enter" });
  expect(country).toHaveValue("Германия (DE)");
  fireEvent.change(country, { target: { value: "SG" } });
  fireEvent.keyDown(country, { key: "Enter" });
  expect(country).toHaveValue("Сингапур (SG)");
  expect(submitted).toBeUndefined();
});

it("invalidates the previous offer when searching and allows retrying a failed list", async () => {
  let fail = false;
  vi.stubGlobal("fetch", async () =>
    fail
      ? new Response(JSON.stringify({ detail: "Keitaro unavailable" }), {
          status: 502,
        })
      : new Response(JSON.stringify(offers)),
  );
  form();
  fireEvent.change(screen.getByLabelText("Campaign name"), {
    target: { value: "retry" },
  });
  const offer = screen.getByRole("combobox", { name: "Offer" });
  fireEvent.focus(offer);
  fireEvent.click(await screen.findByRole("option", { name: /Flexacil Peru/ }));
  expect(screen.getByRole("button", { name: "Create campaign" })).toBeEnabled();
  fail = true;
  fireEvent.change(offer, { target: { value: "missing" } });
  expect(
    screen.getByRole("button", { name: "Create campaign" }),
  ).toBeDisabled();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Keitaro unavailable",
  );
  fireEvent.blur(offer);
  fail = false;
  fireEvent.focus(offer);
  fireEvent.click(await screen.findByRole("option", { name: /Flexacil Peru/ }));
  expect(screen.getByRole("button", { name: "Create campaign" })).toBeEnabled();
});

it("selects exact ISO codes rather than countries whose names contain those letters", () => {
  form();
  const country = screen.getByRole("combobox", { name: "Country" });
  for (const [code, label] of [
    ["DE", "Германия"],
    ["RU", "Россия"],
    ["US", "Соединенные Штаты"],
    ["CA", "Канада"],
  ]) {
    fireEvent.change(country, { target: { value: code } });
    expect(
      within(screen.getByRole("listbox", { name: "Country" })).getAllByRole(
        "option",
      ),
    ).toHaveLength(1);
    fireEvent.keyDown(country, { key: "Enter" });
    expect(country).toHaveValue(`${label} (${code})`);
  }
});

it("ignores an older offer response that arrives after a newer search", async () => {
  let resolveOld!: (response: Response) => void;
  const fetcher = vi.fn(async (url: string) =>
    url.endsWith("q=old")
      ? new Promise<Response>((resolve) => {
          resolveOld = resolve;
        })
      : new Response(
          JSON.stringify([{ id: 22, name: "New result", state: "active" }]),
        ),
  );
  vi.stubGlobal("fetch", fetcher);
  form();
  const offer = screen.getByRole("combobox", { name: "Offer" });
  fireEvent.change(offer, { target: { value: "old" } });
  await waitFor(() => expect(fetcher).toHaveBeenCalled());
  fireEvent.change(offer, { target: { value: "new" } });
  await screen.findByRole("option", { name: /New result/ });
  await act(async () => {
    resolveOld(
      new Response(
        JSON.stringify([{ id: 11, name: "Old result", state: "active" }]),
      ),
    );
  });
  expect(
    screen.queryByRole("option", { name: /Old result/ }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("option", { name: /New result/ }));
  expect(offer).toHaveValue("22 · New result");
});
