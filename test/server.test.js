import test from "node:test";
import assert from "node:assert/strict";
import { dateRange } from "../src/server.js";

test("dateRange includes the complete inclusive end date", () => {
  const range = dateRange("2026-08-01", "2026-08-22");
  assert.equal(range.from.toISOString(), "2026-08-01T00:00:00.000Z");
  assert.equal(range.toExclusive.toISOString(), "2026-08-23T00:00:00.000Z");
});

test("dateRange supports open bounds", () => {
  const range = dateRange(undefined, undefined);
  assert.equal(range.from, null);
  assert.equal(range.toExclusive, null);
});
