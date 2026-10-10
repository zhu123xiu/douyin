const cloud = require("wx-server-sdk");
const crypto = require("crypto");
const https = require("https");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const PROFILE_COLLECTION = "communication_user_profiles";
const ORDER_COLLECTION = "communication_membership_orders";
const ACTIVATION_CODE_COLLECTION = "communication_activation_codes";
const PACKAGE_COLLECTION = "communication_packages";
const VALID_PACKAGE_IDS_TTL = 5 * 60 * 1000;
const PLATFORM_ORDER_PAID = 2;
const PLATFORM_ORDER_DELIVERING = 3;
const PLATFORM_ORDER_DELIVERED = 4;
let validPackageIdsCache = {
  time: 0,
  ids: [],
};
let accessTokenCache = {
  token: "",
  expiresAt: 0,
};

const MEMBERSHIP_PRODUCT = {
  code: "hot_topics_lifetime",
  name: "沟通话题会员",
  type: "lifetime",
  itemType: "membership",
  productId: "hot_topics_life",
  priceFen: 9900,
};

const PACKAGE_PRODUCT = {
  code: "topic_package",
  name: "沟通专题",
  type: "package",
  itemType: "package",
  productId: "topic_01",
  priceFen: 990,
};

const PACKAGE_PAYMENT_PRODUCTS = {
  emotion: { productId: "topic_01", priceFen: 990 },
  homework: { productId: "topic_02", priceFen: 990 },
  screen: { productId: "topic_03", priceFen: 990 },
  topic_01: { productId: "topic_01", priceFen: 990 },
  topic_02: { productId: "topic_02", priceFen: 990 },
  topic_03: { productId: "topic_03", priceFen: 990 },
  topic_04: { productId: "topic_04", priceFen: 990 },
  topic_05: { productId: "topic_05", priceFen: 990 },
  topic_06: { productId: "topic_06", priceFen: 990 },
  topic_07: { productId: "topic_07", priceFen: 990 },
  topic_08: { productId: "topic_08", priceFen: 990 },
  topic_09: { productId: "topic_09", priceFen: 990 },
  topic_10: { productId: "topic_10", priceFen: 990 },
  topic_11: { productId: "topic_11", priceFen: 990 },
  topic_12: { productId: "topic_12", priceFen: 990 },
  topic_13: { productId: "topic_13", priceFen: 990 },
  anti_spoiling: { productId: "topic_04", priceFen: 990 },
  bridge: { productId: "topic_05", priceFen: 990 },
  bullied: { productId: "topic_06", priceFen: 990 },
  emocoach: { productId: "topic_07", priceFen: 990 },
  games: { productId: "topic_08", priceFen: 990 },
  kindergarten: { productId: "topic_09", priceFen: 990 },
  motivation: { productId: "topic_10", priceFen: 990 },
  pocketmoney: { productId: "topic_11", priceFen: 990 },
  routine: { productId: "topic_12", priceFen: 990 },
  social: { productId: "topic_13", priceFen: 990 },
};

function getRequesterOpenid() {
  const ctx = cloud.getWXContext() || {};
  return ctx.FROM_OPENID || ctx.OPENID || "";
}

function getAppId() {
  const ctx = cloud.getWXContext() || {};
  return ctx.APPID || "";
}

function normalizeEnv(value) {
  return Number(value) === 1 ? 1 : 0;
}

function getConfig() {
  return {
    offerId: process.env.XPAY_OFFER_ID || "",
    appSecret: process.env.XPAY_APP_SECRET || "",
    sandboxAppKey: process.env.XPAY_SANDBOX_APP_KEY || "",
    prodAppKey: process.env.XPAY_PROD_APP_KEY || "",
  };
}

function assertRuntimeConfig(paymentEnv) {
  const config = getConfig();
  if (!config.offerId) {
    throw new Error("未配置 XPAY_OFFER_ID");
  }
  if (!config.appSecret) {
    throw new Error("未配置 XPAY_APP_SECRET");
  }
  if (paymentEnv === 1 && !config.sandboxAppKey) {
    throw new Error("未配置 XPAY_SANDBOX_APP_KEY");
  }
  if (paymentEnv === 0 && !config.prodAppKey) {
    throw new Error("未配置 XPAY_PROD_APP_KEY");
  }
}

