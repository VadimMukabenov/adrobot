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
  action_payload?: string;
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
async function newCampaign(
  page: Page,
  request: APIRequestContext,
  name: string,
) {
  await page.getByRole("button", { name: "New campaign", exact: true }).click();
  await page.getByLabel("Campaign name", { exact: true }).fill(name);
  await chooseOffer(page, 101, "Select offer");
  await expect(
    page.getByRole("button", { name: "Create campaign", exact: true }),
  ).toBeEnabled();
  // The real HTTP tracker is deliberately blocked. The application must
  // acknowledge the POST and render useful progress within one second.
  await control(request, { hold_lookups: true });
  const accepted = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/campaigns") &&
      response.request().method() === "POST",
    { timeout: 1000 },
  );
  const started = performance.now();
  await page
    .getByRole("button", { name: "Create campaign", exact: true })
    .click();
  const response = await accepted;
  expect(response.headers()["content-type"]).toContain("application/x-ndjson");
  await expect(page.getByRole("status")).toContainText(
    "Checking Keitaro settings",
    { timeout: 1000 },
  );
  const feedbackMs = performance.now() - started;
  expect(feedbackMs).toBeLessThan(1000);
  console.log(
    `Creation first HTTP response and visible progress: ${Math.round(feedbackMs)}ms with tracker blocked`,
  );
  await control(request, { hold_lookups: false });
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
    action_payload: "https://www.google.com/",
    offers: [],
  });
  expect(streams[1].offers).toEqual([
    { offer_id: 101, share: 100, state: "active" },
  ]);
  const visitorURL = `${trackerURL}/${created.alias}`;
  await expect(page.getByLabel("Visitor link", { exact: true })).toHaveValue(
    visitorURL,
  );
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Link copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    visitorURL,
  );
  const popupPromise = page.waitForEvent("popup");
  await page
    .getByRole("link", { name: "Open as visitor", exact: true })
    .click();
  const visitor = await popupPromise;
  await expect(visitor).toHaveURL(visitorURL);
  await expect(
    visitor.getByRole("heading", { name: "Offer 101", exact: true }),
  ).toBeVisible();
  await visitor.close();
  const sid = streams[1].id;
  let editor = offerSection(page);
  await expect(
    page.getByText(
      "Routing stream · no offer list to edit here. Its redirects and filters are managed in Keitaro and stay unchanged when you publish offer edits.",
      {
        exact: true,
      },
    ),
  ).toBeVisible();

  await chooseOffer(editor, 102, "Add offer");
  await expectWeights(editor, { 101: 50, 102: 50 });
  expect(
    (await remote(request)).streams.find((s) => s.id === sid)!.offers,
  ).toEqual([{ offer_id: 101, share: 100, state: "active" }]);
  await editor
    .getByRole("button", { name: "Discard draft", exact: true })
    .click();
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
    .getByRole("button", { name: "Publish to Keitaro", exact: true })
    .click();
  await expect(
    editor.getByRole("button", { name: "Publish to Keitaro", exact: true }),
  ).toBeDisabled();
  await expect(
    editor.getByRole("button", { name: "Publish to Keitaro", exact: true }),
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
    .getByRole("button", { name: "Publish to Keitaro", exact: true })
    .click();
  await expect(
    editor.getByRole("button", { name: "Publish to Keitaro", exact: true }),
  ).toBeDisabled();
  await expect(
    editor.getByRole("button", { name: "Publish to Keitaro", exact: true }),
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
    .getByRole("button", { name: "Publish to Keitaro", exact: true })
    .click();
  await expect(
    editor.getByRole("button", { name: "Publish to Keitaro", exact: true }),
  ).toBeDisabled();
  await expect(
    editor.getByRole("button", { name: "Publish to Keitaro", exact: true }),
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
    .getByRole("button", { name: "Publish to Keitaro", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("changed externally");
  await expect(page.getByRole("alert")).toBeInViewport();
  await expectWeights(editor, { 101: 30, 102: 35, 103: 35 });
  expect(writes(await remote(request), "PUT", `streams/${sid}`)).toHaveLength(
    beforeConflict,
  );
  await editor
    .getByRole("button", { name: "Discard draft", exact: true })
    .click();
  await expect(
    editor.getByRole("button", { name: "Discard draft", exact: true }),
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
    .getByRole("button", { name: "Publish to Keitaro", exact: true })
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
  await newCampaign(page, request, "test_mukabenov_e2e_lost_create");
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
    page.getByLabel("Country code", { exact: false }),
  ).toBeEditable();
  await page.getByLabel("Country code", { exact: false }).fill("DE");
  await page
    .getByLabel("Campaign name", { exact: true })
    .fill("test_mukabenov_e2e_new_after_interruption");
  await chooseOffer(page, 101, "Select offer");
  await page
    .getByRole("button", { name: "Create campaign", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "test_mukabenov_e2e_new_after_interruption",
      exact: true,
    }),
  ).toBeVisible();
  const newerState = await remote(request);
  const newer = newerState.campaigns.find(
    (c) => c.name === "test_mukabenov_e2e_new_after_interruption",
  )!;
  expect(
    newerState.streams.find(
      (s) => s.campaign_id === newer.id && s.position === 1,
    )?.filters,
  ).toEqual([expect.objectContaining({ name: "country", payload: ["DE"] })]);
  await page.reload();
  await page.getByRole("button", { name: "New campaign", exact: true }).click();
  await page.getByText(/Previous creations available/).click();
  await page
    .getByRole("button", {
      name: "Resume test_mukabenov_e2e_lost_create",
      exact: true,
    })
    .click();
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
    .getByRole("button", { name: "Publish to Keitaro", exact: true })
    .click();
  await expect(
    editor.getByRole("button", {
      name: "Check publication status",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    editor.getByRole("button", { name: "Remove offer 101", exact: true }),
  ).toBeDisabled();
  expect(writes(await remote(request), "PUT", "streams/1002")).toHaveLength(
    before + 1,
  );
  await page.reload();
  await expect(
    offerSection(page).getByRole("button", {
      name: "Check publication status",
      exact: true,
    }),
  ).toBeVisible();
  await offerSection(page)
    .getByRole("button", { name: "Check publication status", exact: true })
    .click();
  await expect(
    offerSection(page).getByRole("button", {
      name: "Check publication status",
      exact: true,
    }),
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

test("matching-country visitors receive the Google redirect and other visitors open the offer", async ({
  page,
  request,
}) => {
  await open(page, request);
  const name = "test_mukabenov_e2e_country_redirect";
  await newCampaign(page, request, name);
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  const campaign = (await remote(request)).campaigns.find(
    (item) => item.name === name,
  )!;
  const url = `${trackerURL}/${campaign.alias}`;
  const matching = await request.get(url, {
    headers: { "X-Test-Country": "AU" },
    maxRedirects: 0,
  });
  expect(matching.status()).toBe(302);
  expect(matching.headers()["location"]).toBe("https://www.google.com/");
  const other = await request.get(url, {
    headers: { "X-Test-Country": "NL" },
    maxRedirects: 0,
  });
  expect(other.status()).toBe(200);
  expect(await other.text()).toContain("Offer 101");
  // Keep the Google boundary offline: assert the real tracker response above.
  // Follow the other branch through the actual visitor link and HTTP server.
  await page.context().setExtraHTTPHeaders({ "X-Test-Country": "NL" });
  const popupPromise = page.waitForEvent("popup");
  await page
    .getByRole("link", { name: "Open as visitor", exact: true })
    .click();
  const visitor = await popupPromise;
  await expect(visitor).toHaveURL(url);
  await expect(
    visitor.getByRole("heading", { name: "Offer 101" }),
  ).toBeVisible();
  await visitor.close();
});

test("removing the only offer explains blocked publication and Restore recovers the draft", async ({
  page,
  request,
}) => {
  await open(page, request);
  const name = "test_mukabenov_e2e_empty_offer";
  await newCampaign(page, request, name);
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  const created = (await remote(request)).campaigns.find(
    (item) => item.name === name,
  )!;
  const sid = (await remote(request)).streams.find(
    (item) => item.campaign_id === created.id && item.position === 2,
  )!.id;
  const editor = offerSection(page);
  const publish = editor.getByRole("button", {
    name: "Publish to Keitaro",
    exact: true,
  });
  await editor
    .getByRole("button", { name: "Remove offer 101", exact: true })
    .click();
  await expect(publish).toHaveAttribute("aria-busy", "false");
  await expect(publish).toBeDisabled();
  await expect(editor.getByRole("alert")).toContainText(
    "Restore an offer or add another",
  );
  await expect(editor.getByRole("alert")).toBeInViewport();
  expect(writes(await remote(request), "PUT", `streams/${sid}`)).toHaveLength(
    0,
  );
  await editor
    .getByRole("button", { name: "Restore offer 101", exact: true })
    .click();
  await expectWeights(editor, { 101: 100 });
  await expect(editor.getByRole("alert")).toHaveCount(0);
  // Restoring the original offer exactly restores the published baseline.
  // No further publication is needed until there is an actual new change.
  await expect(publish).toBeDisabled();
  await expect(
    editor.getByText("Unpublished changes", { exact: true }),
  ).toHaveCount(0);
  expect(writes(await remote(request), "PUT", `streams/${sid}`)).toHaveLength(
    0,
  );
  await chooseOffer(editor, 102, "Add offer");
  await expectWeights(editor, { 101: 50, 102: 50 });
  await expect(publish).toBeEnabled();
  await publish.click();
  await expect(
    page.getByRole("status").filter({ hasText: "Published and confirmed" }),
  ).toBeInViewport();
  await expect(
    editor.getByText("Unpublished changes", { exact: true }),
  ).toHaveCount(0);
  expect(
    (await remote(request)).streams.find((item) => item.id === sid)!.offers,
  ).toEqual([
    { offer_id: 101, share: 50, state: "active" },
    { offer_id: 102, share: 50, state: "active" },
  ]);
  expect(writes(await remote(request), "PUT", `streams/${sid}`)).toHaveLength(
    1,
  );
});

test("four-offer video acceptance cycle keeps pins, archives and remote state consistent", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page, request);
  const name = "test_mukabenov_e2e_four_offers";
  await newCampaign(page, request, name);
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  const created = (await remote(request)).campaigns.find(
    (item) => item.name === name,
  )!;
  const initial = (await remote(request)).streams.filter(
    (item) => item.campaign_id === created.id,
  );
  const routing = initial.find((item) => item.position === 1)!;
  const sid = initial.find((item) => item.position === 2)!.id;
  const editor = offerSection(page);
  const publishedOffers = async () =>
    (await remote(request)).streams.find((item) => item.id === sid)!.offers;
  const publish = async () => {
    await editor
      .getByRole("button", { name: "Publish to Keitaro", exact: true })
      .click();
    await expect(
      editor.getByText("Unpublished changes", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("status").filter({ hasText: "Published and confirmed" }),
    ).toBeInViewport();
  };
  // Search by name as well as the IDs exercised in the other scenarios.
  await editor
    .getByRole("combobox", { name: "Search offers by ID or name" })
    .fill("Beta");
  await editor.getByRole("option", { name: /102/ }).click();
  await editor.getByRole("button", { name: "Add offer", exact: true }).click();
  await expectWeights(editor, { 101: 50, 102: 50 });
  await chooseOffer(editor, 103, "Add offer");
  await expectWeights(editor, { 101: 34, 102: 33, 103: 33 });
  await chooseOffer(editor, 104, "Add offer");
  await expectWeights(editor, { 101: 25, 102: 25, 103: 25, 104: 25 });
  expect(await publishedOffers()).toEqual([
    { offer_id: 101, share: 100, state: "active" },
  ]);
  await editor
    .getByRole("button", { name: "Discard draft", exact: true })
    .click();
  await expectWeights(editor, { 101: 100 });
  await expect(weight(editor, 102)).toHaveCount(0);
  await expect(weight(editor, 103)).toHaveCount(0);
  await expect(weight(editor, 104)).toHaveCount(0);
  expect(
    (await remote(request)).events.filter((event) => event.method === "DELETE"),
  ).toHaveLength(0);
  for (const id of [102, 103]) await chooseOffer(editor, id, "Add offer");
  await weight(editor, 101).fill("25");
  await weight(editor, 101).press("Tab");
  await expectWeights(editor, { 101: 25, 102: 38, 103: 37 });
  await chooseOffer(editor, 104, "Add offer");
  await expectWeights(editor, { 101: 25, 102: 25, 103: 25, 104: 25 });
  await expect(
    editor.getByRole("button", { name: "Unpin offer 101", exact: true }),
  ).toBeVisible();
  await publish();
  expect(await publishedOffers()).toEqual(
    [101, 102, 103, 104].map((id) => ({
      offer_id: id,
      share: 25,
      state: "active",
    })),
  );
  await editor
    .getByRole("button", { name: "Remove offer 104", exact: true })
    .click();
  await expectWeights(editor, { 101: 25, 102: 38, 103: 37, 104: 0 });
  await expect(
    editor.getByRole("button", { name: "Unpin offer 101", exact: true }),
  ).toBeVisible();
  expect(await publishedOffers()).toHaveLength(4);
  await publish();
  expect(await publishedOffers()).toEqual([
    { offer_id: 101, share: 25, state: "active" },
    { offer_id: 102, share: 38, state: "active" },
    { offer_id: 103, share: 37, state: "active" },
  ]);
  await editor
    .getByRole("button", { name: "Restore offer 104", exact: true })
    .click();
  await expectWeights(editor, { 101: 25, 102: 25, 103: 25, 104: 25 });
  await publish();
  expect(await publishedOffers()).toEqual([
    { offer_id: 101, share: 25, state: "active" },
    { offer_id: 102, share: 25, state: "active" },
    { offer_id: 103, share: 25, state: "active" },
    { offer_id: 104, share: 25, state: "active" },
  ]);
  // A marketer changes the remote association, not the global offer catalog.
  await control(request, {
    stream_id: sid,
    offers: [
      { offer_id: 101, share: 25, state: "active" },
      { offer_id: 103, share: 38, state: "active" },
      { offer_id: 104, share: 37, state: "active" },
    ],
  });
  await page
    .getByRole("button", { name: "Refresh from Keitaro", exact: true })
    .click();
  await expectWeights(editor, { 101: 25, 102: 0, 103: 38, 104: 37 });
  await expect(
    editor.getByRole("button", { name: "Restore offer 102", exact: true }),
  ).toBeEnabled();
  await expect(
    editor.getByRole("button", { name: "Unpin offer 101", exact: true }),
  ).toBeVisible();
  await editor
    .getByRole("button", { name: "Restore offer 102", exact: true })
    .click();
  await expectWeights(editor, { 101: 25, 102: 25, 103: 25, 104: 25 });
  await publish();
  expect(await publishedOffers()).toEqual([
    { offer_id: 101, share: 25, state: "active" },
    { offer_id: 102, share: 25, state: "active" },
    { offer_id: 103, share: 25, state: "active" },
    { offer_id: 104, share: 25, state: "active" },
  ]);
  // Unpin and another local removal must be fully reversible by Discard.
  await editor
    .getByRole("button", { name: "Unpin offer 101", exact: true })
    .click();
  await editor
    .getByRole("button", { name: "Remove offer 104", exact: true })
    .click();
  await expectWeights(editor, { 101: 34, 102: 33, 103: 33, 104: 0 });
  await editor
    .getByRole("button", { name: "Discard draft", exact: true })
    .click();
  await expectWeights(editor, { 101: 25, 102: 25, 103: 25, 104: 25 });
  await expect(
    editor.getByRole("button", { name: "Unpin offer 101", exact: true }),
  ).toBeVisible();
  const final = await remote(request);
  expect(final.streams.find((item) => item.id === routing.id)).toEqual(routing);
  expect(final.streams.find((item) => item.id === sid)!.offers).toEqual([
    { offer_id: 101, share: 25, state: "active" },
    { offer_id: 102, share: 25, state: "active" },
    { offer_id: 103, share: 25, state: "active" },
    { offer_id: 104, share: 25, state: "active" },
  ]);
  expect(writes(final, "PUT", `streams/${routing.id}`)).toHaveLength(0);
  expect(
    final.events.filter((event) => event.method === "DELETE"),
  ).toHaveLength(0);
  const catalog = await request.get(`${trackerURL}/admin_api/v1/offers`, {
    headers: { "Api-Key": "e2e-local-key" },
  });
  expect(catalog.ok()).toBeTruthy();
  expect(
    (await catalog.json()).map((offer: { id: number }) => offer.id),
  ).toEqual([101, 102, 103, 104]);
  expect(errors).toEqual([]);
});
