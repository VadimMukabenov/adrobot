import json
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

from sqlalchemy import update

from .editor import fingerprint
from .errors import AppError
from .models import Operation, utcnow


class Creator:
    def __init__(self, db, gateway, prefix):
        self.db, self.gateway, self.prefix = db, gateway, prefix

    def operation(self, operation_id):
        with self.db.session() as session:
            op = session.get(Operation, operation_id)
            if op is None or op.kind != "create":
                raise AppError(404, "Creation operation not found.")
            return dict(operation_id=op.id, status=op.status, **op.result)

    def _stage(self, operation_id, phase, **result):
        with self.db.session.begin() as session:
            op = session.get(Operation, operation_id)
            op.result = {**op.result, "phase": phase, **result}
            op.updated_at = utcnow()

    def create(self, request):
        payload = request.model_dump(exclude={"operation_id"})
        with self.db.session() as session:
            existing = session.get(Operation, request.operation_id)
            if existing is not None:
                if existing.kind != "create" or existing.payload.get("input") != payload:
                    raise AppError(409, "This operation ID belongs to a different request.")
                if existing.status in ("confirmed", "running"):
                    return self.operation(request.operation_id)
        if not request.name.startswith(self.prefix):
            raise AppError(422, f"Campaign names must start with {self.prefix}.")
        if existing is None:
            self._validate_dependencies(request, payload)
        with self.db.session.begin() as session:
            op = session.get(Operation, request.operation_id)
            if op is None:
                alias = self.prefix + uuid4().hex[:16]
                session.add(
                    Operation(
                        id=request.operation_id,
                        kind="create",
                        status="running",
                        payload={"input": payload, "alias": alias},
                        result={"phase": "starting"},
                    )
                )
            else:
                claimed = session.execute(
                    update(Operation)
                    .where(
                        Operation.id == request.operation_id,
                        Operation.status.in_(["uncertain", "failed"]),
                    )
                    .values(status="running")
                )
                if claimed.rowcount != 1:
                    raise AppError(409, "This creation is already running. Check its status.")
                alias = op.payload["alias"]
        try:
            # A retry first reconciles a lost POST response by its pre-persisted unique alias.
            op_view = self.operation(request.operation_id)
            campaign_id = op_view.get("campaign_id")
            if campaign_id:
                campaign = self.gateway.get_campaign(campaign_id)
            else:
                # A brand-new alias has never been sent. Only a resumed operation
                # needs the expensive full-index read to reconcile a lost POST.
                matches = (
                    [c for c in self.gateway.list_campaigns() if c.get("alias") == alias]
                    if existing is not None else []
                )
                if len(matches) > 1:
                    raise AppError(409, "Alias is ambiguous. Manual inspection is required.")
                campaign = matches[0] if matches else None
            if existing is not None:
                self._validate_dependencies(request, payload)
            if campaign is None:
                self._stage(request.operation_id, "creating_campaign")
                campaign = self.gateway.create_campaign(
                    dict(
                        alias=alias,
                        name=request.name,
                        type="position",
                        state="disabled",
                        domain_id=request.domain_id,
                        group_id=str(request.group_id),
                        traffic_source_id=request.traffic_source_id,
                    )
                )
            campaign_id = int(campaign["id"])
            self._stage(request.operation_id, "campaign_created", campaign_id=campaign_id)
            streams = self.gateway.list_streams(campaign_id)
            definitions = [
                dict(
                    campaign_id=campaign_id,
                    name="Country redirect",
                    type="regular",
                    position=1,
                    schema="redirect",
                    action_type="http",
                    state="active",
                    action_options={"url": "https://www.google.com/"},
                    collect_clicks=True,
                    filters=[dict(name="country", mode="accept", payload=[request.country])],
                ),
                dict(
                    campaign_id=campaign_id,
                    name="Offers",
                    type="default",
                    position=2,
                    schema="landings",
                    action_type="http",
                    state="active",
                    collect_clicks=True,
                    filters=[],
                    landings=[],
                    offers=[dict(offer_id=request.offer_id, share=100, state="active")],
                ),
            ]
            for definition in definitions:
                matches = [
                    s
                    for s in streams
                    if s["name"] == definition["name"]
                    and s.get("position") == definition["position"]
                ]
                if len(matches) > 1:
                    raise AppError(409, "Duplicate stream found. Manual inspection is required.")
                if not matches:
                    self._stage(request.operation_id, f"creating_stream_{definition['position']}")
                    streams.append(self.gateway.create_stream(definition))
            self._stage(request.operation_id, "verifying_streams")
            actual = self.gateway.list_streams(campaign_id)
            self._verify(actual, request)
            campaign = self.gateway.get_campaign(campaign_id)
            if (
                campaign.get("name") != request.name
                or int(campaign.get("domain_id") or 0) != request.domain_id
                or int(campaign.get("group_id") or 0) != request.group_id
                or int(campaign.get("traffic_source_id") or 0) != request.traffic_source_id
                or campaign.get("type") != "position"
            ):
                raise AppError(409, "Campaign settings do not match the creation request.")
            self._stage(request.operation_id, "enabling_campaign")
            # A lost activation response can already have changed remote state.
            # Reuse the verified read instead of sending the same write again.
            if campaign.get("state") != "active":
                self.gateway.update_campaign(campaign_id, {"state": "active"})
            if self.gateway.get_campaign(campaign_id).get("state") != "active":
                raise AppError(502, "Campaign activation is not confirmed.")
            with self.db.session.begin() as session:
                op = session.get(Operation, request.operation_id)
                op.status, op.updated_at = "confirmed", utcnow()
                op.result = {"phase": "complete", "campaign_id": campaign_id}
        except Exception:
            with self.db.session.begin() as session:
                op = session.get(Operation, request.operation_id)
                op.status, op.updated_at = "uncertain", utcnow()
                op.result = {
                    **op.result,
                    "message": "Creation is not fully confirmed. "
                    "Existing progress is saved; retry this same operation to reconcile.",
                }
        return self.operation(request.operation_id)

    def _validate_dependencies(self, request, payload):
        # These reads are independent. Complete both before any remote write.
        with ThreadPoolExecutor(max_workers=2) as pool:
            lookup_read = pool.submit(self.gateway.lookups)
            offer_read = pool.submit(self.gateway.list_offers, str(request.offer_id))
            lookups, offers = lookup_read.result(), offer_read.result()
        for field, group in [
            ("domain_id", "domains"),
            ("group_id", "groups"),
            ("traffic_source_id", "traffic_sources"),
        ]:
            if payload[field] not in {o["id"] for o in lookups[group]}:
                raise AppError(422, f"The selected {field} is unavailable in Keitaro.")
        if not any(o["id"] == request.offer_id for o in offers):
            raise AppError(422, "The selected offer is unavailable in Keitaro.")

    @staticmethod
    def _verify(streams, request):
        if len(streams) != 2:
            raise AppError(409, "Expected exactly two streams before campaign activation.")
        streams = sorted(streams, key=lambda s: s.get("position", 0))
        country, offers = streams
        filters = country.get("filters", [])
        valid_filter = False
        for f in filters:
            payload = f.get("payload")
            if isinstance(payload, str):
                try:
                    payload = json.loads(payload)
                except ValueError:
                    payload = [payload]
            if (
                f.get("name") == "country"
                and f.get("mode") == "accept"
                and payload == [request.country]
            ):
                valid_filter = True
        url = country.get("action_options", {}).get("url") or country.get("action_payload")
        if (
            not valid_filter
            or len(filters) != 1
            or country.get("state") != "active"
            or country.get("type") != "regular"
            or country.get("position") != 1
            or country.get("offers")
            or country.get("landings")
            or offers.get("state") != "active"
            or offers.get("type") != "default"
            or offers.get("position") != 2
            or offers.get("schema") != "landings"
            or offers.get("action_type") != "http"
            or offers.get("landings")
            or url != "https://www.google.com/"
            or country.get("schema") != "redirect"
            or country.get("action_type") != "http"
            or offers.get("filters")
            or fingerprint(offers.get("offers", []))
            != fingerprint([dict(offer_id=request.offer_id, share=100, state="active")])
        ):
            raise AppError(409, "Created stream configuration did not pass read-back verification.")