function getAppKey(paymentEnv) {
  const config = getConfig();
  return paymentEnv === 1 ? config.sandboxAppKey : config.prodAppKey;
}

async function ensureCollection(name) {
  try {
    await db.createCollection(name);
  } catch (error) {
    const message = String(error && (error.errMsg || error.message || error));
    if (!/exist|already|COLLECTION_EXIST/i.test(message)) {
      throw error;
    }
  }
}

async function getProfile(openid) {
  try {
    const response = await db.collection(PROFILE_COLLECTION).doc(openid).get();
    return response.data || {};
  } catch (error) {
    return {};
  }
}

async function saveProfile(openid, patch) {
  await ensureCollection(PROFILE_COLLECTION);
  const current = await getProfile(openid);
  const profileData = Object.assign({}, current, patch, {
    updatedAt: db.serverDate(),
    createdAt: current.createdAt || db.serverDate(),
  });
  delete profileData._id;
  delete profileData._openid;
  await db.collection(PROFILE_COLLECTION).doc(openid).set({
    data: profileData,
  });
}

async function getValidPackageIds() {
  if (Date.now() - validPackageIdsCache.time < VALID_PACKAGE_IDS_TTL) {
    return validPackageIdsCache.ids.slice();
  }
  try {
    const response = await db
      .collection(PACKAGE_COLLECTION)
      .where({ status: "published" })
      .orderBy("sortOrder", "asc")
      .get();
    const ids = (response.data || []).map((item) => item._id);
    if (ids.length) {
      validPackageIdsCache = {
        time: Date.now(),
        ids,
      };
      return ids.slice();
    }
  } catch (error) {
    // fallback to cached ids
  }
  return validPackageIdsCache.ids.slice();
}

async function getPackageTopicIds(packageId) {
  const response = await db.collection(PACKAGE_COLLECTION).doc(packageId).get();
  const pkg = response.data || {};
  const ids = [];
  Object.keys(pkg.partTopics || {}).forEach((key) => {
    (pkg.partTopics[key] || []).forEach((topicId) => {
      if (ids.indexOf(topicId) < 0) {
        ids.push(topicId);
      }
    });
  });
  return ids;
}

function normalizePriceFen(value, fallback) {
  const price = Number(value);
  if (!Number.isNaN(price) && price > 0) {
    return Math.round(price);
  }
  return fallback;
}

function getProductConfig(itemType, itemId) {
  if (itemType === "membership") {
    return MEMBERSHIP_PRODUCT;
  }
  const packagePaymentProduct = PACKAGE_PAYMENT_PRODUCTS[itemId];
  return packagePaymentProduct
    ? Object.assign({}, PACKAGE_PRODUCT, packagePaymentProduct)
    : null;
}

function buildOutTradeNo() {
  return `HT${Date.now()}${Math.floor(Math.random() * 1000000)
    .toString()
    .padStart(6, "0")}`;
}

function createAttach(payload) {
  return JSON.stringify(payload || {});
}

async function closePendingOrders(openid, itemType, itemId) {
  const response = await db
    .collection(ORDER_COLLECTION)
    .where({
      openid,
      item_type: itemType,
      item_id: itemId || "",
      status: "pending",
    })
    .limit(100)
    .get();
  const pending = response.data || [];
  await Promise.all(
    pending.map((item) =>
      db.collection(ORDER_COLLECTION).doc(item._id).update({
        data: {
          status: "closed",
          closeReason: "recreated_for_retry",
          updatedAt: db.serverDate(),
        },
      })
    )
  );
}

