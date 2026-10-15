const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("builds a trade_basic order signature that can be verified", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const app = require("../server/index");
  const result = app.locals.buildDyOrderParams(
    { outOrderNo: "DY-test", totalAmount: 990, skuList: [] },
    {
      appId: "tt-test",
      keyVersion: 1,
      privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }),
    }
  );
  const authorization = result.byteAuthorization;
  const timestamp = authorization.match(/timestamp=([^,]+)/)[1];
  const nonce = authorization.match(/nonce_str=([^,]+)/)[1];
  const signature = authorization.slice(authorization.indexOf("signature=") + 10);
  const raw = ["POST", "/requestOrder", timestamp, nonce, result.data, ""].join(
    "\n"
  );

  assert.equal(
    crypto
      .createVerify("RSA-SHA256")
      .update(raw)
      .verify(publicKey, signature, "base64"),
    true
  );
});

test("removes the ecpay and tt.pay payment paths", () => {
  const serverSource = fs.readFileSync(
    path.resolve(__dirname, "../server/index.js"),
    "utf8"
  );
  const paymentSource = fs.readFileSync(
    path.resolve(__dirname, "../../miniprogram/config/payment.js"),
    "utf8"
  );
  assert.doesNotMatch(serverSource, /ecpay|createPlatformOrder|msg_signature/i);
  assert.doesNotMatch(paymentSource, /tt\.pay|orderInfo/);
  assert.match(paymentSource, /tt\.requestOrder/);
  assert.match(paymentSource, /tt\.getOrderPayment/);
});
