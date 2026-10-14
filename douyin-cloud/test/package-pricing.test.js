const assert = require("node:assert/strict");
const test = require("node:test");

function queryResult(data) {
  return {
    where() {
      return this;
    },
    orderBy() {
      return this;
    },
    field() {
      return this;
    },
    async get() {
      return { data };
    },
  };
}

function loadPackageData() {
  const packageDataPath = require.resolve("../server/functions/packageData");
  const compatibilityPath = require.resolve("../server/wx-compat");
  const pricingPath = require.resolve("../server/pricing");
  delete require.cache[packageDataPath];

  const pkg = {
    _id: "topic_01",
    title: "测试专题",
    status: "published",
    chapterCount: 1,
    chapters: [{ isFree: false }],
  };
  const chapter = {
    _id: "topic_01_ch01",
    packageId: "topic_01",
    chapterIndex: 1,
    title: "第一章",
    status: "published",
    isFree: false,
    sections: [],
  };

  const database = {
    command: { in: (values) => values },
    collection(name) {
      if (name === "communication_packages") {
        return Object.assign(queryResult([pkg]), {
          doc() {
            return { get: async () => ({ data: pkg }) };
          },
        });
      }
      if (name === "communication_chapters") {
        return Object.assign(queryResult([chapter]), {
          doc() {
            return { get: async () => ({ data: chapter }) };
          },
        });
      }
      throw new Error(`unexpected collection: ${name}`);
    },
  };

  require.cache[compatibilityPath] = {
    id: compatibilityPath,
    filename: compatibilityPath,
    loaded: true,
    exports: {
      DYNAMIC_CURRENT_ENV: Symbol("DYNAMIC_CURRENT_ENV"),
      init() {},
      database: () => database,
      getWXContext: () => ({}),
    },
  };
  require.cache[pricingPath] = {
    id: pricingPath,
    filename: pricingPath,
    loaded: true,
    exports: {
      getPricing: async () => ({
        membershipPriceFen: 9900,
        packagePriceFen: 1,
      }),
    },
  };

  return require("../server/functions/packageData");
}

test("uses the configured package price for list, detail, and chapter views", async () => {
  const packageData = loadPackageData();
  const list = await packageData.main({ action: "list" });
  const detail = await packageData.main({
    action: "detail",
    packageId: "topic_01",
  });
  const chapter = await packageData.main({
    action: "chapter",
    chapterId: "topic_01_ch01",
  });

  assert.equal(list.packages[0].priceText, "¥0.01");
  assert.equal(detail.package.priceText, "¥0.01");
  assert.equal(chapter.package.priceText, "¥0.01");
});