async function createPurchaseOrder(openid, event) {
  const paymentEnv = normalizeEnv(event.env);
  assertRuntimeConfig(paymentEnv);
  await ensureCollection(ORDER_COLLECTION);
  // 用户可能已经支付，但旧版本在发货确认失败后仍把本地订单留在 pending。
  // 创建新订单前先向微信查单修复，避免重复扣款。
  await repairUserPaymentOrders(openid, 5);
  const itemType = event.itemType || MEMBERSHIP_PRODUCT.itemType;
  const itemId = event.itemId || "";
  const profile = await getProfile(openid);
  const isMember = Boolean(profile.membershipActive || profile.activated);

  if (itemType === "membership" && isMember) {
    return {
      success: true,
      alreadyPurchased: true,
      isMember: true,
    };
  }

  if (itemType === "package") {
    const validIds = await getValidPackageIds();
    if (validIds.indexOf(itemId) < 0) {
      throw new Error("专题包 itemId 非法");
    }
    if (
      isMember ||
      (Array.isArray(profile.unlockedPackages) &&
        profile.unlockedPackages.indexOf(itemId) >= 0)
    ) {
      return {
        success: true,
        alreadyPurchased: true,
        isMember,
      };
    }
  }

  const product = getProductConfig(itemType, itemId);
  if (!product) {
    throw new Error("专题包尚未配置微信道具 ID");
  }
  const outTradeNo = buildOutTradeNo();
  await closePendingOrders(openid, itemType, itemId);
  await db.collection(ORDER_COLLECTION).doc(outTradeNo).set({
    data: {
      outTradeNo,
      openid,
      productCode: product.code,
      productName:
        itemType === "package" && event.sourceTitle
          ? event.sourceTitle
          : product.name,
      membershipType: product.type,
      item_type: itemType,
      item_id: itemId,
      productId: product.productId,
      goodsPrice: product.priceFen,
      sourceKey: event.sourceKey || "",
      sourceTitle: event.sourceTitle || "",
      paymentMode: "virtual",
      offerId: getConfig().offerId,
      xpayEnv: paymentEnv,
      status: "pending",
      createdAt: db.serverDate(),
      updatedAt: db.serverDate(),
    },
  });

  return {
    success: true,
    outTradeNo,
  };
}

function requestJson(url, options) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      Object.assign({ method: "GET" }, options || {}),
      (response) => {
        const buffers = [];
        response.on("data", (chunk) => buffers.push(chunk));
        response.on("end", () => {
          const raw = Buffer.concat(buffers).toString("utf8");
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(
              new Error(
                `微信接口 HTTP ${response.statusCode}: ${raw || "无响应内容"}`
              )
            );
            return;
          }
          if (!raw) {
            resolve({});
            return;
          }
          try {
            const json = JSON.parse(raw);
            resolve(json);
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    request.on("error", reject);
    if (options && options.body) {
      request.write(options.body);
    }
    request.end();
  });
}

async function getAccessToken() {
  if (
    accessTokenCache.token &&
    accessTokenCache.expiresAt > Date.now() + 5 * 60 * 1000
  ) {
    return accessTokenCache.token;
  }
  const config = getConfig();
  const appId = getAppId();
  if (!appId) {
    throw new Error("无法获取当前小程序 APPID");
  }
  const url =
    "https://api.weixin.qq.com/cgi-bin/token" +
    "?grant_type=client_credential" +
    `&appid=${encodeURIComponent(appId)}` +
    `&secret=${encodeURIComponent(config.appSecret)}`;
  const response = await requestJson(url);
  if (!response.access_token) {
    throw new Error(
      `获取 access_token 失败: ${
        response.errmsg || response.errcode || "未知错误"
      }`
    );
  }
  accessTokenCache = {
    token: response.access_token,
    expiresAt: Date.now() + Number(response.expires_in || 7200) * 1000,
  };
  return accessTokenCache.token;
}

async function notifyProvideGoods(order) {
  const body = JSON.stringify({
    order_id: order.outTradeNo,
    env: normalizeEnv(order.xpayEnv),
  });
  const paymentEnv = normalizeEnv(order.xpayEnv);
  const paySig = sign(
    `/xpay/notify_provide_goods&${body}`,
    getAppKey(paymentEnv)
  );
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const accessToken = await getAccessToken();
    const response = await requestJson(
      "https://api.weixin.qq.com/xpay/notify_provide_goods" +
        `?access_token=${encodeURIComponent(accessToken)}` +
        `&pay_sig=${encodeURIComponent(paySig)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        body,
      }
    );
    if (!response.errcode || response.errcode === 0) {
      return response;
    }
    if (
      attempt === 0 &&
      (response.errcode === 40001 || response.errcode === 42001)
    ) {
      accessTokenCache = { token: "", expiresAt: 0 };
      continue;
    }
    throw new Error(`微信发货确认失败: ${response.errmsg || response.errcode}`);
  }
  throw new Error("微信发货确认失败");
}

async function queryPlatformOrder(order) {
  const paymentEnv = normalizeEnv(order.xpayEnv);
  const uri = "/xpay/query_order";
  const body = JSON.stringify({
    openid: order.openid,
    env: paymentEnv,
    order_id: order.outTradeNo,
  });
  const paySig = sign(`${uri}&${body}`, getAppKey(paymentEnv));

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const accessToken = await getAccessToken();
    const response = await requestJson(
      "https://api.weixin.qq.com/xpay/query_order" +
        `?access_token=${encodeURIComponent(accessToken)}` +
        `&pay_sig=${encodeURIComponent(paySig)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        body,
      }
    );
    if (!response.errcode || response.errcode === 0) {
      if (!response.order) {
        throw new Error("微信查单成功但未返回订单信息");
      }
      return response.order;
    }
    if (
      attempt === 0 &&
      (response.errcode === 40001 || response.errcode === 42001)
    ) {
      accessTokenCache = { token: "", expiresAt: 0 };
      continue;
    }
    throw new Error(`微信订单查询失败: ${response.errmsg || response.errcode}`);
  }
  throw new Error("微信订单查询失败");
}

