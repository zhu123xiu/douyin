const cloud = require("../wx-compat");
const { getPricing } = require("../pricing");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const PROFILE_COLLECTION = "communication_user_profiles";
const ORDER_COLLECTION = "communication_membership_orders";
const PACKAGE_COLLECTION = "communication_packages";

const MEMBERSHIP_PRODUCT = {
  name: "沟通话题会员",
};

function getRequesterOpenid() {
  const context = cloud.getWXContext() || {};
  return context.FROM_OPENID || context.OPENID || "";
}

async function getProfile(openid) {
  try {
    const response = await db.collection(PROFILE_COLLECTION).doc(openid).get();
    return response.data || {};
  } catch (error) {
    return {};
  }
}

async function getValidPackageIds() {
  const response = await db
    .collection(PACKAGE_COLLECTION)
    .where({ status: "published" })
    .orderBy("sortOrder", "asc")
    .get();
  return (response.data || []).map((item) => item._id);
}

async function getUserPurchases(openid) {
  const pricing = await getPricing();
  const profile = await getProfile(openid);
  const response = await db
    .collection(ORDER_COLLECTION)
    .where({ openid })
    .orderBy("createdAt", "desc")
    .limit(50)
    .get();
  const orders = response.data || [];
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
    membershipPriceFen: pricing.membershipPriceFen,
    packagePriceFen: pricing.packagePriceFen,
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
      deliveryPending: false,
      productName: item.productName,
      goodsPrice: item.goodsPrice,
      createdAt: item.createdAt,
    })),
    paymentSyncPending: orders.some((item) => item.status === "pending"),
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
    const action = event.action || event.type;
    switch (action) {
      case "getUserPurchases":
        return await getUserPurchases(getRequesterOpenid());
      case "checkMembership":
        return await checkMembership(event);
      default:
        throw new Error(`未知只读 type: ${action || ""}`);
    }
  } catch (error) {
    return {
      success: false,
      message: error.message || "payServiceRead 执行失败",
    };
  }
};
