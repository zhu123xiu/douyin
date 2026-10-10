const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const inputPath = path.join(root, "cloudfunctions/importData/data/communication_topics.json");
const outputPath = path.join(root, "cloudfunctions/importData/data/communication_topics.v2.json");
const shouldWrite = process.argv.includes("--write");

const records = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const ids = new Set();
const counts = {};
const missingContentType = [];
const duplicates = [];

const upgraded = records.map((record) => {
  if (ids.has(record._id)) {
    duplicates.push(record._id);
  }
  ids.add(record._id);
  counts[record.ageGroup] = (counts[record.ageGroup] || 0) + 1;
  if (!record.contentType) {
    missingContentType.push(record._id);
  }
  return Object.assign({}, record, {
    contentType: record.contentType || "response",
    tags: Array.isArray(record.tags) ? record.tags : [],
  });
});

const report = {
  counts,
  total: upgraded.length,
  missingContentType,
  duplicates,
  output: shouldWrite ? outputPath : null,
};

console.log(JSON.stringify(report, null, 2));

if (shouldWrite) {
  fs.writeFileSync(outputPath, `${JSON.stringify(upgraded, null, 2)}\n`, "utf8");
}
