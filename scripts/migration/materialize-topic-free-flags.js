const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const dataPath = path.join(
  root,
  "cloudfunctions/importData/data/communication_topics.json"
);
const ageGroups = ["3-6", "7-9", "10-12"];

function hashText(input) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash +=
      (hash << 1) +
      (hash << 4) +
      (hash << 7) +
      (hash << 8) +
      (hash << 24);
  }
  return hash >>> 0;
}

function selectByAgeGroup(topics, seed, countForAgeGroup) {
  const selected = new Set();
  ageGroups.forEach((ageGroup) => {
    topics
      .filter((topic) => topic.ageGroup === ageGroup)
      .sort((left, right) => {
        const rankDifference =
          hashText(`${seed}:${left._id}`) - hashText(`${seed}:${right._id}`);
        return rankDifference || left._id.localeCompare(right._id);
      })
      .slice(0, countForAgeGroup(ageGroup))
      .forEach((topic) => selected.add(topic._id));
  });
  return selected;
}

const topics = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const proactiveTopics = topics.filter(
  (topic) => topic.contentType === "proactive"
);
const responseTopics = topics.filter(
  (topic) => (topic.contentType || "response") === "response"
);
const proactiveFreeIds = selectByAgeGroup(
  proactiveTopics,
  "proactive-free-v1",
  () => 30
);
const responseFreeIds = selectByAgeGroup(
  responseTopics,
  "response-free-v1",
  (ageGroup) =>
    Math.floor(
      responseTopics.filter((topic) => topic.ageGroup === ageGroup).length * 0.3
    )
);

topics.forEach((topic) => {
  topic.isFree =
    topic.contentType === "proactive"
      ? proactiveFreeIds.has(topic._id)
      : responseFreeIds.has(topic._id);
});

fs.writeFileSync(dataPath, `${JSON.stringify(topics, null, 2)}\n`, "utf8");
console.log(
  `Materialized ${proactiveFreeIds.size} proactive and ${responseFreeIds.size} response free topics.`
);
