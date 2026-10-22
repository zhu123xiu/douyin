const cloudConfig = require("../config/cloud");

const CLIENT_LOG_URL = `https://${cloudConfig.douyin.serviceId}-${cloudConfig.douyin.envId}.service.douyincloud.run/api/clientLog`;

function stringifyDetail(detail) {
  try {
    const value = typeof detail === "string" ? detail : JSON.stringify(detail);
    return String(value || "unknown").slice(0, 2048);
  } catch (error) {
    return String(detail || "unknown").slice(0, 2048);
  }
}

function reportError(tag, detail) {
  try {
    const api = typeof tt !== "undefined" ? tt : wx;
    if (!api || typeof api.request !== "function") return;
    let page = "";
    try {
      const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
      page = pages.length ? pages[pages.length - 1].route || "" : "";
    } catch (error) {}
    let appVersion = "";
    try {
      appVersion = (api.getSystemInfoSync() || {}).version || "";
    } catch (error) {}
    api.request({
      url: CLIENT_LOG_URL,
      method: "POST",
      header: { "content-type": "application/json" },
      data: {
        appId: "tt711e07a3ef662b0001",
        tag: String(tag || "unknown").slice(0, 128),
        detail: stringifyDetail(detail),
        page,
        appVersion,
      },
      timeout: 5000,
      fail: () => {},
    });
  } catch (error) {}
}

module.exports = { reportError };