async function getSessionKey(code) {
  const config = getConfig();
  const appId = getAppId();
  const url =
    "https://api.weixin.qq.com/sns/jscode2session" +
    `?appid=${encodeURIComponent(appId)}` +
    `&secret=${encodeURIComponent(config.appSecret)}` +
    `&js_code=${encodeURIComponent(code)}` +
    "&grant_type=authorization_code";
  const response = await requestJson(url);
  if (!response.session_key) {
    throw new Error(
      `jscode2session 失败: ${response.errmsg || response.errcode || "未知错误"}`
    );
  }
  return response.session_key;
}

function sign(content, key) {
  return crypto
    .createHmac("sha256", key)
    .update(content, "utf8")
    .digest("hex");
}

function createSignData(params) {
  return JSON.stringify({
    offerId: params.offerId,
    buyQuantity: 1,
    env: params.paymentEnv,
    currencyType: "CNY",
    productId: params.productId,
    goodsPrice: params.goodsPrice,
    outTradeNo: params.outTradeNo,
    attach: params.attach,
  });
}

async function createPaySign(openid, event) {
  const paymentEnv = normalizeEnv(event.env);
  assertRuntimeConfig(paymentEnv);
  await ensureCollection(ORDER_COLLECTION);
  if (!event.code) {
    throw new Error("缺少 wx.login code");
  }
  if (!event.outTradeNo) {
    throw new Error("缺少 outTradeNo");
  }

  const orderResponse = await db.collection(ORDER_COLLECTION).doc(event.outTradeNo).get();
  const order = orderResponse.data;
  if (!order || order.openid !== openid) {
    throw new Error("订单不存在或无权访问");
  }

  if (order.xpayEnv !== paymentEnv) {
    throw new Error("支付环境与订单不一致，请重新发起购买");
  }
  assertRuntimeConfig(paymentEnv);
  const sessionKey = await getSessionKey(event.code);
  const attach = createAttach({
    type: order.item_type,
    id: order.item_id,
    sourceKey: order.sourceKey,
    sourceTitle: order.sourceTitle,
  });
  const signData = createSignData({
    offerId: getConfig().offerId,
    paymentEnv,
    productId: order.productId,
    goodsPrice: order.goodsPrice,
    outTradeNo: order.outTradeNo,
    attach,
  });
  const paySig = sign(`requestVirtualPayment&${signData}`, getAppKey(paymentEnv));
  const signature = sign(signData, sessionKey);

  await db.collection(ORDER_COLLECTION).doc(order._id).update({
    data: {
      updatedAt: db.serverDate(),
    },
  });

  return {
    success: true,
    virtualPayment: {
      mode: "short_series_goods",
      signData,
      paySig,
      signature,
    },
  };
}

async function upsertMembershipProfile(openid, outTradeNo) {
  await saveProfile(openid, {
    activated: true,
    membershipActive: true,
    membershipName: MEMBERSHIP_PRODUCT.name,
    membershipType: MEMBERSHIP_PRODUCT.type,
    membershipProductCode: MEMBERSHIP_PRODUCT.code,
    membershipPriceFen: MEMBERSHIP_PRODUCT.priceFen,
    membershipPurchasedAt: db.serverDate(),
    lastOrderNo: outTradeNo,
  });
}

