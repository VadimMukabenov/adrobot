import pytest

from adrobot.weights import WeightError, distribute


def row(offer_id, share=0, pinned=False, removed=False):
    return dict(offer_id=offer_id, share=share, pinned=pinned, removed=removed)


@pytest.mark.parametrize(
    "rows,want",
    [
        ([row(1)], [100]),
        ([row(1), row(2), row(3)], [34, 33, 33]),
        ([row(1), row(2), row(3), row(4)], [25, 25, 25, 25]),
        ([row(1, 25, True), row(2), row(3)], [25, 38, 37]),
        ([row(1, 25, True), row(2, removed=True), row(3)], [25, 0, 75]),
        ([row(1, 100, True), row(2)], [100, 0]),
        ([row(1, 20, True), row(2, 80, True)], [20, 80]),
        ([row(1, removed=True)], [0]),
        ([], []),
    ],
)
def test_distribution_preserves_pins_and_assigns_exact_integer_total(rows, want):
    before = [r.copy() for r in rows]
    got = distribute(rows)
    assert [r["share"] for r in got] == want
    assert rows == before  # rejected edits must not mutate a live SQLAlchemy JSON value


def test_remainder_is_stable_by_offer_id_not_client_order():
    got = distribute([row(3), row(1), row(2)])
    assert [(r["offer_id"], r["share"]) for r in got] == [(3, 33), (1, 34), (2, 33)]


@pytest.mark.parametrize(
    "rows",
    [
        [row(1, 60, True), row(2, 50, True)],
        [row(1, 25, True), row(2, 25, True)],
        [row(1, -1, True), row(2)],
        [row(1, 2.5, True), row(2)],
        [row(1, True, True), row(2)],
        [row(1, "25", True), row(2)],
        [row(1), row(1)],
    ],
)
def test_invalid_pins_and_duplicate_associations_are_rejected(rows):
    with pytest.raises(WeightError):
        distribute(rows)


def test_archived_pin_cannot_reserve_any_traffic():
    got = distribute([row(1, 90, True, True), row(2)])
    assert got == [row(1, 0, False, True), row(2, 100)]
