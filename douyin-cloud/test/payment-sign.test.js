const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("uses the official ecpay value-only signature algorithm", () => {
  const previousSalt = process.env.DOUYIN_PAY_SALT;
  process.env.DOUYIN_PAY_SALT = "pepper";
  try {
    const app = require("../server/index");
    const parameters = {
      app_id: "ignored-app-id",
      sign: "ignored-signature",
      merchant_id: 123,
      timestamp: 456,
      total_amount: 2,
      body: " 会员 ",
      enabled: false,
      empty: "",
      nullText: "null",
      absent: null,
    };
    const expected = crypto
      .createHash("md5")
      .update("123&2&456&false&pepper&会员", "utf8")
      .digest("hex");

    assert.equal(app.locals.ecpaySign(parameters), expected);
  } finally {
    if (previousSalt === undefined) {
      delete process.env.DOUYIN_PAY_SALT;
    } else {
      process.env.DOUYIN_PAY_SALT = previousSalt;
    }
  }
});

test("surfaces the ecpay err_tips response when order creation fails", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../server/index.js"),
    "utf8"
  );
  assert.match(
    source,
    /response\.err_tips\s*\|\|\s*response\.message\s*\|\|\s*"抖音预下单失败"/
  );
});
