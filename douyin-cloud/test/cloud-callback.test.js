const assert = require("node:assert/strict");
const test = require("node:test");

test("wraps callback-style callContainer as a Promise", async () => {
  global.tt = {
    createCloud() {
      return {
        callContainer(options) {
          setImmediate(() =>
            options.success({ data: { success: true, marker: "callback" } })
          );
        },
      };
    },
  };
  const modulePath = require.resolve("../../miniprogram/utils/cloud");
  delete require.cache[modulePath];
  const cloud = require("../../miniprogram/utils/cloud");
  const response = await cloud.callFunction({
    name: "topicData",
    data: { action: "counts" },
  });
  assert.equal(response.result.marker, "callback");
  delete global.tt;
});
