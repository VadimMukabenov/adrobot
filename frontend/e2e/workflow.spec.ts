import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

const trackerURL = `http://127.0.0.1:${process.env.ADROBOT_E2E_TRACKER_PORT || 18781}`;
type RemoteOffer = { offer_id: number; share: number; state: string };
type RemoteStream = {
  id: number;
  campaign_id: number;
  name: string;
  position: number;
  offers: RemoteOffer[];
  filters?: unknown[];
  action_options?: { url: string };
};
type RemoteState = {
  campaigns: {
    id: number;
    name: string;
    state: string;
    domain_id: number;
    group_id: string;
    traffic_source_id: number;
    alias: string;
  }[];
  streams: RemoteStream[];
  events: { method: string; path: string; id: number; body: unknown }[];
};
async function remote(request: APIRequestContext): Promise<RemoteState> {
  const response = await request.get(`${trackerURL}/__state`);
  expect(response.ok()).toBeTruthy();
  return response.json();
}
async function control(request: APIRequestContext, data: object) {
  const response = await request.post(`${trackerURL}/__control`, { data });
  expect(response.ok()).toBeTruthy();
}
async function open(page: Page, request: APIRequestContext) {
  const response = await request.get("/api/connection");
  const connection = await response.json();
  await page.goto("/");
  if (!connection.configured) {
    await expect(
      page.getByRole("heading", { name: "Connect to Keitaro" }),
    ).toBeVisible();
    await expect(page.getByLabel("Keitaro URL", { exact: true })).toHaveValue(
      trackerURL,
    );
    await page
      .getByLabel("Admin API key", { exact: true })
      .fill("e2e-local-key");
    await page.getByRole("button", { name: "Connect", exact: true }).click();
  }
  await expect(
    page.getByRole("button", { name: "New campaign", exact: true }),
  ).toBeVisible();
}
async function chooseOffer(
  scope: Page | Locator,
  id: number,
  addButton: string,
) {
  await scope
    .getByRole("combobox", { name: "Search offers by ID or name" })
    .fill(String(id));
  await scope.getByRole("option", { name: new RegExp(String(id)) }).click();
  await scope.getByRole("button", { name: addButton, exact: true }).click();
}
async function newCampaign(page: Page, name: string) {
  await page.getByRole("button", { name: "New campaign", exact: true }).click();
  await page.getByLabel("Campaign name", { exact: true }).fill(name);
  await chooseOffer(page, 101, "Select offer");
  await expect(
    page.getByRole("button", { name: "Create campaign", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Create campaign", exact: true })
    .click();
}
const offerSection = (page: Page) =>
  page.getByRole("region", { name: /^Stream 2: Offers$/ });
const weight = (scope: Locator, id: number) =>
  scope.getByRole("spinbutton", {
    name: `Weight for offer ${id}`,
    exact: true,
  });
async function expectWeights(scope: Locator, values: Record<number, number>) {
  for (const [id, share] of Object.entries(values))
    await expect(weight(scope, Number(id))).toHaveValue(String(share));
}
const writes = (state: RemoteState, method: string, path: string) =>
  state.events.filter((e) => e.method === method && e.path === path);

test("clean setup, late lookups and the full persistent editor scenario use the real HTTP integration", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await control(request, { hold_lookups: true });
  await open(page, request);
  await page.getByRole("button", { name: "New campaign", exact: true }).click();
  await page
    .getByLabel("Campaign name", { exact: true })
    .fill("test_mukabenov_e2e_full");
  await expect(
    page.getByRole("button", { name: "Create campaign", exact: true }),
  ).toBeDisabled();
  await control(request, { hold_lookups: false });
  await expect(
    page.getByRole("combobox", { name: "Domain", exact: true }),
  ).toHaveValue("7");
  await expect(
    page.getByRole("combobox", { name: "Group", exact: true }),
  ).toHaveValue("8");
  await expect(
    page.getByRole("combobox", { name: "Traffic source", exact: true }),
  ).toHaveValue("9");
  await chooseOffer(page, 101, "Select offer");
  await expect(
    page.getByRole("button", { name: "Create campaign", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Create campaign", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "test_mukabenov_e2e_full", exact: true }),
  ).toBeVisible();
  const created = (await remote(request)).campaigns.find(
    (c) => c.name === "test_mukabenov_e2e_full",
  )!;
  expect(created).toMatchObject({
    state: "active",
    domain_id: 7,
    group_id: "8",
    traffic_source_id: 9,
  });
  const streams = (await remote(request)).streams
    .filter((s) => s.campaign_id === created.id)
    .sort((a, b) => a.position - b.position);
  expect(streams).toHaveLength(2);
  expect(streams[0]).toMatchObject({
    filters: [{ name: "country", mode: "accept", payload: ["AU"] }],
    action_options: { url: "https://www.google.com/" },
    offers: [],
  });
  expect(streams[1].offers).toEqual([
    { offer_id: 101, share: 100, state: "active" },
  ]);
  const sid = streams[1].id;
  let editor = offerSection(page);
  await expect(
    page.getByText("No offers. Stream settings are preserved.", {
      exact: true,
    }),
  ).toBeVisible();

  await chooseOffer(editor, 102, "Add offer");
  await expectWeights(editor, { 101: 50, 102: 50 });
  expect(
    (await remote(request)).streams.find((s) => s.id === sid)!.offers,
  ).toEqual([{ offer_id: 101, share: 100, state: "active" }]);
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(weight(editor, 102)).toHaveCount(0);
  await expectWeights(editor, { 101: 100 });

  await chooseOffer(editor, 102, "Add offer");
  await chooseOffer(editor, 103, "Add offer");
  await expectWeights(editor, { 101: 34, 102: 33, 103: 33 });
  await weight(editor, 101).fill("25");
  await weight(editor, 101).press("Tab");
  await expectWeights(editor, { 101: 25, 102: 38, 103: 37 });
  await expect(
    editor.getByRole("button", { name: "Unpin offer 101", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "test_mukabenov_e2e_full", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "test_mukabenov_e2e_full", exact: true }),
  ).toBeVisible();
  editor = offerSection(page);
  await expectWeights(editor, { 101: 25, 102: 38, 103: 37 });
  await expect(editor.getByText("Unpublished changes")).toBeVisible();
  await editor
    .getByRole("button", { name: "Push to Keitaro", exact: true })
    .click();
  await expect(
    editor.getByRole("button", { name: "Push to Keitaro", exact: true }),
  ).toBeDisabled();
  await expect(
    editor.getByRole("button", { name: "Push to Keitaro", exact: true }),
  ).toHaveAttribute("aria-busy", "false");
  await expect(
    editor.getByText("Unpublished changes", { exact: true }),
  ).toHaveCount(0);
  expect(
    (await remote(request)).streams.find((s) => s.id === sid)!.offers,
  ).toEqual([
    { offer_id: 101, share: 25, state: "active" },
    { offer_id: 102, share: 38, state: "active" },
    { offer_id: 103, share: 37, state: "active" },
  ]);

  await editor
    .getByRole("button", { name: "Remove offer 102", exact: true })
    .click();
  await expectWeights(editor, { 101: 25, 102: 0, 103: 75 });
  await editor
    .getByRole("button", { name: "Push to Keitaro", exact: true })
    .click();
  await expect(
    editor.getByRole("button", { name: "Push to Keitaro", exact: true }),
  ).toBeDisabled();
  await expect(
    editor.getByRole("button", { name: "Push to Keitaro", exact: true }),
  ).toHaveAttribute("aria-busy", "false");
  await expect(
    editor.getByText("Unpublished changes", { exact: true }),
  ).toHaveCount(0);
  expect(
    (await remote(request)).streams
      .find((s) => s.id === sid)!
      .offers.map((o) => o.offer_id),
  ).toEqual([101, 103]);
  await editor
    .getByRole("button", { name: "Restore offer 102", exact: true })
    .click();
  await expectWeights(editor, { 101: 25, 102: 38, 103: 37 });
  await editor
    .getByRole("button", { name: "Push to Keitaro", exact: true })
    .click();
  await expect(
    editor.getByRole("button", { name: "Push to Keitaro", exact: true }),
  ).toBeDisabled();
  await expect(
    editor.getByRole("button", { name: "Push to Keitaro", exact: true }),
  ).toHaveAttribute("aria-busy", "false");
  await expect(
    editor.getByText("Unpublished changes", { exact: true }),
  ).toHaveCount(0);

  await weight(editor, 101).fill("30");
  await weight(editor, 101).press("Tab");
  await expectWeights(editor, { 101: 30, 102: 35, 103: 35 });
  const external = [
    { offer_id: 101, share: 60, state: "active" },
    { offer_id: 102, share: 40, state: "active" },
  ];
  await control(request, { stream_id: sid, offers: external });
  const beforeConflict = writes(
    await remote(request),
    "PUT",
    `streams/${sid}`,
  ).length;
  await editor
    .getByRole("button", { name: "Push to Keitaro", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("changed externally");
  await expectWeights(editor, { 101: 30, 102: 35, 103: 35 });
  expect(writes(await remote(request), "PUT", `streams/${sid}`)).toHaveLength(
    beforeConflict,
  );
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    editor.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Refresh from Keitaro", exact: true })
    .click();
  await expectWeights(editor, { 101: 60, 102: 40, 103: 0 });
  await expect(
    editor.getByRole("button", { name: "Restore offer 103", exact: true }),
  ).toBeVisible();
  await editor
    .getByRole("button", { name: "Restore offer 103", exact: true })
    .click();
  await expectWeights(editor, { 101: 34, 102: 33, 103: 33 });
  const beforeLost = writes(
    await remote(request),
    "PUT",
    `streams/${sid}`,
  ).length;
  await control(request, { drop_update: true });
  await editor
    .getByRole("button", { name: "Push to Keitaro", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Published" }),
  ).toBeVisible();
  expect(writes(await remote(request), "PUT", `streams/${sid}`)).toHaveLength(
    beforeLost + 1,
  );
  expect(
    (await remote(request)).streams
      .find((s) => s.id === sid)!
      .offers.map((o) => o.share),
  ).toEqual([34, 33, 33]);
  expect(errors).toEqual([]);
});

test("a lost create response resumes the same persisted operation without a second remote campaign", async ({
  page,
  request,
}) => {
  await open(page, request);
  await control(request, { drop_create: true });
  await newCampaign(page, "test_mukabenov_e2e_lost_create");
  await expect(
    page.getByRole("button", {
      name: "Reconcile and resume this creation",
      exact: true,
    }),
  ).toBeEnabled();
  await expect(
    page.getByText("Creation is not fully confirmed.", { exact: false }),
  ).toBeVisible();
  const operation = await page.evaluate(
    () => JSON.parse(localStorage.getItem("adrobot.creation")!).operation_id,
  );
  expect(operation).toBeTruthy();
  await page.reload();
  await page.getByRole("button", { name: "New campaign", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Reconcile and resume this creation",
      exact: true,
    }),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("adrobot.creation")!).operation_id,
    ),
  ).toBe(operation);
  await page
    .getByRole("button", {
      name: "Reconcile and resume this creation",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "test_mukabenov_e2e_lost_create",
      exact: true,
    }),
  ).toBeVisible();
  const state = await remote(request);
  const matches = state.campaigns.filter(
    (c) => c.name === "test_mukabenov_e2e_lost_create",
  );
  expect(matches).toHaveLength(1);
  expect(
    state.streams.filter((s) => s.campaign_id === matches[0].id),
  ).toHaveLength(2);
  expect(
    writes(state, "POST", "campaigns").filter((e) => e.id === matches[0].id),
  ).toHaveLength(1);
  expect(
    await page.evaluate(() => localStorage.getItem("adrobot.creation")),
  ).toBeNull();
});

test("an accepted write with unavailable read-back keeps the draft locked until explicit reconciliation", async ({
  page,
  request,
}) => {
  await open(page, request);
  await page
    .getByRole("navigation", { name: "Select a campaign" })
    .getByRole("button", { name: "test_mukabenov_seed", exact: true })
    .click();
  const editor = offerSection(page);
  await expectWeights(editor, { 101: 34, 102: 33, 103: 33 });
  await chooseOffer(editor, 104, "Add offer");
  await expectWeights(editor, { 101: 25, 102: 25, 103: 25, 104: 25 });
  await control(request, { drop_update: true, fail_read_after_update: true });
  const before = writes(await remote(request), "PUT", "streams/1002").length;
  await editor
    .getByRole("button", { name: "Push to Keitaro", exact: true })
    .click();
  await expect(
    editor.getByRole("button", { name: "Reconcile", exact: true }),
  ).toBeVisible();
  await expect(
    editor.getByRole("button", { name: "Remove offer 101", exact: true }),
  ).toBeDisabled();
  expect(writes(await remote(request), "PUT", "streams/1002")).toHaveLength(
    before + 1,
  );
  await page.reload();
  await expect(
    offerSection(page).getByRole("button", { name: "Reconcile", exact: true }),
  ).toBeVisible();
  await offerSection(page)
    .getByRole("button", { name: "Reconcile", exact: true })
    .click();
  await expect(
    offerSection(page).getByRole("button", { name: "Reconcile", exact: true }),
  ).toHaveCount(0);
  await expect(
    offerSection(page).getByRole("button", {
      name: "Remove offer 101",
      exact: true,
    }),
  ).toBeEnabled();
  expect(writes(await remote(request), "PUT", "streams/1002")).toHaveLength(
    before + 1,
  );
});
