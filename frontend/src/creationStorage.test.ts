import { afterEach, expect, it, vi } from "vitest";
import {
  forgetCreation,
  saveCreation,
  savedCreations,
} from "./model/creationStorage";

const creation = (id: string) => ({
  name: `test_${id}`,
  country: "DE",
  domain_id: 1,
  group_id: 2,
  traffic_source_id: 3,
  offer_id: 4,
  operation_id: id,
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

it("retains both operations when another tab saves between canonical and pointer writes", () => {
  const first = creation("first");
  const second = creation("second");
  const write = Storage.prototype.setItem;
  let interrupted = false;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
    this: Storage,
    key,
    value,
  ) {
    if (key === "adrobot.creation" && !interrupted) {
      interrupted = true;
      saveCreation(second);
    }
    write.call(this, key, value);
  });
  saveCreation(first);
  expect(savedCreations()).toEqual(expect.arrayContaining([first, second]));
  forgetCreation(first.operation_id);
  expect(savedCreations()).toEqual([second]);
});

it("retains a new operation saved in another tab between pointer check and cleanup", () => {
  const first = creation("first");
  const second = creation("second");
  saveCreation(first);
  const read = Storage.prototype.getItem;
  let interrupted = false;
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (
    this: Storage,
    key,
  ) {
    const value = read.call(this, key);
    if (key === "adrobot.creation" && !interrupted) {
      interrupted = true;
      saveCreation(second);
    }
    return value;
  });
  forgetCreation(first.operation_id);
  expect(savedCreations()).toEqual([second]);
});

it("preserves unreadable legacy data rather than overwrite a possible remote operation", () => {
  const raw = '{"operation_id":"unfinished", broken';
  localStorage.setItem("adrobot.creation", raw);
  expect(() => saveCreation(creation("new"))).toThrow(/kept unchanged/);
  expect(localStorage.getItem("adrobot.creation")).toBe(raw);
});
