const cloud = require("./wx-compat");

const db = cloud.database();
const CONFIG_COLLECTION = "app_config";
const PRICING_DOCUMENT_ID = "pricing";
const CACHE_TTL_MS = 5 * 60 * 1000;

const DEFAULT_PRICING = Object.freeze({
  membershipPriceFen: 9900,
  packagePriceFen: 990,
});

let cachedPricing = null;
let cacheExpiresAt = 0;

function validPrice(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

async function getPricing() {
  const now = Date.now();
  if (cachedPricing && now < cacheExpiresAt) {
    return cachedPricing;
  }

  let pricing = DEFAULT_PRICING;
  try {
    const response = await db
      .collection(CONFIG_COLLECTION)
      .doc(PRICING_DOCUMENT_ID)
      .get();
    const document = response.data || {};
    pricing = Object.freeze({
      membershipPriceFen: validPrice(
        document.membershipPriceFen,
        DEFAULT_PRICING.membershipPriceFen
      ),
      packagePriceFen: validPrice(
        document.packagePriceFen,
        DEFAULT_PRICING.packagePriceFen
      ),
    });
  } catch (error) {
    pricing = DEFAULT_PRICING;
  }

  cachedPricing = pricing;
  cacheExpiresAt = now + CACHE_TTL_MS;
  return pricing;
}

module.exports = { getPricing, DEFAULT_PRICING };
