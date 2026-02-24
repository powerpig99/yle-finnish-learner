/**
 * Minimal IndexedDB shim for Node.js tests.
 *
 * Scope is intentionally narrow: it supports only the APIs used by database.js
 * and tests/unit/database.test.js.
 */

const DATABASES = new Map();

function cloneValue(value) {
  return structuredClone(value);
}

function keyToArray(key) {
  return Array.isArray(key) ? key : [key];
}

function compareKeys(a, b) {
  const aArr = keyToArray(a);
  const bArr = keyToArray(b);
  const length = Math.max(aArr.length, bArr.length);
  for (let i = 0; i < length; i++) {
    if (aArr[i] === bArr[i]) continue;
    return aArr[i] < bArr[i] ? -1 : 1;
  }
  return 0;
}

function keyEquals(a, b) {
  return compareKeys(a, b) === 0;
}

function extractByKeyPath(value, keyPath) {
  if (Array.isArray(keyPath)) {
    return keyPath.map((part) => value[part]);
  }
  return value[keyPath];
}

function serializeKey(key) {
  return JSON.stringify(key);
}

class SimpleIDBKeyRange {
  constructor(lower, upper, lowerOpen, upperOpen) {
    this.lower = lower;
    this.upper = upper;
    this.lowerOpen = lowerOpen;
    this.upperOpen = upperOpen;
  }

  includes(key) {
    if (typeof this.lower !== 'undefined' && this.lower !== null) {
      const cmpLower = compareKeys(key, this.lower);
      if (cmpLower < 0 || (this.lowerOpen && cmpLower === 0)) {
        return false;
      }
    }
    if (typeof this.upper !== 'undefined' && this.upper !== null) {
      const cmpUpper = compareKeys(key, this.upper);
      if (cmpUpper > 0 || (this.upperOpen && cmpUpper === 0)) {
        return false;
      }
    }
    return true;
  }

  static bound(lower, upper, lowerOpen = false, upperOpen = false) {
    return new SimpleIDBKeyRange(lower, upper, lowerOpen, upperOpen);
  }

  static upperBound(upper, open = false) {
    return new SimpleIDBKeyRange(undefined, upper, false, open);
  }
}

class SimpleIDBRequest {
  constructor() {
    this.result = undefined;
    this.error = null;
    this.onsuccess = null;
    this.onerror = null;
    this.onblocked = null;
  }

  _emitSuccess(result) {
    this.result = result;
    setTimeout(() => {
      if (typeof this.onsuccess === 'function') {
        this.onsuccess({ target: this });
      }
    }, 0);
  }

  _emitError(error) {
    this.error = error;
    setTimeout(() => {
      if (typeof this.onerror === 'function') {
        this.onerror({ target: this });
      }
    }, 0);
  }
}

function getObjectStoreNames(stores) {
  return {
    contains(name) {
      return stores.has(name);
    },
    item(index) {
      return [...stores.keys()][index] || null;
    },
    get length() {
      return stores.size;
    },
    [Symbol.iterator]() {
      return stores.keys();
    }
  };
}

function createCursor(request, tx, entries, storeState) {
  let index = 0;

  function dispatchNext() {
    if (index >= entries.length) {
      request.result = null;
      if (typeof request.onsuccess === 'function') {
        request.onsuccess({ target: request });
      }
      tx._finishOperation();
      return;
    }

    const current = entries[index];
    const cursor = {
      key: cloneValue(current.key),
      primaryKey: cloneValue(current.primaryKey),
      value: cloneValue(current.value),
      delete() {
        const key = serializeKey(current.primaryKey);
        storeState.records.delete(key);
        return new SimpleIDBRequest();
      },
      continue() {
        index += 1;
        setTimeout(dispatchNext, 0);
      }
    };

    request.result = cursor;
    if (typeof request.onsuccess === 'function') {
      request.onsuccess({ target: request });
    }
  }

  setTimeout(dispatchNext, 0);
}

