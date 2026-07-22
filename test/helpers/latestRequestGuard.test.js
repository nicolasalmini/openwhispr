const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../../src/helpers/latestRequestGuard.js");

test("invalidating a request prevents its late result from being applied", async () => {
  const { createLatestRequestGuard } = await load();
  const guard = createLatestRequestGuard();
  const first = guard.begin();
  guard.invalidate();
  assert.equal(guard.isCurrent(first), false);
  const second = guard.begin();
  assert.equal(guard.isCurrent(second), true);
});
