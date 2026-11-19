import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import App from "./App";

const response = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { status });
afterEach(() => vi.unstubAllGlobals());

it("opens setup without fetching campaigns, connects and never stores the key in the browser", async () => {
  const fetch = vi.fn().mockImplementation((url: string) => {
    if (url === "/api/connection")
      return Promise.resolve(
        response({
          configured: false,
          url: "https://tlgk.host",
          setup_token: "test-token",
        }),
      );
    if (url === "/api/health")
      return Promise.resolve(response({ campaign_prefix: "test_mukabenov_" }));
    if (url === "/api/lookups")
      return Promise.resolve(
        response({ domains: [], groups: [], traffic_sources: [] }),
      );
    return Promise.resolve(response([]));
  });
  vi.stubGlobal("fetch", fetch);
  render(<App />);
  expect(await screen.findByLabelText("Keitaro URL")).toHaveValue(
    "https://tlgk.host",
  );
  expect(
    screen.getByRole("link", { name: /open test keitaro/i }),
  ).toHaveAttribute("href", "https://tlgk.host/admin/");
  expect(fetch).toHaveBeenCalledTimes(1);
  const key = screen.getByLabelText("Admin API key");
  expect(key).toHaveAttribute("type", "password");
  fireEvent.change(key, { target: { value: "private-test-key" } });
  fetch.mockImplementationOnce(() =>
    Promise.resolve(response({ configured: true, url: "https://tlgk.host" })),
  );
  fireEvent.click(screen.getByRole("button", { name: "Connect" }));
  await screen.findByRole("heading", { name: "Choose a campaign" });
  expect(fetch).toHaveBeenCalledWith(
    "/api/connection",
    expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "X-Setup-Token": "test-token" }),
      body: JSON.stringify({
        url: "https://tlgk.host",
        api_key: "private-test-key",
      }),
    }),
  );
  expect(JSON.stringify(localStorage)).not.toContain("private-test-key");
  expect(JSON.stringify(sessionStorage)).not.toContain("private-test-key");
  expect(
    screen.queryByDisplayValue("private-test-key"),
  ).not.toBeInTheDocument();
});

it("keeps the form usable after denied access and allows retry", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      response({
        configured: false,
        url: "https://tlgk.host",
        setup_token: "token",
      }),
    )
    .mockResolvedValueOnce(
      response({ detail: "Keitaro denied access. Check the API key." }, 502),
    );
  vi.stubGlobal("fetch", fetch);
  render(<App />);
  fireEvent.change(await screen.findByLabelText("Admin API key"), {
    target: { value: "bad" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Connect" }));
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Keitaro denied access",
    ),
  );
  expect(screen.getByRole("button", { name: "Connect" })).toBeEnabled();
  expect(fetch).toHaveBeenCalledTimes(2);
});
