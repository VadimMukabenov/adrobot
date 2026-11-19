import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { VisitorLink } from "./components/VisitorLink";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("provides a visitor link that opens separately and copies the same public address", async () => {
  const copy = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText: copy } });
  const url = "https://tracker.test/test_public_123";
  render(<VisitorLink url={url} />);
  expect(screen.getByLabelText("Visitor link")).toHaveValue(url);
  const link = screen.getByRole("link", { name: "Open as visitor" });
  expect(link).toHaveAttribute("href", url);
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", "noopener noreferrer");
  fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
  await waitFor(() => expect(copy).toHaveBeenCalledWith(url));
  expect(await screen.findByRole("status")).toHaveTextContent("Link copied");
});
it("keeps the address selectable when automatic copying fails", async () => {
  vi.stubGlobal("navigator", {
    clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
  });
  render(<VisitorLink url="https://tracker.test/test_123" />);
  fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    /select and copy/i,
  );
  expect(screen.getByLabelText("Visitor link")).toHaveAttribute("readonly");
});
