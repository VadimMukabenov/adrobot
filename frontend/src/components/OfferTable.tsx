import {
  Archive,
  Check,
  LockKeyhole,
  LockKeyholeOpen,
  RotateCcw,
  Trash2,
} from "lucide-react";
import type { EditAction, Link } from "../types";

type Props = {
  offers: Link[];
  disabled: boolean;
  revision: number;
  onEdit: (action: EditAction, offerId: number, share?: number) => void;
};

export function OfferTable({ offers, disabled, revision, onEdit }: Props) {
  return (
    <div className="table-scroll">
      <table className="offer-table">
        <thead>
          <tr>
            <th>Offer</th>
            <th>Weight</th>
            <th>Pin</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {offers.map((o) => (
            <tr key={o.offer_id} className={o.removed ? "archived" : ""}>
              <td className="offer-name">
                <strong>{o.offer_id}</strong>
                <span title={o.name}>{o.name}</span>
              </td>
              <td>
                <div className="weight-field">
                  <input
                    key={`${o.offer_id}-${revision}`}
                    type="number"
                    aria-label={`Weight for offer ${o.offer_id}`}
                    min="0"
                    max="100"
                    step="1"
                    defaultValue={o.share}
                    disabled={disabled || o.removed}
                    onBlur={(e) => {
                      const value = Number(e.currentTarget.value);
                      if (
                        e.currentTarget.value !== "" &&
                        Number.isInteger(value) &&
                        value >= 0 &&
                        value <= 100
                      ) {
                        if (value !== o.share) onEdit("pin", o.offer_id, value);
                      } else {
                        e.currentTarget.value = String(o.share);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                  />
                  <span>%</span>
                </div>
              </td>
              <td>
                <button
                  type="button"
                  className={`pin-control ${o.pinned ? "pinned" : ""}`}
                  disabled={disabled || o.removed}
                  aria-label={`${o.pinned ? "Unpin" : "Pin"} offer ${o.offer_id}`}
                  aria-pressed={o.pinned}
                  onClick={() => onEdit(o.pinned ? "unpin" : "pin", o.offer_id)}
                >
                  {o.pinned ? (
                    <LockKeyhole size={18} />
                  ) : (
                    <LockKeyholeOpen size={18} />
                  )}
                  {o.pinned ? "Pinned" : "Unpinned"}
                </button>
              </td>
              <td>
                <span
                  className={`offer-status ${o.removed ? "removed" : "active"}`}
                >
                  {o.removed ? <Archive size={16} /> : <Check size={16} />}
                  {o.removed ? "Removed" : "Active"}
                </span>
              </td>
              <td>
                {o.removed ? (
                  <button
                    type="button"
                    className="button restore"
                    aria-label={`Restore offer ${o.offer_id}`}
                    disabled={disabled || !o.available}
                    title={
                      !o.available
                        ? "This offer is unavailable in Keitaro."
                        : undefined
                    }
                    onClick={() => onEdit("restore", o.offer_id)}
                  >
                    <RotateCcw size={16} />
                    Restore
                  </button>
                ) : (
                  <button
                    type="button"
                    className="button secondary"
                    disabled={disabled}
                    aria-label={`Remove offer ${o.offer_id}`}
                    onClick={() => onEdit("remove", o.offer_id)}
                  >
                    <Trash2 size={16} />
                    Remove
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
