import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StreamEditor } from "./components/StreamEditor";

const stream = {
  id: 11,
  name: "Offers",
  revision: 1,
  dirty: true,
  status: "ready",
  available: true,
  editable: true,
  total: 100,
  messages: [],
  offers: [
    {
      offer_id: 1,
      name: "Product A",
      share: 100,
      pinned: false,
      removed: false,
      available: true,
    },
    {
      offer_id: 2,
      name: "Product B",
      share: 0,
      pinned: false,
      removed: true,
      available: true,
    },
  ],
};

describe("stream actions", () => {
  it("restores the archived association rather than offering global deletion", () => {
    const onEdit = vi.fn();
    render(
      <StreamEditor
        stream={stream}
        index={2}
        busy={false}
        writable
        onEdit={onEdit}
        onAction={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Restore offer 2" }));
    expect(onEdit).toHaveBeenCalledWith("restore", 2);
    expect(
      screen.queryByRole("button", { name: /delete offer/i }),
    ).not.toBeInTheDocument();
  });
  it("sends a changed integer weight as a pin and disables mutations while publishing", () => {
    const onEdit = vi.fn();
    const props = {
      stream,
      index: 2,
      busy: false,
      writable: true,
      onEdit,
      onAction: vi.fn(),
    };
    const { rerender } = render(<StreamEditor {...props} />);
    const input = screen.getByRole("spinbutton", {
      name: "Weight for offer 1",
    });
    fireEvent.change(input, { target: { value: "25" } });
    fireEvent.blur(input);
    expect(onEdit).toHaveBeenCalledWith("pin", 1, 25);
    rerender(<StreamEditor {...props} busy />);
    expect(
      screen.getByRole("button", { name: "Remove offer 1" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /publish to keitaro/i }),
    ).toBeDisabled();
  });
  it("shows errors and exposes reconciliation for uncertain remote outcomes", () => {
    const action = vi.fn();
    render(
      <StreamEditor
        stream={{
          ...stream,
          status: "uncertain",
          messages: ["Remote result is unknown."],
        }}
        index={2}
        busy={false}
        writable
        onEdit={vi.fn()}
        onAction={action}
      />,
    );
    expect(screen.getByText("Remote result is unknown.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /check publication status/i }));
    expect(action).toHaveBeenCalledWith("reconcile");
    expect(
      screen.getByRole("button", { name: "Remove offer 1" }),
    ).toBeDisabled();
  });
  it("keeps redirect streams visible without editable offer controls", () => {
    render(
      <StreamEditor
        stream={{ ...stream, editable: false, offers: [], dirty: false }}
        index={1}
        busy={false}
        writable
        onEdit={vi.fn()}
        onAction={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/Routing stream · no offer list to edit here/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /publish to keitaro/i }),
    ).not.toBeInTheDocument();
  });
});

it("allows local Cancel for a deleted stream while retaining the draft and blocking publication", () => {
  const action = vi.fn();
  render(
    <StreamEditor
      stream={{ ...stream, available: false }}
      index={2}
      busy={false}
      writable
      onEdit={vi.fn()}
      onAction={action}
    />,
  );
  expect(
    screen.getByRole("button", { name: /publish to keitaro/i }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
  expect(action).toHaveBeenCalledWith("cancel");
});
