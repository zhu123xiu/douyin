const assert = require("node:assert/strict");
const test = require("node:test");

function loadPricing(getDocument) {
  const pricingPath = require.resolve("../server/pricing");
  const compatibilityPath = require.resolve("../server/wx-compat");
  delete require.cache[pricingPath];
  require.cache[compatibilityPath] = {
    id: compatibilityPath,
    filename: compatibilityPath,
    loaded: true,
    exports: {
      database() {
        return {
          collection(name) {
            assert.equal(name, "app_config");
            return {
              doc(id) {
                assert.equal(id, "pricing");
                return { get: getDocument };
              },
            };
          },
        };
      },
    },
  };
  return require("../server/pricing");
}

test("reads membership and package prices from app_config/pricing", async () => {
  const { getPricing } = loadPricing(async () => ({
    data: { membershipPriceFen: 12800, packagePriceFen: 1280 },
  }));
  assert.deepEqual(await getPricing(), {
    membershipPriceFen: 12800,
    packagePriceFen: 1280,
  });
});

test("falls back to default prices when pricing cannot be read", async () => {
  const { getPricing, DEFAULT_PRICING } = loadPricing(async () => {
    throw new Error("document not exists");
  });
  assert.deepEqual(await getPricing(), DEFAULT_PRICING);
});

test("caches pricing reads for five minutes", async () => {
  let reads = 0;
  const { getPricing } = loadPricing(async () => {
    reads += 1;
    return {
      data: { membershipPriceFen: 9900, packagePriceFen: 990 },
    };
  });
  const first = await getPricing();
  const second = await getPricing();
  assert.strictEqual(second, first);
  assert.equal(reads, 1);
});
