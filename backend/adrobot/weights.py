"""Integer traffic allocation; no database or HTTP dependencies."""


class WeightError(ValueError):
    pass


def distribute(rows: list[dict]) -> list[dict]:
    result = [r.copy() for r in rows]
    if len({r["offer_id"] for r in result}) != len(result):
        raise WeightError("An offer can only occur once in a stream.")
    for r in result:
        if r["removed"]:
            r.update(share=0, pinned=False)
        if type(r["share"]) is not int or not 0 <= r["share"] <= 100:
            raise WeightError("Weights must be integers between 0 and 100.")
    active = [r for r in result if not r["removed"]]
    if not active:
        return result
    fixed = sum(r["share"] for r in active if r["pinned"])
    free = sorted((r for r in active if not r["pinned"]), key=lambda r: r["offer_id"])
    if fixed > 100:
        raise WeightError("Pinned weights exceed 100%.")
    if not free and fixed != 100:
        raise WeightError("All offers are pinned, but their weights do not total 100%.")
    if free:
        quotient, remainder = divmod(100 - fixed, len(free))
        for index, r in enumerate(free):
            r["share"] = quotient + (index < remainder)
    return result