function createObjectStoreApi(tx, storeState) {
  return {
    put(value) {
      const request = new SimpleIDBRequest();
      tx._startOperation();
      setTimeout(() => {
        try {
          const key = extractByKeyPath(value, storeState.keyPath);
          storeState.records.set(serializeKey(key), cloneValue(value));
          request._emitSuccess(key);
        } catch (error) {
          request._emitError(error);
          tx._abort(error);
          return;
        }
        tx._finishOperation();
      }, 0);
      return request;
    },
    get(key) {
      const request = new SimpleIDBRequest();
      tx._startOperation();
      setTimeout(() => {
        const record = storeState.records.get(serializeKey(key));
        request._emitSuccess(record ? cloneValue(record) : undefined);
        tx._finishOperation();
      }, 0);
      return request;
    },
    getAll() {
      const request = new SimpleIDBRequest();
      tx._startOperation();
      setTimeout(() => {
        const values = [...storeState.records.values()].map((value) => cloneValue(value));
        request._emitSuccess(values);
        tx._finishOperation();
      }, 0);
      return request;
    },
    delete(key) {
      const request = new SimpleIDBRequest();
      tx._startOperation();
      setTimeout(() => {
        storeState.records.delete(serializeKey(key));
        request._emitSuccess(undefined);
        tx._finishOperation();
      }, 0);
      return request;
    },
    clear() {
      const request = new SimpleIDBRequest();
      tx._startOperation();
      setTimeout(() => {
        storeState.records.clear();
        request._emitSuccess(undefined);
        tx._finishOperation();
      }, 0);
      return request;
    },
    count() {
      const request = new SimpleIDBRequest();
      tx._startOperation();
      setTimeout(() => {
        request._emitSuccess(storeState.records.size);
        tx._finishOperation();
      }, 0);
      return request;
    },
    createIndex(name, keyPath, options = {}) {
      storeState.indexes.set(name, {
        name,
        keyPath,
        unique: Boolean(options.unique)
      });
      return {
        name,
        keyPath,
        unique: Boolean(options.unique)
      };
    },
    index(name) {
      const indexState = storeState.indexes.get(name);
      if (!indexState) {
        throw new Error(`Index not found: ${name}`);
      }

      return {
        getAll(query) {
          const request = new SimpleIDBRequest();
          tx._startOperation();
          setTimeout(() => {
            const records = [];
            for (const record of storeState.records.values()) {
              const indexKey = extractByKeyPath(record, indexState.keyPath);
              if (typeof query === 'undefined' || keyEquals(indexKey, query)) {
                records.push(cloneValue(record));
              }
            }
            request._emitSuccess(records);
            tx._finishOperation();
          }, 0);
          return request;
        },
        openCursor(range) {
          const request = new SimpleIDBRequest();
          tx._startOperation();
          const entries = [];
          for (const record of storeState.records.values()) {
            const indexKey = extractByKeyPath(record, indexState.keyPath);
            if (!range || range.includes(indexKey)) {
              const primaryKey = extractByKeyPath(record, storeState.keyPath);
              entries.push({
                key: indexKey,
                primaryKey,
                value: record
              });
            }
          }
          entries.sort((a, b) => compareKeys(a.key, b.key));
          createCursor(request, tx, entries, storeState);
          return request;
        }
      };
    },
    openCursor(range) {
      const request = new SimpleIDBRequest();
      tx._startOperation();
      const entries = [];
      for (const record of storeState.records.values()) {
        const primaryKey = extractByKeyPath(record, storeState.keyPath);
        if (!range || range.includes(primaryKey)) {
          entries.push({
            key: primaryKey,
            primaryKey,
            value: record
          });
        }
      }
      entries.sort((a, b) => compareKeys(a.key, b.key));
      createCursor(request, tx, entries, storeState);
      return request;
    }
  };
}

