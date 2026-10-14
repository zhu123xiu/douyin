const cloudConfig = require("../config/cloud");

let initPromise = null;

function getDouyinApi() {
  return typeof tt !== "undefined" ? tt : null;
}

function isDouyinRuntime() {
  const api = getDouyinApi();
  return Boolean(api && typeof api.createCloud === "function");
}

function initCloud() {
  if (isDouyinRuntime()) {
    if (!initPromise) {
      initPromise = Promise.resolve().then(() =>
        getDouyinApi().createCloud({
          envID: cloudConfig.douyin.envId,
          serviceID: cloudConfig.douyin.serviceId,
        })
      );
    }
    return initPromise;
  }

  if (cloudConfig.mockOnly || typeof wx === "undefined" || !wx.cloud) {
    return Promise.resolve();
  }

  if (!initPromise) {
    initPromise = Promise.resolve().then(() => {
      if (cloudConfig.useSharedCloud) {
        const cloud = new wx.cloud.Cloud({ resourceEnv: cloudConfig.resourceEnv });
        cloud.init();
        return cloud;
      }
      wx.cloud.init({ env: cloudConfig.resourceEnv, traceUser: true });
      return wx.cloud;
    });
  }
  return initPromise;
}

function callFunction(options) {
  if (isDouyinRuntime()) {
    const name = options && options.name;
    const data = (options && options.data) || {};
    return initCloud().then((cloud) => {
      if (!cloud || typeof cloud.callContainer !== "function") {
        throw new Error("抖音云服务不可用");
      }
      return new Promise((resolve, reject) => {
        cloud.callContainer({
          path: `/api/${name}`,
          init: {
            method: "POST",
            header: { "content-type": "application/json" },
            body: JSON.stringify(data),
            timeout: 10000,
          },
          success: resolve,
          fail: (error) =>
            reject(new Error(`callContainer fail: ${JSON.stringify(error)}`)),
        });
      }).then((response) => {
        const payload = response && (response.data || response.body || response);
        const result = typeof payload === "string" ? JSON.parse(payload) : payload;
        return { result };
      });
    });
  }

  return initCloud().then((cloud) => {
    if (!cloud || !cloud.callFunction) {
      return Promise.reject(new Error("Cloud function is unavailable in mock mode."));
    }
    return cloud.callFunction(options);
  });
}

module.exports = { initCloud, callFunction, isDouyinRuntime };
