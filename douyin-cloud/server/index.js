const crypto = require("crypto");
const https = require("https");
const express = require("express");
const cloud = require("./wx-compat");
const { getPricing } = require("./pricing");

const { runWithOpenid } = cloud;
const db = cloud.database();
const app = express();

// The trade_basic callback signature covers the exact request body bytes.
// Capture them before the general JSON parser normalizes the payload.
app.use(
  "/api/pay/notify",
  express.json({
    limit: "1mb",
    verify: (request, _response, buffer) => {
      request.rawBody = buffer.toString("utf8");
    },
  })
);
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
const PAY_READ_ACTIONS = new Set(["getUserPurchases", "getOrders", "checkMembership"]);
const clientLogRate = new Map();

function requesterOpenid(request) {
  return String(
    request.get("x-tt-openid") || request.body.openid || ""
  ).trim();
}

function success(data) {
  return { success: true, ...data };
}

function countUpdated(result) {
  if (!result) return 0;
  if (typeof result.updated === "number") return result.updated;
  if (result.stats && typeof result.stats.updated === "number") {
    return result.stats.updated;
  }
  return 0;
}

let dySecret = null;
let clientToken = null;

async function loadDySecret({ force = false } = {}) {
  if (dySecret && !force) return dySecret;
  const response = await db.collection("platform_secrets").doc("dy_trade").get();
  const data = response && response.data;
  dySecret = Array.isArray(data) ? data[0] : data;
  if (!dySecret) {
    throw new Error("platform_secrets.dy_trade 缺失，无法签名");
  }
  return dySecret;
}

