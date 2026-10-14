const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const functionNames = [
  "topicData",
  "trainingService",
  "userData",
  "topicVisit",
];

test("unchanged ported business functions only differ at the SDK require line", () => {
  const projectRoot = path.resolve(__dirname, "../..");
  for (const name of functionNames) {
    const source = fs
      .readFileSync(
        path.join(projectRoot, "cloudfunctions", name, "index.js"),
        "utf8"
      )
      .replace(/\r\n/g, "\n")
      .split("\n");
    const ported = fs
      .readFileSync(
        path.join(projectRoot, "douyin-cloud", "server", "functions", `${name}.js`),
        "utf8"
      )
      .replace(/\r\n/g, "\n")
      .split("\n");

    assert.equal(ported[0], 'const cloud = require("../wx-compat");');
    assert.deepEqual(ported.slice(1), source.slice(1), `${name} has drifted`);
  }
});
