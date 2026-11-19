import { useId } from "react";
import { AlertTriangle, Network } from "lucide-react";
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
  const publicationReasonId = useId();
  const blocked = busy || !writable || !s.available || s.status !== "ready";
  const publicationReason = !s.offers.some((offer) => !offer.removed)
    ? "Restore an offer or add another before publishing. At least one active offer is required."
    : s.total !== 100
      ? "Active offer weights must total 100% before publishing. Change the weights or unpin an offer to share the remainder."
      : "";
  const showPublicationReason =
    s.editable && s.dirty && s.status === "ready" && !!publicationReason;
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
                Check publication status
              </button>
            )}
            <button
              className="button secondary"
              disabled={busy || !writable || s.status !== "ready" || !s.dirty}
              onClick={() => onAction("cancel")}
            >
              Discard draft
            </button>
            <button
              className="button primary"
              aria-label="Publish to Keitaro"
              aria-busy={busy}
              disabled={blocked || !s.dirty || !!publicationReason}
              aria-describedby={
                showPublicationReason ? publicationReasonId : undefined
              }
              onClick={() => onAction("push")}
            >
              {busy ? "Working…" : "Publish to Keitaro"}
            </button>
          </div>
        ) : null}
      </div>
      {showPublicationReason && (
        <p id={publicationReasonId} role="alert" className="notice warning">
          {publicationReason} Your draft is saved; these changes have not been
          published.
        </p>
      )}
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
          <p className="stream-help">
            Offers are destination pages. Add or remove offers here; traffic is
            split between them. A weight of 25% sends one quarter of this
            stream’s traffic to that offer. Pin fixes a weight; unpinned offers
            share the remainder.
          </p>
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
        <p className="no-offers">
          Routing stream · no offer list to edit here. Its redirects and filters
          are managed in Keitaro and stay unchanged when you publish offer
          edits.
        </p>
      )}
    </section>
  );
}
