const FORCE_SANDBOX_FOR_DEBUG = false;

function isIos() {
  try {
    const api = typeof tt !== "undefined" ? tt : wx;
    return api.getSystemInfoSync().platform === "ios";
  } catch (error) {
    return false;
  }
}

function canPurchase() {
  return { allowed: !isIos(), reason: isIos() ? "iOS 暂不支持购买，请使用激活码" : "" };
}

function requestPay(orderInfo) {
  if (typeof tt === "undefined" || typeof tt.pay !== "function") {
    return Promise.reject(new Error("当前抖音版本暂不支持担保支付"));
  }
  return new Promise((resolve, reject) => {
    tt.pay({
      orderInfo,
      success: resolve,
      fail: (error) => reject(new Error((error && error.errMsg) || "支付未完成")),
    });
  });
}

function getPaymentEnv() {
  if (typeof tt !== "undefined") return 0;
  if (FORCE_SANDBOX_FOR_DEBUG) {
    try {
      const accountInfo = wx.getAccountInfoSync();
      if (accountInfo.miniProgram.envVersion === "develop") return 1;
    } catch (error) {}
  }
  return 0;
}

const PAYMENT_PRODUCTS = {
  membership: { productId: "hot_topics_lifetime", goodsPrice: 9900 },
  package: {
    emotion: { productId: "topic_01", goodsPrice: 990 },
    homework: { productId: "topic_02", goodsPrice: 990 },
    screen: { productId: "topic_03", goodsPrice: 990 },
    topic_01: { productId: "topic_01", goodsPrice: 990 },
    topic_02: { productId: "topic_02", goodsPrice: 990 },
    topic_03: { productId: "topic_03", goodsPrice: 990 },
  },
};

function getPaymentProduct(itemType, itemId) {
  if (itemType === "membership") return PAYMENT_PRODUCTS.membership;
  return PAYMENT_PRODUCTS.package[itemId] || null;
}

module.exports = { canPurchase, getPaymentEnv, getPaymentProduct, requestPay };
