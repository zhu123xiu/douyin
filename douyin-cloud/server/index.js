const crypto = require("crypto");
const https = require("https");
const express = require("express");
const cloud = require("./wx-compat");
const { getPricing } = require("./pricing");

const { runWithOpenid } = cloud;
const db = cloud.database();
const app = express();

app.use(express.json({ limit: "1mb" }));

const collections = {
  profiles: "communication_user_profiles",
  orders: "communication_membership_orders",
  activations: "communication_activation_codes",
  packages: "communication_packages",
};

const PORTED_SERVICES = [
  "topicData",
  "packageData",
  "trainingService",
  "userData",
  "topicVisit",
];
const PAY_READ_ACTIONS = new Set(["getUserPurchases", "checkMembership"]);

function requesterOpenid(request) {
  return String(
    request.get("x-tt-openid") || request.body.openid || ""
  ).trim();
}

function success(data) {
  return { success: true, ...data };
}

// Douyin ecpay signs sorted parameter values plus the salt. Parameter names
// are not part of the signed text, and the salt participates in the sort.
function sign(parameters) {
  const skipped = new Set([
    "app_id",
    "thirdparty_id",
    "sign",
    "other_settle_params",
  ]);
  const values = [];
  for (const [key, value] of Object.entries(parameters)) {
    if (skipped.has(key)) continue;
    const text =
      value === null || value === undefined ? "" : String(value).trim();
    if (text === "" || text === "null") continue;
    values.push(text);
  }
  values.push(process.env.DOUYIN_PAY_SALT || "");
  values.sort();
  return crypto
    .createHash("md5")
    .update(values.join("&"), "utf8")
    .digest("hex");
}

app.locals.ecpaySign = sign;