async function upsertPackageProfile(openid, packageId, outTradeNo) {
  const profile = await getProfile(openid);
  const unlockedPackages = Array.isArray(profile.unlockedPackages)
    ? profile.unlockedPackages.slice()
    : [];
  if (unlockedPackages.indexOf(packageId) < 0) {
    unlockedPackages.push(packageId);
  }
  const unlockedTopicIds = Array.isArray(profile.unlockedTopicIds)
    ? profile.unlockedTopicIds.slice()
    : [];
  const topicIds = await getPackageTopicIds(packageId);
  topicIds.forEach((topicId) => {
    if (unlockedTopicIds.indexOf(topicId) < 0) {
      unlockedTopicIds.push(topicId);
    }
  });
  await saveProfile(openid, {
    unlockedPackages,
    unlockedTopicIds,
    lastOrderNo: outTradeNo,
  });
}

async function grantEntitlement(order) {
  if (order.item_type === "package") {
    await upsertPackageProfile(order.openid, order.item_id, order.outTradeNo);
    return;
  }
  await upsertMembershipProfile(order.openid, order.outTradeNo);
}

function firstString(values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function resolveEventName(event) {
  return firstString([
    event.Event,
    event.event,
    event.eventName,
    event.EventName,
    event.type,
  ]);
}

function resolveOutTradeNo(event) {
  return firstString([
    event.OutTradeNo,
    event.outTradeNo,
    event.out_trade_no,
    event.OrderNo,
    event.orderNo,
    event.order_no,
    event.OrderInfo && event.OrderInfo.OutTradeNo,
    event.OrderInfo && event.OrderInfo.outTradeNo,
    event.orderInfo && event.orderInfo.outTradeNo,
    event.GoodsInfo && event.GoodsInfo.OutTradeNo,
    event.GoodsInfo && event.GoodsInfo.outTradeNo,
    event.goodsInfo && event.goodsInfo.OutTradeNo,
    event.goodsInfo && event.goodsInfo.outTradeNo,
    event.resource && event.resource.outTradeNo,
  ]);
}

function isVirtualPayDeliveryEvent(event) {
  const eventName = resolveEventName(event);
  if (eventName === "xpay_goods_deliver_notify") {
    return true;
  }
  // Some environments wrap the notification as a generic WeChat event and
  // omit the Event field. Presence of payment order data is enough to route
  // it through the idempotent delivery handler.
  return event.MsgType === "event" && Boolean(resolveOutTradeNo(event));
}

function resolveTransactionId(event) {
  return firstString([
    event.TransactionId,
    event.transactionId,
    event.WeChatPayInfo && event.WeChatPayInfo.TransactionId,
    event.WeChatPayInfo && event.WeChatPayInfo.transactionId,
    event.wechatPayInfo && event.wechatPayInfo.transactionId,
  ]);
}

async function handleVirtualPayDelivery(event) {
  await ensureCollection(ORDER_COLLECTION);
  const outTradeNo = resolveOutTradeNo(event);
  if (!outTradeNo) {
    return { ErrCode: 0, ErrMsg: "success" };
  }
  const response = await db.collection(ORDER_COLLECTION).doc(outTradeNo).get();
  const order = response.data;
  if (!order) {
    return { ErrCode: 0, ErrMsg: "success" };
  }

  if (order.status === "delivered" || order.status === "paid") {
    await db.collection(ORDER_COLLECTION).doc(order._id).update({
      data: {
        status: "delivered",
        transactionId: resolveTransactionId(event) || order.transactionId || "",
        deliveredAt: order.deliveredAt || db.serverDate(),
        platformDeliveryConfirmedAt:
          order.platformDeliveryConfirmedAt || db.serverDate(),
        platformDeliveryError: "",
        callbackEvent: resolveEventName(event) || "xpay_goods_deliver_notify",
        callbackPayload: event,
        updatedAt: db.serverDate(),
      },
    });
    await grantEntitlement(order);
    return { ErrCode: 0, ErrMsg: "success" };
  }

  await db.collection(ORDER_COLLECTION).doc(order._id).update({
    data: {
      status: "delivered",
      transactionId: resolveTransactionId(event),
      paidAt: db.serverDate(),
      deliveredAt: db.serverDate(),
      platformDeliveryConfirmedAt: db.serverDate(),
      platformDeliveryError: "",
      callbackEvent: resolveEventName(event) || "xpay_goods_deliver_notify",
      callbackPayload: event,
      updatedAt: db.serverDate(),
    },
  });
  await grantEntitlement(order);
  return { ErrCode: 0, ErrMsg: "success" };
}

async function confirmPaymentDelivery(openid, event) {
  const paymentEnv = normalizeEnv(event.env);
  if (!event.outTradeNo) {
    throw new Error("缺少订单号");
  }

  await ensureCollection(ORDER_COLLECTION);
  const response = await db.collection(ORDER_COLLECTION).doc(event.outTradeNo).get();
  const order = response.data;
  if (!order || order.openid !== openid) {
    throw new Error("订单不存在或无权访问");
  }
  if (order.xpayEnv !== paymentEnv) {
    throw new Error("支付环境与订单不一致");
  }

  let platformOrder;
  try {
    platformOrder = await queryPlatformOrder(order);
  } catch (error) {
    await db.collection(ORDER_COLLECTION).doc(order._id).update({
      data: {
        platformQueryError: error.message || String(error),
        platformQueryLastTriedAt: db.serverDate(),
        updatedAt: db.serverDate(),
      },
    });
    throw error;
  }

  const platformStatus = Number(platformOrder.status);
  const verifiedPaid = [
    PLATFORM_ORDER_PAID,
    PLATFORM_ORDER_DELIVERING,
    PLATFORM_ORDER_DELIVERED,
  ].includes(platformStatus);
  const queryPatch = {
    platformOrderStatus: platformStatus,
    platformOrderId: platformOrder.wx_order_id || "",
    platformTransactionId:
      platformOrder.wxpay_order_id || platformOrder.channel_order_id || "",
    platformPaidTime: platformOrder.paid_time || 0,
    platformProvideTime: platformOrder.provide_time || 0,
    platformQueryError: "",
    platformQueryLastTriedAt: db.serverDate(),
    updatedAt: db.serverDate(),
  };
  await db.collection(ORDER_COLLECTION).doc(order._id).update({
    data: queryPatch,
  });

  if (!verifiedPaid) {
    throw new Error(`微信订单尚未支付，当前状态 ${platformStatus}`);
  }

  // 微信服务端查单确认已经支付后，先保障用户立即获得权益；平台发货确认
  // 是独立的结算步骤，临时失败时不能再阻塞用户权益。
  await db.collection(ORDER_COLLECTION).doc(order._id).update({
    data: {
      status:
        platformStatus === PLATFORM_ORDER_DELIVERED ? "delivered" : "paid",
      paidAt: order.paidAt || db.serverDate(),
      paymentConfirmedBy: "query_order",
      updatedAt: db.serverDate(),
    },
  });
  await grantEntitlement(order);

  if (platformStatus === PLATFORM_ORDER_DELIVERED) {
    await db.collection(ORDER_COLLECTION).doc(order._id).update({
      data: {
        status: "delivered",
        deliveredAt: order.deliveredAt || db.serverDate(),
        platformDeliveryConfirmedAt:
          order.platformDeliveryConfirmedAt || db.serverDate(),
        platformDeliveryError: "",
        updatedAt: db.serverDate(),
      },
    });
    return { success: true, status: "delivered", deliveryPending: false };
  }

  try {
    await notifyProvideGoods(order);
  } catch (error) {
    await db.collection(ORDER_COLLECTION).doc(order._id).update({
      data: {
        platformDeliveryError: error.message || String(error),
        platformDeliveryLastTriedAt: db.serverDate(),
        updatedAt: db.serverDate(),
      },
    });
    console.warn(
      "notify platform delivery failed after entitlement granted",
      order.outTradeNo,
      error.message || error
    );
    return {
      success: true,
      status: "paid",
      deliveryPending: true,
      message: "权益已发放，微信发货状态正在重试同步",
    };
  }

  const deliveryPatch = {
    status: "delivered",
    deliveredAt: order.deliveredAt || db.serverDate(),
    platformDeliveryConfirmedAt:
      order.platformDeliveryConfirmedAt || db.serverDate(),
    platformDeliveryLastTriedAt: db.serverDate(),
    platformDeliveryError: "",
    updatedAt: db.serverDate(),
  };
  await db.collection(ORDER_COLLECTION).doc(order._id).update({
    data: deliveryPatch,
  });
  return { success: true, status: "delivered", deliveryPending: false };
}

async function confirmSandboxPayment(openid, event) {
  const paymentEnv = normalizeEnv(event.env);
  if (paymentEnv !== 1) {
    throw new Error("正式环境只能通过微信发货通知确认支付");
  }
  if (!event.outTradeNo) {
    throw new Error("缺少订单号");
  }

  return confirmPaymentDelivery(openid, event);
}

async function repairUserPaymentOrders(openid, limit) {
  const response = await db
    .collection(ORDER_COLLECTION)
    .where({ openid })
    .orderBy("createdAt", "desc")
    .limit(20)
    .get();
  const orders = response.data || [];
  let attempted = 0;
  for (const order of orders) {
    if (attempted >= limit) {
      break;
    }
    const status = order.status || "pending";
    const repairable =
      status === "pending" ||
      status === "paid" ||
      (status === "delivered" && !order.platformDeliveryConfirmedAt) ||
      (status === "closed" &&
        order.closeReason === "recreated_for_retry" &&
        order.platformOrderStatus === undefined);
    if (!repairable) {
      continue;
    }
    attempted += 1;
    try {
      await confirmPaymentDelivery(openid, {
        env: order.xpayEnv,
        outTradeNo: order.outTradeNo || order._id,
      });
    } catch (error) {
      console.warn(
        "repair payment order failed",
        order.outTradeNo || order._id,
        error.message || error
      );
    }
  }
  return attempted;
}

async function adminRepairDeliveries(event) {
  // 该入口仅供商家在云开发控制台手动触发，小程序端调用（带用户 openid）一律拒绝。
  const ctx = cloud.getWXContext() || {};
  if (ctx.FROM_OPENID || ctx.OPENID) {
    throw new Error("该操作仅允许在云开发控制台调用");
  }
  const limit = Math.min(Math.max(Number(event.limit) || 20, 1), 100);
  await ensureCollection(ORDER_COLLECTION);
  const _ = db.command;
  const where = event.outTradeNo
    ? { outTradeNo: event.outTradeNo }
    : _.or([
        { status: _.in(["pending", "paid"]) },
        { status: "delivered", platformDeliveryConfirmedAt: _.exists(false) },
        {
          status: "closed",
          closeReason: "recreated_for_retry",
          platformOrderStatus: _.exists(false),
        },
      ]);
  const response = await db
    .collection(ORDER_COLLECTION)
    .where(where)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  const results = [];
  for (const order of response.data || []) {
    const key = order.outTradeNo || order._id;
    try {
      const result = await confirmPaymentDelivery(order.openid, {
        env: order.xpayEnv,
        outTradeNo: key,
      });
      results.push({ outTradeNo: key, ok: true, status: result.status });
    } catch (error) {
      results.push({
        outTradeNo: key,
        ok: false,
        error: error.message || String(error),
      });
    }
  }
  return {
    success: true,
    scanned: (response.data || []).length,
    repaired: results.filter((item) => item.ok).length,
    results,
  };
}

async function getUserPurchases(openid) {
  await ensureCollection(ORDER_COLLECTION);
  await repairUserPaymentOrders(openid, 5);
  let profile = await getProfile(openid);
  const orderResponse = await db
    .collection(ORDER_COLLECTION)
    .where({ openid })
    .orderBy("createdAt", "desc")
    .limit(50)
    .get();
  const orders = orderResponse.data || [];

  // A delivery callback can mark an order as delivered before an interrupted
  // profile write. Reapply only missing entitlements when the user next loads.
  for (const order of orders) {
    if (order.status !== "delivered" && order.status !== "paid") {
      continue;
    }
    const isMember = Boolean(profile.membershipActive || profile.activated);
    const packageUnlocked =
      order.item_type === "package" &&
      Array.isArray(profile.unlockedPackages) &&
      profile.unlockedPackages.indexOf(order.item_id) >= 0;
    if ((order.item_type === "membership" && !isMember) ||
        (order.item_type === "package" && !packageUnlocked)) {
      await grantEntitlement(order);
      profile = await getProfile(openid);
    }
  }

  const isMember = Boolean(profile.membershipActive || profile.activated);
  const unlockedPackages = isMember
    ? await getValidPackageIds()
    : Array.isArray(profile.unlockedPackages)
    ? profile.unlockedPackages
    : [];

  return {
    success: true,
    isMember,
    membershipName: profile.membershipName || MEMBERSHIP_PRODUCT.name,
    membershipPriceFen: MEMBERSHIP_PRODUCT.priceFen,
    packagePriceFen: PACKAGE_PRODUCT.priceFen,
    unlockedPackages,
    unlockedTopicIds: Array.isArray(profile.unlockedTopicIds)
      ? profile.unlockedTopicIds
      : [],
    purchasedItems: orders.map((item) => ({
      type: item.item_type,
      id: item.item_id,
      productId: item.productId,
      outTradeNo: item.outTradeNo,
      status: item.status === "delivered" ? "paid" : item.status,
      deliveryPending:
        item.status === "paid" && !item.platformDeliveryConfirmedAt,
      productName: item.productName,
      goodsPrice: item.goodsPrice,
      createdAt: item.createdAt,
    })),
    paymentSyncPending: orders.some(
      (item) => item.status === "pending" ||
        (item.status === "paid" && !item.platformDeliveryConfirmedAt)
    ),
  };
}

async function redeemActivationCode(openid, event) {
  if (!openid) {
    throw new Error("请先登录后再兑换激活码");
  }
  const code = String(event.code || "")
    .trim()
    .toUpperCase();
  if (!code) {
    throw new Error("请输入激活码");
  }
  await ensureCollection(ACTIVATION_CODE_COLLECTION);
  const profile = await getProfile(openid);
  if (profile.membershipActive || profile.activated) {
    throw new Error("当前账号已经是会员");
  }

  let response;
  try {
    response = await db.collection(ACTIVATION_CODE_COLLECTION).doc(code).get();
  } catch (error) {
    throw new Error("激活码无效或已失效");
  }
  const activation = response.data;
  if (!activation || activation.status !== "unused") {
    throw new Error("激活码无效或已兑换");
  }

  const claimResult = await db
    .collection(ACTIVATION_CODE_COLLECTION)
    .where({ _id: code, status: "unused" })
    .update({
      data: {
        status: "redeemed",
        redeemedBy: openid,
        redeemedAt: db.serverDate(),
      },
    });
  if (!claimResult.stats || claimResult.stats.updated !== 1) {
    throw new Error("激活码无效或已兑换");
  }
  try {
    await upsertMembershipProfile(openid, `ACTIVATION-${code}`);
  } catch (error) {
    await db.collection(ACTIVATION_CODE_COLLECTION).doc(code).update({
      data: {
        status: "unused",
        redeemedBy: "",
        redeemedAt: null,
      },
    }).catch(() => {});
    throw error;
  }
  return {
    success: true,
    status: "activated",
    membershipName: MEMBERSHIP_PRODUCT.name,
  };
}

async function checkMembership(event) {
  const openid = event.openid || getRequesterOpenid();
  const profile = await getProfile(openid);
  return {
    success: true,
    isMember: Boolean(profile.membershipActive || profile.activated),
  };
}

exports.main = async (event) => {
  try {
    if (event && isVirtualPayDeliveryEvent(event)) {
      return await handleVirtualPayDelivery(event);
    }

    switch (event.type) {
      case "createPurchaseOrder":
        return await createPurchaseOrder(getRequesterOpenid(), event);
      case "createPaySign":
        return await createPaySign(getRequesterOpenid(), event);
      case "confirmSandboxPayment":
        return await confirmSandboxPayment(getRequesterOpenid(), event);
      case "confirmPaymentDelivery":
        return await confirmPaymentDelivery(getRequesterOpenid(), event);
      case "adminRepairDeliveries":
        return await adminRepairDeliveries(event);
      case "redeemActivationCode":
        return await redeemActivationCode(getRequesterOpenid(), event);
      case "getUserPurchases":
        return await getUserPurchases(getRequesterOpenid());
      case "checkMembership":
        return await checkMembership(event);
      default:
        throw new Error(`未知 type: ${event.type || ""}`);
    }
  } catch (error) {
    return {
      success: false,
      message: error.message || "payService 执行失败",
    };
  }
};
