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
    fireEvent.click(
      screen.getByRole("button", { name: /check publication status/i }),
    );
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

it.each([
  {
    name: "no active offers",
    total: 0,
    offers: stream.offers.map((offer) => ({
      ...offer,
      removed: true,
      share: 0,
    })),
    reason: /restore an offer or add another/i,
  },
  {
    name: "active weights below 100%",
    total: 25,
    offers: [{ ...stream.offers[0], share: 25, pinned: true }],
    reason: /active offer weights must total 100%/i,
  },
])(
  "explains and blocks publication with $name, while allowing recovery",
  ({ total, offers, reason }) => {
    const action = vi.fn();
    const edit = vi.fn();
    const props = {
      stream: { ...stream, total, offers },
      index: 2,
      busy: false,
      writable: true,
      onEdit: edit,
      onAction: action,
    };
    const { rerender } = render(<StreamEditor {...props} />);
    const publish = screen.getByRole("button", { name: /publish to keitaro/i });
    expect(publish).toBeDisabled();
    expect(publish).toHaveAccessibleDescription(reason);
    expect(screen.getByRole("alert")).toHaveTextContent(reason);
    fireEvent.click(publish);
    expect(action).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Discard draft" })).toBeEnabled();
    if (offers.every((offer) => offer.removed)) {
      fireEvent.click(screen.getByRole("button", { name: "Restore offer 1" }));
      expect(edit).toHaveBeenCalledWith("restore", 1);
    }
    rerender(<StreamEditor {...props} stream={stream} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(publish).toBeEnabled();
    fireEvent.click(publish);
    expect(action).toHaveBeenCalledWith("push");
  },
);
