import { AlertTriangle, ChevronDown, Network } from "lucide-react";
import type { EditAction, Stream, StreamAction } from "../types";
import { OfferSearch } from "./OfferSearch";
import { OfferTable } from "./OfferTable";

type Props = {
  stream: Stream;
  index: number;
  busy: boolean;
  writable: boolean;
  onEdit: (action: EditAction, offerId: number, share?: number) => void;
  onAction: (action: StreamAction) => void;
};

export function StreamEditor({
  stream: s,
  index,
  busy,
  writable,
  onEdit,
  onAction,
}: Props) {
  const blocked = busy || !writable || !s.available || s.status !== "ready";
  return (
    <section
      className={`stream ${s.dirty ? "pending" : ""}`}
      aria-label={`Stream ${index}: ${s.name}`}
    >
      <div className="stream-header">
        <h2>
          <Network size={22} aria-hidden="true" />
          <span>
            Stream {index} – {s.name}
          </span>
        </h2>
        {s.dirty && (
          <span className="pending-label">
            <AlertTriangle size={19} />
            Unpublished changes
          </span>
        )}
        {s.editable ? (
          <div className="stream-actions">
            {s.status === "uncertain" && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => onAction("reconcile")}
              >
                Reconcile
              </button>
            )}
            <button
              className="button secondary"
              disabled={busy || !writable || s.status !== "ready" || !s.dirty}
              onClick={() => onAction("cancel")}
            >
              Cancel
            </button>
            <button
              className="button primary"
              aria-label="Push to Keitaro"
              aria-busy={busy}
              disabled={blocked || !s.dirty}
              onClick={() => onAction("push")}
            >
              {busy ? "Working…" : "Push to Keitaro"}
            </button>
          </div>
        ) : (
          <ChevronDown
            size={20}
            className="stream-chevron"
            aria-hidden="true"
          />
        )}
      </div>
      {!s.available && (
        <p className="notice error">
          This stream is no longer available in Keitaro.
        </p>
      )}
      {s.messages.map((message, i) => (
        <p key={i} className="notice warning">
          {message}
        </p>
      ))}
      {s.status === "pushing" && (
        <p className="notice warning">
          Publication is running. Editing is locked.
        </p>
      )}
      {s.editable ? (
        <div className="stream-body">
          <OfferSearch
            disabled={blocked}
            onSelect={(offer) => onEdit("add", offer.id)}
          />
          <OfferTable
            offers={s.offers}
            disabled={blocked}
            revision={s.revision}
            onEdit={onEdit}
          />
          <div className={`total ${s.total !== 100 ? "invalid" : ""}`}>
            Total active weights: <strong>{s.total}%</strong>
            {s.total !== 100 && (
              <span>Publication requires a total of 100%.</span>
            )}
          </div>
        </div>
      ) : (
        <p className="no-offers">No offers. Stream settings are preserved.</p>
      )}
    </section>
  );
}
