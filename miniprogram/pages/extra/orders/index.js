const { getOrders } = require("../../../services/app-service");

function formatPriceFen(priceFen) {
  const price = Number(priceFen || 0) / 100;
  return price.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

function formatDate(value) {
  if (!value) return "时间待同步";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function normalizeOrder(order) {
  const status = String(order.status || "pending").toLowerCase();
  const statusMap = {
    paid: "已完成",
    delivered: "已完成",
    pending: "确认中",
    failed: "支付失败",
    closed: "已关闭",
  };
  return Object.assign({}, order, {
    displayPrice: formatPriceFen(order.goodsPrice),
    createdAtText: formatDate(order.createdAt),
    statusLabel: statusMap[status] || "处理中",
    statusClass: status,
  });
}

Page({
  data: {
    orders: [],
    loading: true,
    errorMessage: "",
  },

  onLoad() {
    this.loadPage();
  },

  onPullDownRefresh() {
    this.loadPage().finally(() => wx.stopPullDownRefresh());
  },

  loadPage() {
    this.setData({ loading: true, errorMessage: "" });
    return getOrders()
      .then((orders) => {
        this.setData({ orders: (orders || []).map(normalizeOrder) });
      })
      .catch((error) => {
        this.setData({ errorMessage: error.message || "订单加载失败，请稍后重试" });
      })
      .finally(() => this.setData({ loading: false }));
  },

  onByteHiContact(event) {
    const detail = (event && event.detail) || {};
    if (detail.errNo === undefined || Number(detail.errNo) === 0) return;
    wx.showModal({
      title: "客服暂不可用",
      content: "请通过「意见反馈」留言，我们会尽快处理。",
      showCancel: false,
      confirmText: "知道了",
    });
  },
});
