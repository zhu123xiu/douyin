// 按小程序运行版本动态选择云环境：
// 正式版（release）→ prod 环境；开发版/体验版（develop/trial）→ dev 环境
function resolveEnvId() {
  try {
    if (
      typeof tt !== "undefined" &&
      typeof tt.getAccountInfoSync === "function"
    ) {
      const info = tt.getAccountInfoSync();
      const envVersion =
        info && info.miniProgram && info.miniProgram.envVersion;
      if (envVersion === "release") {
        return "env-HeV9yb4miF";
      }
    }
  } catch (error) {}
  return "env-XQ5p2D4Owi";
}

module.exports = {
  useSharedCloud: false,
  resourceEnv: "cloudbase-d4gftyk7nccdc2c9c",
  douyin: {
    envId: resolveEnvId(),
    serviceId: "1mgmwf0bio2dl",
    serviceName: "api",
  },
  mockOnly: false,
};
