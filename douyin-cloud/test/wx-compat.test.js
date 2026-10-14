const assert = require("node:assert/strict");
const test = require("node:test");

function loadCompatibilityLayer() {
  const calls = {};
  const documentReference = {
    async get() {
      return { data: [{ _id: "doc-1", value: 1 }] };
    },
    async set(value) {
      calls.set = value;
      return { ok: true };
    },
    async update(value) {
      calls.docUpdate = value;
      return { ok: true };
    },
  };
  const query = {
    async update(value) {
      calls.queryUpdate = value;
      return { ok: true };
    },
  };
  const collection = {
    async add(value) {
      calls.add = value;
      return { ok: true };
    },
    doc() {
      return Object.assign({}, documentReference);
    },
    where() {
      return Object.assign({}, query);
    },
  };
  const fakeDatabase = {
    collection() {
      return Object.assign({}, collection);
    },
    serverDate() {
      return "server-date";
    },
  };
  const databasePath = require.resolve("../server/db");
  const compatibilityPath = require.resolve("../server/wx-compat");
  delete require.cache[compatibilityPath];
  require.cache[databasePath] = {
    id: databasePath,
    filename: databasePath,
    loaded: true,
    exports: fakeDatabase,
  };
  return { cloud: require("../server/wx-compat"), calls };
}

test("normalizes CloudBase document and write semantics", async () => {
  const { cloud, calls } = loadCompatibilityLayer();
  const database = cloud.database();
  const collection = database.collection("items");
  const result = await collection.doc("doc-1").get();
  assert.deepEqual(result.data, { _id: "doc-1", value: 1 });

  await collection.doc("doc-1").set({ data: { _id: "doc-1", value: 2 } });
  await collection.doc("doc-1").update({ data: { value: 3 } });
  await collection.add({ data: { value: 4 } });
  await collection.where({ value: 4 }).update({ data: { value: 5 } });

  assert.deepEqual(calls.set, { value: 2 });
  assert.deepEqual(calls.docUpdate, { value: 3 });
  assert.deepEqual(calls.add, { value: 4 });
  assert.deepEqual(calls.queryUpdate, { value: 5 });
});

test("isolates openid between concurrent requests", async () => {
  const { cloud } = loadCompatibilityLayer();
  const read = (openid, delay) =>
    cloud.runWithOpenid(openid, async () => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return cloud.getWXContext().OPENID;
    });
  assert.deepEqual(await Promise.all([read("alpha", 10), read("beta", 1)]), [
    "alpha",
    "beta",
  ]);
});

test("throws for a missing document like wx-server-sdk", async () => {
  const { cloud } = loadCompatibilityLayer();
  const database = cloud.database();
  const collection = database.collection("missing-items");
  const reference = collection.doc("missing");
  reference.get = async () => ({ data: [] });
  // Recreate the compatibility layer around an empty document response.
  const emptyDatabasePath = require.resolve("../server/db");
  const compatibilityPath = require.resolve("../server/wx-compat");
  delete require.cache[compatibilityPath];
  require.cache[emptyDatabasePath].exports = {
    collection() {
      return {
        add: async () => ({}),
        doc() {
          return {
            get: async () => ({ data: [] }),
            set: async () => ({}),
            update: async () => ({}),
          };
        },
        where() {
          return { update: async () => ({}) };
        },
      };
    },
    serverDate() {},
  };
  const emptyCloud = require("../server/wx-compat");
  await assert.rejects(
    emptyCloud.database().collection("items").doc("missing").get(),
    /document not exists/
  );
});
