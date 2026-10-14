// wx-server-sdk compatibility layer for ported WeChat cloud functions.
const { AsyncLocalStorage } = require("async_hooks");
const rawDb = require("./db");

const storage = new AsyncLocalStorage();

function getWXContext() {
  const context = storage.getStore() || {};
  return {
    OPENID: context.openid || "",
    FROM_OPENID: context.openid || "",
    UNIONID: context.unionid || "",
  };
}

function runWithOpenid(openid, fn) {
  return storage.run({ openid }, fn);
}

function unwrapWxData(argument) {
  if (
    argument &&
    !Array.isArray(argument) &&
    typeof argument === "object" &&
    Object.keys(argument).length === 1 &&
    argument.data !== undefined &&
    argument.data !== null &&
    typeof argument.data === "object"
  ) {
    return argument.data;
  }
  return argument;
}

function stripId(document) {
  if (
    document &&
    typeof document === "object" &&
    !Array.isArray(document) &&
    "_id" in document
  ) {
    const copy = Object.assign({}, document);
    delete copy._id;
    return copy;
  }
  return document;
}

function wrapDocRef(reference) {
  const originalGet = reference.get.bind(reference);
  reference.get = async (...arguments_) => {
    const response = await originalGet(...arguments_);
    if (response && Array.isArray(response.data)) {
      if (response.data.length === 0) {
        const error = new Error("document.get:fail document not exists");
        error.errCode = -502004;
        throw error;
      }
      return { ...response, data: response.data[0] };
    }
    return response;
  };
  if (typeof reference.set === "function") {
    const originalSet = reference.set.bind(reference);
    reference.set = (argument) =>
      originalSet(stripId(unwrapWxData(argument)));
  }
  if (typeof reference.update === "function") {
    const originalUpdate = reference.update.bind(reference);
    reference.update = (argument) => originalUpdate(unwrapWxData(argument));
  }
  return reference;
}

function wrapQuery(query) {
  if (query && typeof query.update === "function") {
    const originalUpdate = query.update.bind(query);
    query.update = (argument) => originalUpdate(unwrapWxData(argument));
  }
  return query;
}

function wrapCollection(collection) {
  const originalAdd = collection.add.bind(collection);
  collection.add = (argument) => originalAdd(unwrapWxData(argument));

  const originalDoc = collection.doc.bind(collection);
  collection.doc = (id) => wrapDocRef(originalDoc(id));

  if (typeof collection.where === "function") {
    const originalWhere = collection.where.bind(collection);
    collection.where = (...arguments_) => wrapQuery(originalWhere(...arguments_));
  }
  return collection;
}

const wrappedCollections = new Map();

function database() {
  const wrapped = Object.create(rawDb);
  const originalCollection = rawDb.collection.bind(rawDb);
  wrapped.collection = (name) => {
    if (!wrappedCollections.has(name)) {
      wrappedCollections.set(name, wrapCollection(originalCollection(name)));
    }
    return wrappedCollections.get(name);
  };
  return wrapped;
}

const DYNAMIC_CURRENT_ENV = Symbol("DYNAMIC_CURRENT_ENV");

module.exports = {
  DYNAMIC_CURRENT_ENV,
  init() {},
  getWXContext,
  database,
  serverDate: () => rawDb.serverDate(),
  callFunction({ name, data }) {
    const handler = require(`./functions/${name}`);
    return runWithOpenid(getWXContext().OPENID, () => handler.main(data, {}));
  },
  runWithOpenid,
};
