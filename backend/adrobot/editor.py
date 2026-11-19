import json
import re
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from urllib.parse import urlsplit
from uuid import uuid4

from sqlalchemy import delete, select, update

from .errors import AppError
from .models import Campaign, Offer, Operation, Stream, StreamOffer, utcnow
from .weights import WeightError, distribute


def fingerprint(offers):
    return json.dumps(
        sorted((int(o["offer_id"]), int(o["share"]), o.get("state", "active")) for o in offers),
        separators=(",", ":"),
    )


class Editor:
    def __init__(self, db, gateway, prefix):
        self.db, self.gateway, self.prefix = db, gateway, prefix

    def _rows(self, session, stream_id):
        return [
            dict(offer_id=o.offer_id, share=o.share, pinned=o.pinned, removed=o.removed)
            for o in session.scalars(
                select(StreamOffer)
                .where(StreamOffer.stream_id == stream_id)
                .order_by(StreamOffer.offer_id)
            )
        ]

    def _save_rows(self, session, stream_id, rows):
        session.execute(delete(StreamOffer).where(StreamOffer.stream_id == stream_id))
        session.add_all([StreamOffer(stream_id=stream_id, **r) for r in rows])
        session.flush()

    def _cache_offers(self, session, offers):
        for o in offers:
            saved = session.get(Offer, int(o["id"]))
            if saved is None:
                saved = Offer(id=int(o["id"]))
                session.add(saved)
            saved.name, saved.state = o["name"], o.get("state", "active")
        session.flush()

    def offers(self, query=""):
        offers = self.gateway.list_offers(query)
        with self.db.session.begin() as session:
            self._cache_offers(session, offers)
        return offers

    def _visitor_url(self, alias):
        # Only the public path is shared, never remote tokens or arbitrary URLs.
        if self.gateway.mode == "demo" or not isinstance(alias, str):
            return None
        if not re.fullmatch(r"[A-Za-z0-9_-]+", alias):
            return None
        try:
            origin = urlsplit(self.gateway.url)
            if (
                origin.scheme not in ("https", "http")
                or not origin.hostname
                or origin.username is not None
                or origin.password is not None
            ):
                return None
            return f"{origin.scheme}://{origin.netloc}/{alias}"
        except ValueError:
            return None

    def list_campaigns(self):
        observed_at = utcnow()
        campaigns = self.gateway.list_campaigns()
        # Share only our constructed public preview URL, not private remote fields.
        return [
            {
                **{
                    k: c.get(k)
                    for k in ("id", "name", "state", "domain_id", "group_id", "traffic_source_id")
                },
                "visitor_url": self._visitor_url(c.get("alias")),
                "visitor_url_observed_at": observed_at,
            }
            for c in campaigns
        ]

    def campaign(self, campaign_id):
        with self.db.session() as session:
            campaign = session.get(Campaign, campaign_id)
            if campaign is None:
                raise AppError(404, "Campaign has not been fetched yet.")
            streams = session.scalars(
                select(Stream)
                .where(Stream.campaign_id == campaign_id)
                .order_by(Stream.position, Stream.id)
            ).all()
            return dict(
                id=campaign.id,
                name=campaign.name,
                **{
                    k: campaign.metadata_fields.get(k)
                    for k in ("domain_id", "group_id", "traffic_source_id")
                },
                visitor_url=self._visitor_url(campaign.metadata_fields.get("alias")),
                visitor_url_observed_at=campaign.metadata_fields.get("alias_observed_at", ""),
                available=campaign.available,
                writable=campaign.name.startswith(self.prefix),
                streams=[self._view(session, s) for s in streams],
            )

    def _view(self, session, stream):
        rows = self._rows(session, stream.id)
        for r in rows:
            offer = session.get(Offer, r["offer_id"])
            r["name"] = offer.name if offer else f"Offer {r['offer_id']}"
            r["available"] = bool(offer and offer.state == "active")
        return dict(
            id=stream.id,
            name=stream.name,
            revision=stream.revision,
            editable=stream.editable,
            available=stream.available,
            dirty=stream.dirty,
            status=stream.status,
            messages=stream.messages,
            offers=rows,
            total=sum(r["share"] for r in rows if not r["removed"]),
        )

    def fetch(self, campaign_id):
        with self.db.session() as session:
            if session.scalar(
                select(Stream.id).where(
                    Stream.campaign_id == campaign_id,
                    (Stream.dirty.is_(True)) | (Stream.status.in_(["pushing", "uncertain"])),
                )
            ):
                raise AppError(409, "Cancel or reconcile pending changes before refreshing.")
            revisions = {
                s.id: s.revision
                for s in session.scalars(select(Stream).where(Stream.campaign_id == campaign_id))
            }
        observed_at = utcnow()
        # No dependencies between these reads; persist only after all succeed.
        with ThreadPoolExecutor(max_workers=3) as pool:
            campaign_read = pool.submit(self.gateway.get_campaign, campaign_id)
            stream_read = pool.submit(self.gateway.list_streams, campaign_id)
            offer_read = pool.submit(self.gateway.list_offers)
            campaign, streams, offers = (
                campaign_read.result(),
                stream_read.result(),
                offer_read.result(),
            )
        with self.db.session.begin() as session:
            saved = session.get(Campaign, campaign_id)
            if saved is None:
                saved = Campaign(id=campaign_id)
                session.add(saved)
            saved.name, saved.available = campaign["name"], True
            saved.metadata_fields = {
                k: campaign.get(k) for k in ("domain_id", "group_id", "traffic_source_id", "alias")
            }
            saved.metadata_fields = {**saved.metadata_fields, "alias_observed_at": observed_at}
            # A complete active-offer snapshot also invalidates stale cached entries.
            active_ids = {int(o["id"]) for o in offers}
            for cached in session.scalars(select(Offer)):
                if cached.id not in active_ids:
                    cached.state = "unavailable"
            self._cache_offers(session, offers)
            session.flush()
            seen = set()
            for raw in streams:
                stream_id = int(raw["id"])
                seen.add(stream_id)
                stream = session.get(Stream, stream_id)
                if stream is None:
                    stream = Stream(
                        id=stream_id,
                        campaign_id=campaign_id,
                        name=raw["name"],
                        revision=0,
                        baseline=[],
                        editable=bool(raw.get("offers")),
                    )
                    session.add(stream)
                    session.flush()
                else:
                    changed = session.execute(
                        update(Stream)
                        .where(
                            Stream.id == stream_id,
                            Stream.revision == revisions.get(stream_id, -1),
                            Stream.dirty.is_(False),
                            Stream.status == "ready",
                        )
                        .values(revision=Stream.revision + 1)
                    )
                    if changed.rowcount != 1:
                        raise AppError(409, "The campaign changed while refreshing. Reload it.")
                    session.refresh(stream)
                previous = {r["offer_id"]: r for r in self._rows(session, stream_id)}
                rows, messages = [], []
                for o in raw.get("offers", []):
                    offer_id, share = int(o["offer_id"]), int(o["share"])
                    old = previous.pop(offer_id, None)
                    removed = o.get("state", "active") != "active"
                    pinned = bool(old and old["pinned"] and old["share"] == share and not removed)
                    if old and old["pinned"] and not pinned:
                        messages.append(
                            f"Pin for offer {offer_id} cleared after an external change."
                        )
                    if session.get(Offer, offer_id) is None:
                        session.add(
                            Offer(id=offer_id, name=f"Offer {offer_id}", state="unavailable")
                        )
                        session.flush()
                    rows.append(
                        dict(
                            offer_id=offer_id,
                            share=0 if removed else share,
                            pinned=pinned,
                            removed=removed,
                        )
                    )
                rows.extend(dict(r, removed=True, share=0, pinned=False) for r in previous.values())
                rows.sort(key=lambda r: r["offer_id"])
                self._save_rows(session, stream_id, rows)
                stream.name, stream.position = raw["name"], raw.get("position", 0)
                stream.available, stream.dirty, stream.status = True, False, "ready"
                stream.editable = stream.editable or bool(raw.get("offers"))
                stream.baseline, stream.messages = deepcopy(rows), messages
                stream.remote_fingerprint = fingerprint(raw.get("offers", []))
            for old in session.scalars(select(Stream).where(Stream.campaign_id == campaign_id)):
                if old.id not in seen:
                    if old.dirty or old.status != "ready":
                        raise AppError(
                            409, "A missing stream has pending changes; refresh stopped."
                        )
                    old.available = False
                    old.messages = ["This stream no longer exists in Keitaro."]
        return self.campaign(campaign_id)

    def _claim(self, session, stream_id, revision, *, allow_missing=False):
        stream = session.get(Stream, stream_id)
        if stream is None:
            raise AppError(404, "Stream not found.")
        campaign = session.get(Campaign, stream.campaign_id)
        if not campaign.name.startswith(self.prefix):
            raise AppError(403, "Writing is limited to campaigns with the configured test prefix.")
        if not stream.available and not allow_missing:
            raise AppError(409, "This stream is no longer available in Keitaro.")
        if not stream.editable:
            raise AppError(
                422, "This stream has no offer list to edit. Its settings are preserved."
            )
        claim = session.execute(
            update(Stream)
            .where(Stream.id == stream_id, Stream.revision == revision, Stream.status == "ready")
            .values(revision=Stream.revision + 1)
        )
        if claim.rowcount != 1:
            raise AppError(409, "Stream changed or synchronization is in progress. Reload it.")
        session.refresh(stream)
        return stream

    def edit(self, stream_id, request):
        found = None
        if request.action in ("add", "restore"):
            found = next(
                (
                    o
                    for o in self.gateway.list_offers(str(request.offer_id))
                    if o["id"] == request.offer_id and o.get("state", "active") == "active"
                ),
                None,
            )
            if found is None:
                raise AppError(422, "This offer is unavailable in Keitaro.")
        with self.db.session.begin() as session:
            stream = self._claim(session, stream_id, request.expected_revision)
            rows = self._rows(session, stream_id)
            target = next((r for r in rows if r["offer_id"] == request.offer_id), None)
            if request.action == "add":
                if target is not None:
                    raise AppError(
                        422, "Offer already exists here. Use Restore for an archived offer."
                    )
                self._cache_offers(session, [found])
                rows.append(dict(offer_id=request.offer_id, share=0, pinned=False, removed=False))
            else:
                if target is None:
                    raise AppError(404, "Offer is not part of this stream.")
                if request.action == "remove":
                    if target["removed"]:
                        raise AppError(422, "Offer is already archived.")
                    target.update(removed=True, share=0, pinned=False)
                elif request.action == "restore":
                    if not target["removed"]:
                        raise AppError(422, "Offer is already active.")
                    self._cache_offers(session, [found])
                    target.update(removed=False, pinned=False)
                elif request.action in ("pin", "unpin"):
                    if target["removed"]:
                        raise AppError(422, "Archived offers cannot be pinned.")
                    target["pinned"] = request.action == "pin"
                    if request.share is not None:
                        target["share"] = request.share
            try:
                rows = distribute(rows)
            except WeightError as exc:
                raise AppError(422, str(exc)) from None
            rows.sort(key=lambda r: r["offer_id"])
            self._save_rows(session, stream_id, rows)
            stream.dirty = rows != stream.baseline
            stream.messages = []
            return self._view(session, stream)

    def cancel(self, stream_id, revision):
        with self.db.session.begin() as session:
            stream = self._claim(session, stream_id, revision, allow_missing=True)
            self._save_rows(session, stream_id, deepcopy(stream.baseline))
            stream.dirty, stream.messages = False, []
            return self._view(session, stream)

    def push(self, stream_id, revision):
        with self.db.session.begin() as session:
            stream = self._claim(session, stream_id, revision)
            if not stream.dirty:
                return self._view(session, stream)
            rows = self._rows(session, stream_id)
            active = [r for r in rows if not r["removed"]]
            if not active or sum(r["share"] for r in active) != 100:
                raise AppError(422, "Publish requires active offers with a total weight of 100%.")
            desired = [
                dict(offer_id=r["offer_id"], share=r["share"], state="active") for r in active
            ]
            campaign_id = stream.campaign_id
            baseline = stream.remote_fingerprint
            operation = Operation(
                id=str(uuid4()),
                kind="push",
                status="running",
                payload=dict(stream_id=stream_id, offers=desired),
            )
            session.add(operation)
            stream.status = "pushing"
        status, error, final_fingerprint, missing = "ready", None, None, False
        try:
            current = self.gateway.get_stream(stream_id)
            remote_campaign = self.gateway.get_campaign(campaign_id)
            if current.get("campaign_id") != campaign_id:
                error = AppError(409, "Stream moved to another campaign. Draft retained.")
            elif not remote_campaign["name"].startswith(self.prefix):
                error = AppError(
                    403, "Campaign no longer has the configured test prefix. Draft retained."
                )
            elif fingerprint(current.get("offers", [])) == fingerprint(desired):
                final_fingerprint = fingerprint(desired)  # previous response may have been lost
            elif fingerprint(current.get("offers", [])) != baseline:
                error = AppError(
                    409, "Keitaro offers changed externally. Cancel and refresh before retrying."
                )
            else:
                try:
                    self.gateway.update_stream(stream_id, desired)
                except Exception:
                    pass  # remote response loss does not prove the update failed
                confirmed = self.gateway.get_stream(stream_id)
                final_fingerprint = fingerprint(confirmed.get("offers", []))
                if final_fingerprint != fingerprint(desired):
                    error = AppError(
                        502, "Keitaro did not confirm the change. Your draft is preserved."
                    )
                    status = "ready" if final_fingerprint == baseline else "uncertain"
        except AppError as exc:
            if exc.status == 404:
                missing = True
                error = AppError(
                    404,
                    "Stream no longer exists in Keitaro. Draft retained; Cancel unlocks refresh.",
                )
            else:
                status = "uncertain"
                error = AppError(
                    502, "Remote result is unknown. Reconcile before making more changes."
                )
        except Exception:
            status = "uncertain"
            error = AppError(502, "Remote result is unknown. Reconcile before making more changes.")
        with self.db.session.begin() as session:
            stream = session.get(Stream, stream_id)
            stream.status = status
            if missing:
                stream.available = False
            stream.revision += 1
            op = session.get(Operation, operation.id)
            op.updated_at = utcnow()
            if error:
                stream.messages, op.status = (
                    [error.message],
                    status if status != "ready" else "failed",
                )
            else:
                stream.baseline, stream.dirty = deepcopy(rows), False
                stream.remote_fingerprint, stream.messages = final_fingerprint, []
                op.status, op.result = "confirmed", dict(stream_id=stream_id)
            result = self._view(session, stream)
        if error:
            raise error
        return result

    def reconcile(self, stream_id, revision):
        with self.db.session() as session:
            stream = session.get(Stream, stream_id)
            if stream is None:
                raise AppError(404, "Stream not found.")
            if stream.status == "pushing":
                # A running worker may still be writing. Never unlock it from a second tab.
                raise AppError(
                    409, "A push is running. If the process stopped, restart with recover-pushes."
                )
            if stream.revision != revision or stream.status != "uncertain":
                raise AppError(409, "Reload the stream before reconciliation.")
            rows = self._rows(session, stream_id)
            desired = [
                dict(offer_id=r["offer_id"], share=r["share"], state="active")
                for r in rows
                if not r["removed"]
            ]
            old = stream.remote_fingerprint
        missing = False
        try:
            current = fingerprint(self.gateway.get_stream(stream_id).get("offers", []))
        except AppError as exc:
            if exc.status != 404:
                raise
            missing, current = True, None
        with self.db.session.begin() as session:
            changed = session.execute(
                update(Stream)
                .where(
                    Stream.id == stream_id,
                    Stream.revision == revision,
                    Stream.status == "uncertain",
                )
                .values(revision=Stream.revision + 1, status="ready")
            )
            if changed.rowcount != 1:
                raise AppError(409, "Stream changed during reconciliation.")
            stream = session.get(Stream, stream_id)
            if missing:
                stream.available = False
                stream.messages = [
                    "Stream no longer exists in Keitaro. Draft retained; Cancel unlocks refresh."
                ]
            elif current == fingerprint(desired):
                stream.baseline, stream.dirty = rows, False
                stream.remote_fingerprint, stream.messages = current, []
            elif current == old:
                stream.messages = ["Remote state unchanged. The draft can be published again."]
            else:
                stream.messages = ["External change detected. Cancel and refresh to import it."]
            return self._view(session, stream)