function postJson(path, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const request = https.request(
      `https://developer.toutiao.com/api/apps/ecpay/v1${path}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (response) => {
        let text = "";
        response.on("data", (chunk) => {
          text += chunk;
        });
        response.on("end", () => {
          try {
            resolve(JSON.parse(text));
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

async function createPlatformOrder(order) {
  if (
    !process.env.DOUYIN_MERCHANT_ID ||
    !process.env.DOUYIN_PAY_SALT ||
    !process.env.PAY_NOTIFY_URL
  ) {
    return null;
  }
  const parameters = {
    app_id: process.env.DOUYIN_APP_ID,
    merchant_id: process.env.DOUYIN_MERCHANT_ID,
    out_order_no: order.outTradeNo,
    uid: order.openid,
    timestamp: Math.floor(Date.now() / 1000),
    total_amount: order.amountFen,
    currency: "CNY",
    subject: order.subject,
    body: order.subject,
    valid_time: 900,
    notify_url: process.env.PAY_NOTIFY_URL,
  };
  parameters.sign = sign(parameters);
  const response = await postJson("/create_order", parameters);
  if (response.err_no !== 0) {
    throw new Error(
      response.err_tips || response.message || "抖音预下单失败"
    );
  }
  return response.data;
}

async function getProfile(openid) {
  if (!openid) return {};
  try {
    const response = await db
      .collection(collections.profiles)
      .doc(openid)
      .get();
    return response.data || {};
  } catch (error) {
    return {};
  }
}

async function saveProfile(openid, patch) {
  const current = await getProfile(openid);
  const profile = Object.assign({}, current, patch, {
    createdAt: current.createdAt || db.serverDate(),
    updatedAt: db.serverDate(),
  });
  delete profile._id;
  delete profile._openid;
  await db.collection(collections.profiles).doc(openid).set({ data: profile });
}

async function getPackage(packageId) {
  try {
    const response = await db
      .collection(collections.packages)
      .doc(packageId)
      .get();
    return response.data || null;
  } catch (error) {
    return null;
  }
}

function packageTopicIds(packageDocument) {
  const ids = Array.isArray(packageDocument.topicIds)
    ? packageDocument.topicIds.slice()
    : [];
  Object.keys(packageDocument.partTopics || {}).forEach((key) => {
    (packageDocument.partTopics[key] || []).forEach((topicId) => {
      if (!ids.includes(topicId)) ids.push(topicId);
    });
  });
  return ids;
}

async function grantEntitlement(order) {
  if (order.item_type === "membership") {
    await saveProfile(order.openid, {
      activated: true,
      membershipActive: true,
      membershipName: "沟通话题会员",
      membershipType: "lifetime",
      membershipProductCode: "hot_topics_lifetime",
      membershipPriceFen: order.goodsPrice,
      membershipPurchasedAt: db.serverDate(),
      lastOrderNo: order.outTradeNo,
    });
    return;
  }

  const profile = await getProfile(order.openid);
  const unlockedPackages = Array.isArray(profile.unlockedPackages)
    ? profile.unlockedPackages.slice()
    : [];
  if (!unlockedPackages.includes(order.item_id)) {
    unlockedPackages.push(order.item_id);
  }
  const unlockedTopicIds = Array.isArray(profile.unlockedTopicIds)
    ? profile.unlockedTopicIds.slice()
    : [];
  const packageDocument = (await getPackage(order.item_id)) || {};
  packageTopicIds(packageDocument).forEach((topicId) => {
    if (!unlockedTopicIds.includes(topicId)) unlockedTopicIds.push(topicId);
  });
  await saveProfile(order.openid, {
    unlockedPackages,
    unlockedTopicIds,
    lastOrderNo: order.outTradeNo,
  });
}

async function pay(request, response) {
  const openid = requesterOpenid(request);
  if (!openid) {
    return response
      .status(401)
      .json({ success: false, message: "缺少抖音用户身份" });
  }
  const action = request.body.action || request.body.type;

  if (action === "createOrder") {
    const itemType =
      request.body.itemType === "membership" ? "membership" : "package";
    const itemId = itemType === "membership" ? "" : request.body.itemId;
    const profile = await getProfile(openid);
    const alreadyPurchased =
      itemType === "membership"
        ? Boolean(profile.membershipActive || profile.activated)
        : Boolean(
            profile.membershipActive ||
              profile.activated ||
              (profile.unlockedPackages || []).includes(itemId)
          );
    if (alreadyPurchased) {
      return response.json(success({ alreadyPurchased: true }));
    }

    const packageDocument =
      itemType === "package" ? await getPackage(itemId) : null;
    if (itemType === "package" && !packageDocument) {
      return response
        .status(400)
        .json({ success: false, message: "专题包 itemId 非法" });
    }

    const pricing = await getPricing();
    const amountFen =
      itemType === "membership"
        ? pricing.membershipPriceFen
        : pricing.packagePriceFen;
    const outTradeNo = `DY${Date.now()}${Math.floor(
      Math.random() * 1000000
    )
      .toString()
      .padStart(6, "0")}`;
    const productName =
      itemType === "membership"
        ? "沟通话题会员"
        : request.body.sourceTitle || packageDocument.title || `专题包 ${itemId}`;
    const order = {
      outTradeNo,
      openid,
      productCode:
        itemType === "membership" ? "hot_topics_lifetime" : "topic_package",
      productName,
      membershipType: itemType === "membership" ? "lifetime" : "package",
      item_type: itemType,
      item_id: itemId,
      productId: request.body.productId || "",
      goodsPrice: amountFen,
      sourceKey: request.body.sourceKey || "",
      sourceTitle: request.body.sourceTitle || "",
      paymentMode: "ecpay",
      platform: "douyin",
      channel: "ecpay",
      status: "pending",
      createdAt: db.serverDate(),
      updatedAt: db.serverDate(),
    };
    await db
      .collection(collections.orders)
      .doc(outTradeNo)
      .set({ data: order });
    const platformOrder = await createPlatformOrder({
      outTradeNo,
      openid,
      amountFen,
      subject: productName,
    });
    return response.json(
      success({
        outTradeNo,
        orderInfo: platformOrder
          ? {
              order_id: platformOrder.order_id,
              order_token: platformOrder.order_token,
            }
          : { order_id: outTradeNo, order_token: outTradeNo },
      })
    );
  }

  if (action === "redeemActivationCode") {
    const code = String(request.body.code || "")
      .trim()
      .toUpperCase();
    if (!code) {
      return response
        .status(400)
        .json({ success: false, message: "请输入激活码" });
    }
    let activation;
    try {
      const result = await db
        .collection(collections.activations)
        .doc(code)
        .get();
      activation = result.data;
    } catch (error) {
      activation = null;
    }
    if (!activation || activation.status !== "unused") {
      return response
        .status(400)
        .json({ success: false, message: "激活码无效或已兑换" });
    }
    const claim = await db
      .collection(collections.activations)
      .where({ _id: code, status: "unused" })
      .update({
        data: {
          status: "redeemed",
          redeemedBy: openid,
          redeemedAt: db.serverDate(),
        },
      });
    if (!claim.stats || claim.stats.updated !== 1) {
      return response
        .status(400)
        .json({ success: false, message: "激活码无效或已兑换" });
    }
    const pricing = await getPricing();
    await grantEntitlement({
      openid,
      outTradeNo: `ACTIVATION-${code}`,
      item_type: "membership",
      item_id: "",
      goodsPrice: pricing.membershipPriceFen,
    });
    return response.json(
      success({ status: "activated", membershipName: "沟通话题会员" })
    );
  }

  return response
    .status(400)
    .json({ success: false, message: "未知支付操作" });
}

async function payNotify(request, response) {
  const message =
    typeof request.body.msg === "string"
      ? JSON.parse(request.body.msg)
      : request.body.msg || request.body;
  if (sign(message) !== message.sign) {
    return response.json({ code: 1, msg: "SIGN_ERROR" });
  }
  if (message.type !== "payment" || message.status !== "SUCCESS") {
    return response.json({ code: 0, msg: "SUCCESS" });
  }
  const orderResult = await db
    .collection(collections.orders)
    .where({ outTradeNo: message.cp_ordno })
    .limit(1)
    .get();
  const order = orderResult.data && orderResult.data[0];
  if (!order) {
    return response.json({ code: 1, msg: "ORDER_NOT_FOUND" });
  }
  if (order.status === "paid" || order.status === "delivered") {
    return response.json({ code: 0, msg: "SUCCESS" });
  }
  await db
    .collection(collections.orders)
    .where({ outTradeNo: message.cp_ordno })
    .update({
      data: {
        status: "paid",
        paidAt: db.serverDate(),
        dyOrderId: message.order_id,
        updatedAt: db.serverDate(),
      },
    });
  await grantEntitlement(order);
  return response.json({ code: 0, msg: "SUCCESS" });
}

app.post("/api/pay", pay);
app.post("/api/pay/notify", payNotify);

app.post("/api/payService", async (request, response) => {
  const action = request.body.action || request.body.type;
  if (!PAY_READ_ACTIONS.has(action)) {
    return pay(request, response);
  }
  const handler = require("./functions/payServiceRead");
  const openid = requesterOpenid(request);
  const result = await runWithOpenid(openid, () =>
    handler.main(request.body, {})
  );
  return response.json(result);
});

app.post("/api/:name", async (request, response) => {
  const name = request.params.name;
  if (!PORTED_SERVICES.includes(name)) {
    return response
      .status(404)
      .json({ success: false, message: `unknown service: ${name}` });
  }
  let handler;
  try {
    handler = require(`./functions/${name}`);
  } catch (error) {
    return response
      .status(501)
      .json({ success: false, message: `函数未搬运: ${name}` });
  }
  if (!handler || typeof handler.main !== "function") {
    return response
      .status(501)
      .json({ success: false, message: `非法函数模块: ${name}` });
  }
  const openid = requesterOpenid(request);
  try {
    const result = await runWithOpenid(openid, () =>
      handler.main(request.body, {})
    );
    return response.json(result);
  } catch (error) {
    return response
      .status(500)
      .json({ success: false, message: error.message || "服务异常" });
  }
});

app.get("/health", (request, response) =>
  response.json({ ok: true, service: "api" })
);
app.use((error, request, response, next) =>
  response
    .status(error.status || 500)
    .json({ success: false, message: error.message || "服务异常" })
);

const port = Number(process.env.PORT || 3000);
if (require.main === module) {
  app.listen(port, () => console.log(`douyin api listening on ${port}`));
}

module.exports = app;