function requestClientToken(secret) {
  return new Promise((resolve, reject) => {
    const query = new URLSearchParams({
      client_key: secret.appId || process.env.DOUYIN_APP_ID || "",
      client_secret: secret.appSecret || "",
      grant_type: "client_credential",
    });
    const request = https.get(
      `https://open.douyin.com/oauth/client_token/?${query.toString()}`,
      { headers: { accept: "application/json" } },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          text += chunk;
        });
        response.on("end", () => {
          try {
            const payload = JSON.parse(text || "{}");
            const data = payload.data || {};
            if (response.statusCode >= 400 || payload.error_code || !data.access_token) {
              const error = new Error(
                payload.description || payload.error_description || "抖音 access-token 获取失败"
              );
              error.statusCode = response.statusCode;
              error.response = payload;
              reject(error);
              return;
            }
            resolve(data);
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    request.on("error", reject);
  });
}

async function getClientToken({ force = false } = {}) {
  const now = Date.now();
  if (
    clientToken &&
    !force &&
    clientToken.accessToken &&
    now < clientToken.expiresAt - 5 * 60 * 1000
  ) {
    return clientToken.accessToken;
  }
  try {
    const secret = await loadDySecret();
    const result = await requestClientToken(secret);
    const expiresIn = Number(result.expires_in || 7200);
    clientToken = {
      accessToken: result.access_token,
      expiresAt: now + expiresIn * 1000,
    };
    return clientToken.accessToken;
  } catch (error) {
    if (!force) return getClientToken({ force: true });
    throw error;
  }
}

function buildDyAuthorization(method, uri, data, secret) {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(8).toString("hex");
  const raw = `${method}\n${uri}\n${timestamp}\n${nonce}\n${data}\n`;
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(raw, "utf8")
    .sign(secret.privateKeyPem, "base64");
  return (
    `SHA256-RSA2048 appid=${secret.appId},nonce_str=${nonce},` +
    `timestamp=${timestamp},key_version=${secret.keyVersion},signature=${signature}`
  );
}

function buildDyOrderParams(orderParams, secret) {
  const data = JSON.stringify(orderParams);
  return {
    data,
    byteAuthorization: buildDyAuthorization("POST", "/requestOrder", data, secret),
  };
}

const TAG_GROUP = {
  401: "tag_group_7272625659888041996",
  402: "tag_group_7272625659888041996",
};

function postOpenApi(path, data, secret, accessToken) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      `https://open.douyin.com/api/trade_basic/v1/developer/${path}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(data),
          "access-token": accessToken,
          "Byte-Authorization": buildDyAuthorization(
            "POST",
            `/api/trade_basic/v1/developer/${path}`,
            data,
            secret
          ),
        },
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          text += chunk;
        });
        response.on("end", () => {
          try {
            const payload = JSON.parse(text || "{}");
            if (response.statusCode >= 400 || payload.err_no) {
              const error = new Error(
                payload.err_tips || payload.message || "抖音 OpenAPI 请求失败"
              );
              error.statusCode = response.statusCode;
              error.response = payload;
              reject(error);
              return;
            }
            resolve(payload);
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    request.on("error", reject);
    request.write(data);
    request.end();
  });
}

async function openApiPost(path, body) {
  const data = JSON.stringify(body || {});
  let secret = await loadDySecret();
  let accessToken = await getClientToken();
  try {
    return await postOpenApi(path, data, secret, accessToken);
  } catch (error) {
    const text = String(error && error.message).toLowerCase();
    const responseText = JSON.stringify(error && error.response || {}).toLowerCase();
    const tokenFailure =
      error && error.statusCode === 403 ||
      /28001003|access.?token|token invalid|forbidden/.test(`${text} ${responseText}`);
    if (tokenFailure) {
      accessToken = await getClientToken({ force: true });
      return postOpenApi(path, data, secret, accessToken);
    }
    if (!/(signature|sign|key.?version|11084)/i.test(text)) throw error;
    secret = await loadDySecret({ force: true });
    accessToken = await getClientToken({ force: true });
    return postOpenApi(path, data, secret, accessToken);
  }
}

app.locals.buildDyOrderParams = buildDyOrderParams;
app.locals.loadDySecret = loadDySecret;
app.locals.getClientToken = getClientToken;
app.locals.openApiPost = openApiPost;

async function getProfile(openid) {
  if (!openid) return {};
  try {
    const response = await db
      .collection(collections.profiles)
      .doc(openid)
      .get();
    const data = Array.isArray(response.data) ? response.data[0] : response.data;
    return data || {};
  } catch (error) {
    return {};
  }
}

async function saveProfile(openid, patch) {
  const current = await getProfile(openid);
  const profile = Object.assign({}, current, patch, {
    createdAt: (current && current.createdAt) || db.serverDate(),
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
    const data = Array.isArray(response.data) ? response.data[0] : response.data;
    return data || null;
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

function cleanProductTitle(value) {
  const text = String(value || "沟通话题服务")
    .replace(/[\\\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  let result = "";
  for (const character of text) {
    const next = result + character;
    if (Buffer.byteLength(next, "utf8") > 256) break;
    result = next;
  }
  return result || "沟通话题服务";
}

function productImageUrl(packageDocument) {
  const icon = packageDocument && packageDocument.icon;
  if (typeof icon === "string" && /^https:\/\//i.test(icon)) return icon;
  return "https://dummyimage.com/600x600/efe9ff/333333.png&text=Parent+Communication";
}

async function grantEntitlement(order) {
  const grantLog = {
    outTradeNo: order.outTradeNo,
    openid: order.openid,
    item_type: order.item_type,
    item_id: order.item_id,
  };
  try {
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
      console.error("[grant]", JSON.stringify({ ...grantLog, success: true }));
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
    console.error("[grant]", JSON.stringify({ ...grantLog, success: true }));
  } catch (error) {
    console.error(
      "[grant]",
      JSON.stringify({
        ...grantLog,
        success: false,
        error: (error && error.message) || "unknown",
      })
    );
    throw error;
  }
}

async function pay(request, response) {
  const action = request.body.action || request.body.type;

  if (action === "invalidateSecret") {
    await loadDySecret({ force: true });
    return response.json(success({}));
  }

  const openid = requesterOpenid(request);
  if (!openid) {
    return response
      .status(401)
      .json({ success: false, message: "缺少抖音用户身份" });
  }

  if (action === "syncOrderStatus") {
    return syncOrderStatus(request, response);
  }

  if (action === "createOrder") {
    const itemType =
      request.body.itemType === "membership" ? "membership" : "package";
    const itemId = itemType === "membership" ? "" : request.body.itemId;
    const [profile, packageDocument, pricing] = await Promise.all([
      getProfile(openid),
      itemType === "package" ? getPackage(itemId) : Promise.resolve(null),
      getPricing(),
    ]);
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

    if (itemType === "package" && !packageDocument) {
      return response
        .status(400)
        .json({ success: false, message: "专题包 itemId 非法" });
    }

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
      paymentMode: "trade_basic",
      platform: "douyin",
      channel: "trade_basic",
      status: "pending",
      createdAt: db.serverDate(),
      updatedAt: db.serverDate(),
    };
    await db
      .collection(collections.orders)
      .doc(outTradeNo)
      .set({ data: order });
    const secret = await loadDySecret();
    const goodsType = itemType === "membership" ? 402 : 401;
    const skuParams = {
      skuList: [
        {
          skuId: request.body.productId || itemId || "hot_topics_lifetime",
          price: amountFen,
          quantity: 1,
          title: cleanProductTitle(productName),
          imageList: [productImageUrl(packageDocument)],
          type: goodsType,
          tagGroupId: TAG_GROUP[goodsType],
        },
      ],
      outOrderNo: outTradeNo,
      totalAmount: amountFen,
      payExpireSeconds: 300,
      orderEntrySchema: { path: "pages/extra/orders/index", params: "" },
      payNotifyUrl: process.env.PAY_NOTIFY_URL || "",
      limitPayWayList: [],
    };
    const preorder = buildDyOrderParams(skuParams, {
      appId: secret.appId || process.env.DOUYIN_APP_ID,
      privateKeyPem: secret.privateKeyPem,
      keyVersion: secret.keyVersion,
    });
    return response.json(
      success({
        outTradeNo,
        data: preorder.data,
        byteAuthorization: preorder.byteAuthorization,
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
    if (countUpdated(claim) !== 1) {
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

function isPaidStatus(value) {
  const status = String(value || "").toUpperCase();
  return ["STATUS_SUCCESS", "SUCCESS", "PAID", "PAY_SUCCESS"].includes(status);
}

async function getOrderByOutTradeNo(outTradeNo) {
  const result = await db
    .collection(collections.orders)
    .where({ outTradeNo })
    .limit(1)
    .get();
  return result.data && result.data[0];
}

async function settlePaidOrder(order, { orderId = "", totalAmount } = {}) {
  if (!order || order.status === "paid" || order.status === "delivered") {
    return true;
  }
  if (
    totalAmount !== undefined &&
    Number(totalAmount) !== Number(order.goodsPrice)
  ) {
    return false;
  }
  const paymentUpdate = await db
    .collection(collections.orders)
    .where({ outTradeNo: order.outTradeNo, status: "pending" })
    .update({
      data: {
        status: "paid",
        paidAt: db.serverDate(),
        dyOrderId: orderId || "",
        updatedAt: db.serverDate(),
      },
    });
  if (countUpdated(paymentUpdate) !== 1) return true;
  await grantEntitlement(order);
  return true;
}

async function syncOrderStatus(request, response) {
  const outOrderNo = String(request.body.outOrderNo || "").trim();
  if (!outOrderNo) return response.json(success({ status: "pending" }));

  const order = await getOrderByOutTradeNo(outOrderNo);
  if (!order) return response.json(success({ status: "pending" }));
  if (order.status === "paid" || order.status === "delivered") {
    return response.json(success({ status: "paid" }));
  }

  let queryResult;
  try {
    queryResult = await openApiPost("order_query/", {
      out_order_no: outOrderNo,
    });
  } catch (error) {
    return response.json(success({ status: "pending" }));
  }

  const queryData = queryResult && queryResult.data
    ? queryResult.data
    : queryResult || {};
  const paymentInfo =
    queryData.payment_info ||
    (queryData.order_info && queryData.order_info.payment_info) ||
    {};
  const payStatus = paymentInfo.pay_status || queryData.pay_status;
  if (!isPaidStatus(payStatus)) {
    const normalized = String(payStatus || "").toUpperCase();
    return response.json(
      success({ status: /FAIL|CANCEL|CLOSED|REFUND/.test(normalized) ? "failed" : "pending" })
    );
  }

  const settled = await settlePaidOrder(order, {
    orderId: queryData.order_id || paymentInfo.order_id || "",
    totalAmount:
      paymentInfo.total_amount !== undefined
        ? paymentInfo.total_amount
        : queryData.total_amount,
  });
  return response.json(success({ status: settled ? "paid" : "failed" }));
}

async function payNotify(request, response) {
  const successResponse = () =>
    response.status(200).json({ err_no: 0, err_tips: "success" });
  const failureResponse = (message) =>
    response.status(200).json({ err_no: 1, err_tips: message });

  const timestamp = request.get("Byte-Timestamp") || "";
  const nonce = request.get("Byte-Nonce-Str") || "";
  const signature = request.get("Byte-Signature") || "";
  const rawBody = request.rawBody || JSON.stringify(request.body || {});
  if (!timestamp || !nonce || !signature) {
    return failureResponse("SIGNATURE_MISSING");
  }

  const verifyWithSecret = (secret) => {
    if (!secret || !secret.platformPublicKeyPem) return false;
    const raw = `${timestamp}\n${nonce}\n${rawBody}\n`;
    return crypto
      .createVerify("RSA-SHA256")
      .update(raw, "utf8")
      .verify(secret.platformPublicKeyPem, signature, "base64");
  };

  let secret = await loadDySecret();
  let verified = verifyWithSecret(secret);
  if (!verified) {
    secret = await loadDySecret({ force: true });
    verified = verifyWithSecret(secret);
  }
  if (!verified) return failureResponse("SIGN_ERROR");

  let message;
  try {
    message =
      typeof request.body.msg === "string"
        ? JSON.parse(request.body.msg)
        : request.body.msg || request.body;
  } catch (error) {
    return failureResponse("INVALID_MESSAGE");
  }

  // Payment, refund and settlement messages share this signed endpoint.
  // Refund/settlement handling is intentionally idempotent and acknowledged
  // here; payment messages continue through the entitlement path below.
  if (request.body.type !== "payment") return successResponse();
  if (message.status !== "SUCCESS") return successResponse();

  const outOrderNo = message.out_order_no;
  if (!outOrderNo) return failureResponse("ORDER_NOT_FOUND");
  const order = await getOrderByOutTradeNo(outOrderNo);
  if (!order) return failureResponse("ORDER_NOT_FOUND");

  if (
    message.total_amount !== undefined &&
    Number(message.total_amount) !== Number(order.goodsPrice)
  ) {
    return failureResponse("AMOUNT_MISMATCH");
  }
  const settled = await settlePaidOrder(order, {
    orderId: message.order_id || "",
    totalAmount: message.total_amount,
  });
  if (!settled) return failureResponse("AMOUNT_MISMATCH");
  return successResponse();
}

app.post("/api/pay", pay);
app.post("/api/pay/syncOrderStatus", syncOrderStatus);
app.post("/api/pay/notify", payNotify);

app.post("/api/clientLog", (request, response) => {
  const identity = String(
    request.get("x-tt-openid") || request.ip || "anonymous"
  );
  const now = Date.now();
  const previous = clientLogRate.get(identity);
  if (!previous || now - previous.startedAt >= 60 * 1000) {
    clientLogRate.set(identity, { startedAt: now, count: 1 });
  } else if (previous.count >= 10) {
    return response.status(429).json({ success: false, message: "日志上报频率过高" });
  } else {
    previous.count += 1;
  }
  const body = request.body || {};
  console.error("[clientLog]", {
    appId: String(body.appId || "").slice(0, 64),
    tag: String(body.tag || "unknown").slice(0, 128),
    detail: String(body.detail || "").slice(0, 2048),
    page: String(body.page || "").slice(0, 256),
    appVersion: String(body.appVersion || "").slice(0, 128),
  });
  return response.json({ success: true });
});

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