function createTransaction(connection, storeNames) {
  const tx = {
    error: null,
    oncomplete: null,
    onerror: null,
    onabort: null,
    _pendingOps: 0,
    _aborted: false,
    _completed: false,
    objectStore(name) {
      const storeState = connection._state.stores.get(name);
      if (!storeState) {
        throw new Error(`Object store not found: ${name}`);
      }
      return createObjectStoreApi(tx, storeState);
    },
    _startOperation() {
      this._pendingOps += 1;
    },
    _finishOperation() {
      this._pendingOps -= 1;
      this._checkComplete();
    },
    _checkComplete() {
      if (this._aborted || this._completed) return;
      if (this._pendingOps === 0) {
        this._completed = true;
        setTimeout(() => {
          if (typeof this.oncomplete === 'function') {
            this.oncomplete({ target: this });
          }
        }, 0);
      }
    },
    _abort(error) {
      if (this._aborted || this._completed) return;
      this._aborted = true;
      this.error = error;
      setTimeout(() => {
        if (typeof this.onerror === 'function') {
          this.onerror({ target: this });
        }
        if (typeof this.onabort === 'function') {
          this.onabort({ target: this });
        }
      }, 0);
    }
  };

  if (storeNames.length === 0) {
    tx._checkComplete();
  } else {
    setTimeout(() => tx._checkComplete(), 0);
  }
  return tx;
}

function createConnection(state) {
  return {
    _state: state,
    get name() {
      return state.name;
    },
    get version() {
      return state.version;
    },
    get objectStoreNames() {
      return getObjectStoreNames(state.stores);
    },
    createObjectStore(name, options = {}) {
      if (state.stores.has(name)) {
        throw new Error(`Object store already exists: ${name}`);
      }
      const storeState = {
        name,
        keyPath: options.keyPath,
        records: new Map(),
        indexes: new Map()
      };
      state.stores.set(name, storeState);
      return createObjectStoreApi(
        {
          _startOperation() {},
          _finishOperation() {},
          _abort() {}
        },
        storeState
      );
    },
    deleteObjectStore(name) {
      state.stores.delete(name);
    },
    transaction(storeNames) {
      const names = Array.isArray(storeNames) ? storeNames : [storeNames];
      for (const name of names) {
        if (!state.stores.has(name)) {
          throw new Error(`Object store not found: ${name}`);
        }
      }
      return createTransaction(this, names);
    },
    close() {}
  };
}

const indexedDBShim = {
  open(name, version) {
    const request = new SimpleIDBRequest();

    setTimeout(() => {
      try {
        const existing = DATABASES.get(name);
        if (!existing) {
          const state = {
            name,
            version: typeof version === 'number' ? version : 1,
            stores: new Map()
          };
          DATABASES.set(name, state);
          request.result = createConnection(state);
          if (typeof request.onupgradeneeded === 'function') {
            request.onupgradeneeded({
              target: request,
              oldVersion: 0,
              newVersion: state.version
            });
          }
          request._emitSuccess(request.result);
          return;
        }

        const requestedVersion = typeof version === 'number' ? version : existing.version;
        if (requestedVersion < existing.version) {
          request._emitError(new Error('VersionError'));
          return;
        }

        const oldVersion = existing.version;
        if (requestedVersion > oldVersion) {
          existing.version = requestedVersion;
        }
        request.result = createConnection(existing);
        if (requestedVersion > oldVersion && typeof request.onupgradeneeded === 'function') {
          request.onupgradeneeded({
            target: request,
            oldVersion,
            newVersion: requestedVersion
          });
        }
        request._emitSuccess(request.result);
      } catch (error) {
        request._emitError(error);
      }
    }, 0);

    return request;
  },

  deleteDatabase(name) {
    const request = new SimpleIDBRequest();
    setTimeout(() => {
      DATABASES.delete(name);
      request._emitSuccess(undefined);
    }, 0);
    return request;
  }
};

function installIndexedDBShim(globalObject) {
  globalObject.indexedDB = indexedDBShim;
  globalObject.IDBKeyRange = SimpleIDBKeyRange;
}

module.exports = {
  installIndexedDBShim
};
