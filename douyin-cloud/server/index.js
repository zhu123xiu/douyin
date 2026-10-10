const crypto = require("crypto");
const https = require("https");
const express = require("express");
const db = require("./db");
const app = express();
app.use(express.json({ limit: "1mb" }));
const c = { topics: "communication_topics", packages: "communication_packages", profiles: "communication_user_profiles", orders: "communication_membership_orders", activations: "communication_activation_codes" };
const openid = (req) => String(req.get("x-tt-openid") || req.body.openid || "").trim();
const ok = (data) => ({ success: true, ...data });
function sign(params) {
  const skip = new Set(["app_id", "thirdparty_id", "sign", "other_settle_params"]);
  const text = Object.keys(params).filter((key) => !skip.has(key) && params[key] !== "" && params[key] != null).sort().map((key) => `${key}=${params[key]}`).join("&");
  return crypto.createHash("md5").update(text + (process.env.DOUYIN_PAY_SALT || ""), "utf8").digest("hex");
}
function postJson(path, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const request = https.request(`https://developer.toutiao.com/api/apps/ecpay/v1${path}`, { method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) } }, (response) => {
      let text = ""; response.on("data", (chunk) => { text += chunk; }); response.on("end", () => { try { resolve(JSON.parse(text)); } catch (error) { reject(error); } });
    });
    request.on("error", reject); request.write(body); request.end();
  });
}
async function createPlatformOrder(order) {
  if (!process.env.DOUYIN_MERCHANT_ID || !process.env.DOUYIN_PAY_SALT || !process.env.PAY_NOTIFY_URL) return null;
  const params = { app_id: process.env.DOUYIN_APP_ID, merchant_id: process.env.DOUYIN_MERCHANT_ID, out_order_no: order.outOrderNo, uid: order.openid, timestamp: Math.floor(Date.now() / 1000), total_amount: order.amountFen, currency: "CNY", subject: order.subject, body: order.subject, valid_time: 900, notify_url: process.env.PAY_NOTIFY_URL };
  params.sign = sign(params);
  const response = await postJson("/create_order", params);
  if (response.err_no !== 0) throw new Error(response.message || "抖音预下单失败");
  return response.data;
}
async function profileFor(id) { if (!id) return {}; const r = await db.collection(c.profiles).where({ openid: id }).limit(1).get(); return r.data && r.data[0] ? r.data[0] : {}; }
async function topicData(req, res) {
  const action = req.body.action || "list"; const col = db.collection(c.topics);
  if (action === "counts" || action === "libraryStats") { const r = await col.limit(1000).get(); const rows = r.data || []; const counts = {}; rows.forEach((x) => { counts[x.ageGroup] = (counts[x.ageGroup] || 0) + 1; }); const freeCount = rows.filter((x) => x.freeToRead || x.isFree).length; return res.json(ok({ counts, totalCount: rows.length, freeCount, percent: rows.length ? Math.round(freeCount * 100 / rows.length) : 0 })); }
  if (action === "detail") { const r = await col.doc(req.body.id).get(); if (!r.data) return res.json(ok({ topic: null, locked: false })); const p = await profileFor(openid(req)); const unlocked = Boolean(p.membershipActive || p.activated || (p.unlockedTopicIds || []).includes(req.body.id)); return res.json(ok({ topic: r.data, locked: !(r.data.freeToRead || r.data.isFree || unlocked), freeToRead: Boolean(r.data.freeToRead || r.data.isFree), todayFree: false })); }
  const where = {}; ["ageGroup", "contentType", "level1"].forEach((key) => { if (req.body[key]) where[key] = req.body[key]; }); const r = await col.where(where).skip(Number(req.body.skip) || 0).limit(Math.min(Number(req.body.limit) || 50, 100)).get(); return res.json(ok({ topics: r.data || [], total: (r.data || []).length, hasMore: false }));
}
async function packageData(req, res) { const col = db.collection(c.packages); if (req.body.action === "detail") { const r = await col.doc(req.body.id).get(); return res.json(ok({ package: r.data || null })); } const r = await col.limit(100).get(); return res.json(ok({ packages: r.data || [] })); }
async function userData(req, res) { const id = openid(req); if (!id) return res.json(ok({ profile: {}, favoriteIds: [] })); const p = await profileFor(id); if (req.body.action === "favoriteIds") return res.json(ok({ favoriteIds: p.favoriteTopicIds || [] })); if (req.body.action === "toggleFavorite") { const ids = Array.isArray(p.favoriteTopicIds) ? p.favoriteTopicIds.slice() : []; const i = ids.indexOf(req.body.topicId); if (i >= 0) ids.splice(i, 1); else ids.push(req.body.topicId); await db.collection(c.profiles).where({ openid: id }).update({ data: { favoriteTopicIds: ids, updatedAt: db.serverDate() } }); return res.json(ok({ favorited: i < 0 })); } return res.json(ok({ profile: p, isMember: Boolean(p.membershipActive || p.activated) })); }
async function pay(req, res) { const id = openid(req); if (!id) return res.status(401).json({ success: false, message: "缺少抖音用户身份" }); const action = req.body.action || req.body.type; if (action === "createOrder") { const itemType = req.body.itemType === "membership" ? "membership" : "package"; const itemId = itemType === "membership" ? "membership" : req.body.itemId; const amountFen = itemType === "membership" ? 5900 : 990; const outOrderNo = `DY${Date.now()}${Math.floor(Math.random() * 10000)}`; await db.collection(c.orders).add({ data: { platform: "douyin", channel: "ecpay", outOrderNo, openid: id, itemType, itemId, amountFen, status: "CREATED", createdAt: db.serverDate() } }); const platformOrder = await createPlatformOrder({ outOrderNo, openid: id, amountFen, subject: itemType === "membership" ? "沟通话题会员" : `专题包 ${itemId}` }); return res.json(ok({ outOrderNo, orderInfo: platformOrder ? { order_id: platformOrder.order_id, order_token: platformOrder.order_token } : { order_id: outOrderNo, order_token: outOrderNo } })); } if (action === "getUserPurchases") { const p = await profileFor(id); return res.json(ok({ isMember: Boolean(p.membershipActive || p.activated), unlockedPackages: p.unlockedPackages || [], unlockedTopicIds: p.unlockedTopicIds || [], purchasedItems: [] })); } if (action === "redeemActivationCode") { const code = String(req.body.code || "").trim().toUpperCase(); const r = await db.collection(c.activations).where({ _id: code, status: "unused" }).limit(1).get(); if (!r.data || !r.data[0]) return res.status(400).json({ success: false, message: "激活码无效或已兑换" }); await db.collection(c.activations).doc(code).update({ data: { status: "redeemed", redeemedBy: id, redeemedAt: db.serverDate() } }); const patch = { membershipActive: true, activated: true, membershipGrantedAt: db.serverDate() }; if ((await profileFor(id))._id) await db.collection(c.profiles).where({ openid: id }).update({ data: patch }); else await db.collection(c.profiles).add({ data: { openid: id, ...patch } }); return res.json(ok({ status: "activated", membershipName: "沟通话题会员" })); } return res.status(400).json({ success: false, message: "未知支付操作" }); }
async function payNotify(req, res) {
  const msg = typeof req.body.msg === "string" ? JSON.parse(req.body.msg) : (req.body.msg || req.body);
  if (sign(msg) !== msg.sign) return res.json({ code: 1, msg: "SIGN_ERROR" });
  if (msg.type !== "payment" || msg.status !== "SUCCESS") return res.json({ code: 0, msg: "SUCCESS" });
  const orderResult = await db.collection(c.orders).where({ outOrderNo: msg.cp_ordno }).limit(1).get();
  const order = orderResult.data && orderResult.data[0];
  if (!order) return res.json({ code: 1, msg: "ORDER_NOT_FOUND" });
  if (order.status === "PAID") return res.json({ code: 0, msg: "SUCCESS" });
  await db.collection(c.orders).where({ outOrderNo: msg.cp_ordno }).update({ data: { status: "PAID", paidAt: db.serverDate(), dyOrderId: msg.order_id } });
  const profile = await profileFor(order.openid);
  const patch = order.itemType === "membership" ? { membershipActive: true, activated: true, membershipGrantedAt: db.serverDate() } : {};
  if (order.itemType === "membership") {
    if (profile._id) await db.collection(c.profiles).where({ openid: order.openid }).update({ data: patch });
    else await db.collection(c.profiles).add({ data: { openid: order.openid, ...patch } });
  }
  return res.json({ code: 0, msg: "SUCCESS" });
}
app.post("/api/topicData", topicData); app.post("/api/packageData", packageData); app.post("/api/userData", userData); app.post("/api/pay", pay); app.post("/api/payService", pay); app.post("/api/trainingService", (req, res) => res.json({ success: true, plans: [], trainingProgress: {}, themeWeekProgress: {} })); app.post("/api/topicVisit", (req, res) => res.json({ success: true, totalCount: 0, viewedCount: 0 })); app.post("/api/pay/notify", payNotify); app.get("/health", (req, res) => res.json({ ok: true, service: "api" })); app.use((e, req, res, next) => res.status(e.status || 500).json({ success: false, message: e.message || "服务异常" }));
const port = Number(process.env.PORT || 3000); if (require.main === module) app.listen(port, () => console.log(`douyin api listening on ${port}`)); module.exports = app;