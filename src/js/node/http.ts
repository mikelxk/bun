// Hardcoded module "node:http"
const EventEmitter = require("node:events");
const { isTypedArray, isArrayBuffer } = require("node:util/types");
const { Duplex, Readable, Writable } = require("node:stream");
const { isPrimary } = require("internal/cluster/isPrimary");
const { kAutoDestroyed } = require("internal/shared");
const { urlToHttpOptions } = require("internal/url");
const { validateFunction, checkIsHttpToken } = require("internal/validators");

const {
  getHeader,
  setHeader,
  assignHeaders: assignHeadersFast,
  assignEventCallback,
  setRequestTimeout,
  setServerIdleTimeout,
  Response,
  Request,
  Headers,
  Blob,
  headersTuple,
} = $cpp("NodeHTTP.cpp", "createNodeHTTPInternalBinding") as {
  getHeader: (headers: Headers, name: string) => string | undefined;
  setHeader: (headers: Headers, name: string, value: string) => void;
  assignHeaders: (object: any, req: Request, headersTuple: any) => boolean;
  assignEventCallback: (req: Request, callback: (event: number) => void) => void;
  setRequestTimeout: (req: Request, timeout: number) => void;
  setServerIdleTimeout: (server: any, timeout: number) => void;
  Response: (typeof globalThis)["Response"];
  Request: (typeof globalThis)["Request"];
  Headers: (typeof globalThis)["Headers"];
  Blob: (typeof globalThis)["Blob"];
  headersTuple: any;
};

let cluster;
const sendHelper = $newZigFunction("node_cluster_binding.zig", "sendHelperChild", 3);
const getBunServerAllClosedPromise = $newZigFunction("node_http_binding.zig", "getBunServerAllClosedPromise", 1);

// TODO: make this more robust.
function isAbortError(err) {
  return err?.name === "AbortError";
}

const ObjectDefineProperty = Object.defineProperty;

const GlobalPromise = globalThis.Promise;
const headerCharRegex = /[^\t\x20-\x7e\x80-\xff]/;
/**
 * True if val contains an invalid field-vchar
 *  field-value    = *( field-content / obs-fold )
 *  field-content  = field-vchar [ 1*( SP / HTAB ) field-vchar ]
 *  field-vchar    = VCHAR / obs-text
 */
function checkInvalidHeaderChar(val: string) {
  return RegExpPrototypeExec.$call(headerCharRegex, val) !== null;
}

const validateHeaderName = (name, label) => {
  if (typeof name !== "string" || !name || !checkIsHttpToken(name)) {
    throw $ERR_INVALID_HTTP_TOKEN(`The arguments Header name is invalid. Received ${name}`);
  }
};

const validateHeaderValue = (name, value) => {
  if (value === undefined) {
    // throw new ERR_HTTP_INVALID_HEADER_VALUE(value, name);
    throw new Error("ERR_HTTP_INVALID_HEADER_VALUE");
  }
  if (checkInvalidHeaderChar(value)) {
    // throw new ERR_INVALID_CHAR("header content", name);
    throw new Error("ERR_INVALID_CHAR");
  }
};

function ERR_HTTP_SOCKET_ASSIGNED() {
  return new Error(`ServerResponse has an already assigned socket`);
}

// TODO: add primordial for URL
// Importing from node:url is unnecessary
const { URL, WebSocket, CloseEvent, MessageEvent } = globalThis;

const globalReportError = globalThis.reportError;
const setTimeout = globalThis.setTimeout;
const fetch = Bun.fetch;
const nop = () => {};

const kEmptyObject = Object.freeze(Object.create(null));
const kEndCalled = Symbol.for("kEndCalled");
const kAbortController = Symbol.for("kAbortController");
const kClearTimeout = Symbol("kClearTimeout");
const kRealListen = Symbol("kRealListen");

// Primordials
const StringPrototypeSlice = String.prototype.slice;
const StringPrototypeStartsWith = String.prototype.startsWith;
const StringPrototypeToUpperCase = String.prototype.toUpperCase;
const RegExpPrototypeExec = RegExp.prototype.exec;
const ObjectAssign = Object.assign;

const INVALID_PATH_REGEX = /[^\u0021-\u00ff]/;
const NODE_HTTP_WARNING =
  "WARN: Agent is mostly unused in Bun's implementation of http. If you see strange behavior, this is probably the cause.";

var kInternalRequest = Symbol("kInternalRequest");
const kInternalSocketData = Symbol.for("::bunternal::");
const serverSymbol = Symbol.for("::bunternal::");
const kfakeSocket = Symbol("kfakeSocket");

const kEmptyBuffer = Buffer.alloc(0);

function isValidTLSArray(obj) {
  if (typeof obj === "string" || isTypedArray(obj) || isArrayBuffer(obj) || $inheritsBlob(obj)) return true;
  if (Array.isArray(obj)) {
    for (var i = 0; i < obj.length; i++) {
      const item = obj[i];
      if (typeof item !== "string" && !isTypedArray(item) && !isArrayBuffer(item) && !$inheritsBlob(item)) return false;
    }
    return true;
  }
  return false;
}

function validateMsecs(numberlike: any, field: string) {
  if (typeof numberlike !== "number" || numberlike < 0) {
    throw $ERR_INVALID_ARG_TYPE(field, "number", numberlike);
  }

  return numberlike;
}

type FakeSocket = InstanceType<typeof FakeSocket>;
var FakeSocket = class Socket extends Duplex {
  [kInternalSocketData]!: [typeof Server, typeof OutgoingMessage, typeof Request];
  bytesRead = 0;
  bytesWritten = 0;
  connecting = false;
  timeout = 0;
  isServer = false;

  #address;
  address() {
    // Call server.requestIP() without doing any propety getter twice.
    var internalData;
    return (this.#address ??=
      (internalData = this[kInternalSocketData])?.[0]?.[serverSymbol].requestIP(internalData[2]) ?? {});
  }

  get bufferSize() {
    return this.writableLength;
  }

  connect(port, host, connectListener) {
    return this;
  }

  _destroy(err, callback) {
    const socketData = this[kInternalSocketData];
    if (!socketData) return; // sometimes 'this' is Socket not FakeSocket
    if (!socketData[1]["req"][kAutoDestroyed]) socketData[1].end();
  }

  _final(callback) {}

  get localAddress() {
    return "127.0.0.1";
  }

  get localFamily() {
    return "IPv4";
  }

  get localPort() {
    return 80;
  }

  get pending() {
    return this.connecting;
  }

  _read(size) {}

  get readyState() {
    if (this.connecting) return "opening";
    if (this.readable) {
      return this.writable ? "open" : "readOnly";
    } else {
      return this.writable ? "writeOnly" : "closed";
    }
  }

  ref() {
    return this;
  }

  get remoteAddress() {
    return this.address()?.address;
  }

  set remoteAddress(val) {
    // initialize the object so that other properties wouldn't be lost
    this.address().address = val;
  }

  get remotePort() {
    return this.address()?.port;
  }

  set remotePort(val) {
    // initialize the object so that other properties wouldn't be lost
    this.address().port = val;
  }

  get remoteFamily() {
    return this.address()?.family;
  }

  set remoteFamily(val) {
    // initialize the object so that other properties wouldn't be lost
    this.address().family = val;
  }

  resetAndDestroy() {}

  setKeepAlive(enable = false, initialDelay = 0) {}

  setNoDelay(noDelay = true) {
    return this;
  }

  setTimeout(timeout, callback) {
    const socketData = this[kInternalSocketData];
    if (!socketData) return; // sometimes 'this' is Socket not FakeSocket

    const [server, http_res, req] = socketData;
    http_res?.req?.setTimeout(timeout, callback);
    return this;
  }

  unref() {
    return this;
  }

  _write(chunk, encoding, callback) {}
};

function createServer(options, callback) {
  return new Server(options, callback);
}

function Agent(options = kEmptyObject) {
  if (!(this instanceof Agent)) return new Agent(options);

  EventEmitter.$apply(this, []);

  this.defaultPort = 80;
  this.protocol = "http:";

  this.options = options = { ...options, path: null };
  if (options.noDelay === undefined) options.noDelay = true;

  // Don't confuse net and make it think that we're connecting to a pipe
  this.requests = Object.create(null);
  this.sockets = Object.create(null);
  this.freeSockets = Object.create(null);

  this.keepAliveMsecs = options.keepAliveMsecs || 1000;
  this.keepAlive = options.keepAlive || false;
  this.maxSockets = options.maxSockets || Agent.defaultMaxSockets;
  this.maxFreeSockets = options.maxFreeSockets || 256;
  this.scheduling = options.scheduling || "lifo";
  this.maxTotalSockets = options.maxTotalSockets;
  this.totalSocketCount = 0;
  this.defaultPort = options.defaultPort || 80;
  this.protocol = options.protocol || "http:";
}
$toClass(Agent, "Agent", EventEmitter);

ObjectDefineProperty(Agent, "globalAgent", {
  get: function () {
    return globalAgent;
  },
});

ObjectDefineProperty(Agent, "defaultMaxSockets", {
  get: function () {
    return Infinity;
  },
});

Agent.prototype.createConnection = function () {
  $debug(`${NODE_HTTP_WARNING}\n`, "WARN: Agent.createConnection is a no-op, returns fake socket");
  return (this[kfakeSocket] ??= new FakeSocket());
};

Agent.prototype.getName = function (options = kEmptyObject) {
  let name = `http:${options.host || "localhost"}:`;
  if (options.port) name += options.port;
  name += ":";
  if (options.localAddress) name += options.localAddress;
  // Pacify parallel/test-http-agent-getname by only appending
  // the ':' when options.family is set.
  if (options.family === 4 || options.family === 6) name += `:${options.family}`;
  if (options.socketPath) name += `:${options.socketPath}`;
  return name;
};

Agent.prototype.addRequest = function () {
  $debug(`${NODE_HTTP_WARNING}\n`, "WARN: Agent.addRequest is a no-op");
};

Agent.prototype.createSocket = function (req, options, cb) {
  $debug(`${NODE_HTTP_WARNING}\n`, "WARN: Agent.createSocket returns fake socket");
  cb(null, (this[kfakeSocket] ??= new FakeSocket()));
};

Agent.prototype.removeSocket = function () {
  $debug(`${NODE_HTTP_WARNING}\n`, "WARN: Agent.removeSocket is a no-op");
};

Agent.prototype.keepSocketAlive = function () {
  $debug(`${NODE_HTTP_WARNING}\n`, "WARN: Agent.keepSocketAlive is a no-op");
  return true;
};

Agent.prototype.reuseSocket = function () {
  $debug(`${NODE_HTTP_WARNING}\n`, "WARN: Agent.reuseSocket is a no-op");
};

Agent.prototype.destroy = function () {
  $debug(`${NODE_HTTP_WARNING}\n`, "WARN: Agent.destroy is a no-op");
};

function emitListeningNextTick(self, hostname, port) {
  if ((self.listening = !!self[serverSymbol])) {
    // TODO: remove the arguments
    // Note does not pass any arguments.
    self.emit("listening", null, hostname, port);
  }
}

var tlsSymbol = Symbol("tls");
var isTlsSymbol = Symbol("is_tls");
var optionsSymbol = Symbol("options");

function Server(options, callback) {
  if (!(this instanceof Server)) return new Server(options, callback);
  EventEmitter.$call(this);

  this.listening = false;
  this._unref = false;
  this[kInternalSocketData] = undefined;

  if (typeof options === "function") {
    callback = options;
    options = {};
  } else if (options == null || typeof options === "object") {
    options = { ...options };
    this[tlsSymbol] = null;
    let key = options.key;
    if (key) {
      if (!isValidTLSArray(key)) {
        throw new TypeError(
          "key argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile",
        );
      }
      this[isTlsSymbol] = true;
    }
    let cert = options.cert;
    if (cert) {
      if (!isValidTLSArray(cert)) {
        throw new TypeError(
          "cert argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile",
        );
      }
      this[isTlsSymbol] = true;
    }

    let ca = options.ca;
    if (ca) {
      if (!isValidTLSArray(ca)) {
        throw new TypeError(
          "ca argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile",
        );
      }
      this[isTlsSymbol] = true;
    }
    let passphrase = options.passphrase;
    if (passphrase && typeof passphrase !== "string") {
      throw new TypeError("passphrase argument must be an string");
    }

    let serverName = options.servername;
    if (serverName && typeof serverName !== "string") {
      throw new TypeError("servername argument must be an string");
    }

    let secureOptions = options.secureOptions || 0;
    if (secureOptions && typeof secureOptions !== "number") {
      throw new TypeError("secureOptions argument must be an number");
    }

    if (this[isTlsSymbol]) {
      this[tlsSymbol] = {
        serverName,
        key,
        cert,
        ca,
        passphrase,
        secureOptions,
      };
    } else {
      this[tlsSymbol] = null;
    }
  } else {
    throw new Error("bun-http-polyfill: invalid arguments");
  }

  this[optionsSymbol] = options;

  if (callback) this.on("request", callback);
  return this;
}

function onRequestEvent(event) {
  const [server, http_res, req] = this.socket[kInternalSocketData];
  if (!http_res[finishedSymbol]) {
    switch (event) {
      case 0: // timeout
        this.emit("timeout");
        server.emit("timeout", req.socket);
        break;
      case 1: // abort
        this.complete = true;
        this.emit("close");
        http_res[finishedSymbol] = true;
        break;
    }
  }
}

Server.prototype = {
  ref() {
    this._unref = false;
    this[serverSymbol]?.ref?.();
    return this;
  },

  unref() {
    this._unref = true;
    this[serverSymbol]?.unref?.();
    return this;
  },

  closeAllConnections() {
    const server = this[serverSymbol];
    if (!server) {
      return;
    }
    this[serverSymbol] = undefined;
    server.stop(true);
  },

  closeIdleConnections() {
    // not actually implemented
  },

  close(optionalCallback?) {
    const server = this[serverSymbol];
    if (!server) {
      if (typeof optionalCallback === "function")
        process.nextTick(optionalCallback, new Error("Server is not running"));
      return;
    }
    this[serverSymbol] = undefined;
    if (typeof optionalCallback === "function") this.once("close", optionalCallback);
    server.stop();
  },

  [Symbol.asyncDispose]() {
    const { resolve, reject, promise } = Promise.withResolvers();
    this.close(function (err, ...args) {
      if (err) reject(err);
      else resolve(...args);
    });
    return promise;
  },

  address() {
    if (!this[serverSymbol]) return null;
    return this[serverSymbol].address;
  },

  listen() {
    const server = this;
    let port, host, onListen;
    let socketPath;
    let tls = this[tlsSymbol];

    // This logic must align with:
    // - https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/lib/net.js#L274-L307
    if (arguments.length > 0) {
      if (($isObject(arguments[0]) || $isCallable(arguments[0])) && arguments[0] !== null) {
        // (options[...][, cb])
        port = arguments[0].port;
        host = arguments[0].host;
        socketPath = arguments[0].path;

        const otherTLS = arguments[0].tls;
        if (otherTLS && $isObject(otherTLS)) {
          tls = otherTLS;
        }
      } else if (typeof arguments[0] === "string" && !(Number(arguments[0]) >= 0)) {
        // (path[...][, cb])
        socketPath = arguments[0];
      } else {
        // ([port][, host][...][, cb])
        port = arguments[0];
        if (arguments.length > 1 && typeof arguments[1] === "string") {
          host = arguments[1];
        }
      }
    }

    // Bun defaults to port 3000.
    // Node defaults to port 0.
    if (port === undefined && !socketPath) {
      port = 0;
    }

    if (typeof port === "string") {
      const portNumber = parseInt(port);
      if (!Number.isNaN(portNumber)) {
        port = portNumber;
      }
    }

    if ($isCallable(arguments[arguments.length - 1])) {
      onListen = arguments[arguments.length - 1];
    }

    try {
      // listenInCluster

      if (isPrimary) {
        server[kRealListen](tls, port, host, socketPath, false, onListen);
        return this;
      }

      if (cluster === undefined) cluster = require("node:cluster");

      // TODO: our net.Server and http.Server use different Bun APIs and our IPC doesnt support sending and receiving handles yet. use reusePort instead for now.

      // const serverQuery = {
      //   // address: address,
      //   port: port,
      //   addressType: 4,
      //   // fd: fd,
      //   // flags,
      //   // backlog,
      //   // ...options,
      // };
      // cluster._getServer(server, serverQuery, function listenOnPrimaryHandle(err, handle) {
      //   // err = checkBindError(err, port, handle);
      //   // if (err) {
      //   //   throw new ExceptionWithHostPort(err, "bind", address, port);
      //   // }
      //   if (err) {
      //     throw err;
      //   }
      //   server[kRealListen](port, host, socketPath, onListen);
      // });

      server.once("listening", () => {
        cluster.worker.state = "listening";
        const address = server.address();
        const message = {
          act: "listening",
          port: (address && address.port) || port,
          data: null,
          addressType: 4,
        };
        sendHelper(message, null);
      });

      server[kRealListen](tls, port, host, socketPath, true, onListen);
    } catch (err) {
      setTimeout(() => server.emit("error", err), 1);
    }

    return this;
  },

  [kRealListen](tls, port, host, socketPath, reusePort, onListen) {
    {
      const ResponseClass = this[optionsSymbol].ServerResponse || ServerResponse;
      const RequestClass = this[optionsSymbol].IncomingMessage || IncomingMessage;
      let isHTTPS = false;
      let server = this;

      if (tls) {
        this.serverName = tls.serverName || host || "localhost";
      }
      this[serverSymbol] = Bun.serve<any>({
        idleTimeout: 0, // nodejs dont have a idleTimeout by default
        tls,
        port,
        hostname: host,
        unix: socketPath,
        reusePort,
        // Bindings to be used for WS Server
        websocket: {
          open(ws) {
            ws.data.open(ws);
          },
          message(ws, message) {
            ws.data.message(ws, message);
          },
          close(ws, code, reason) {
            ws.data.close(ws, code, reason);
          },
          drain(ws) {
            ws.data.drain(ws);
          },
          ping(ws, data) {
            ws.data.ping(ws, data);
          },
          pong(ws, data) {
            ws.data.pong(ws, data);
          },
        },
        maxRequestBodySize: Number.MAX_SAFE_INTEGER,
        // Be very careful not to access (web) Request object
        // properties:
        // - request.url
        // - request.headers
        //
        // We want to avoid triggering the getter for these properties because
        // that will cause the data to be cloned twice, which costs memory & performance.
        fetch(req, _server) {
          var pendingResponse;
          var pendingError;
          var reject = err => {
            if (pendingError) return;
            pendingError = err;
            if (rejectFunction) rejectFunction(err);
          };

          var reply = function (resp) {
            if (pendingResponse) return;
            pendingResponse = resp;
            if (resolveFunction) resolveFunction(resp);
          };

          const prevIsNextIncomingMessageHTTPS = isNextIncomingMessageHTTPS;
          isNextIncomingMessageHTTPS = isHTTPS;
          const http_req = new RequestClass(req);
          assignEventCallback(req, onRequestEvent.bind(http_req));
          isNextIncomingMessageHTTPS = prevIsNextIncomingMessageHTTPS;

          const upgrade = http_req.headers.upgrade;

          const http_res = new ResponseClass(http_req, reply);

          http_req.socket[kInternalSocketData] = [server, http_res, req];
          server.emit("connection", http_req.socket);

          const rejectFn = err => reject(err);
          http_req.once("error", rejectFn);
          http_res.once("error", rejectFn);

          if (upgrade) {
            server.emit("upgrade", http_req, http_req.socket, kEmptyBuffer);
          } else {
            server.emit("request", http_req, http_res);
          }

          if (pendingError) {
            throw pendingError;
          }

          if (pendingResponse) {
            return pendingResponse;
          }

          var { promise, resolve: resolveFunction, reject: rejectFunction } = $newPromiseCapability(GlobalPromise);
          return promise;
        },
      });
      getBunServerAllClosedPromise(this[serverSymbol]).$then(emitCloseNTServer.bind(this));
      isHTTPS = this[serverSymbol].protocol === "https";

      if (this?._unref) {
        this[serverSymbol]?.unref?.();
      }

      if ($isCallable(onListen)) {
        this.once("listening", onListen);
      }

      setTimeout(emitListeningNextTick, 1, this, this[serverSymbol].hostname, this[serverSymbol].port);
    }
  },

  setTimeout(msecs, callback) {
    const server = this[serverSymbol];
    if (server) {
      setServerIdleTimeout(server, Math.ceil(msecs / 1000));
      typeof callback === "function" && this.once("timeout", callback);
    }
    return this;
  },

  constructor: Server,
};
$setPrototypeDirect.$call(Server.prototype, EventEmitter.prototype);
$setPrototypeDirect.$call(Server, EventEmitter);

function assignHeadersSlow(object, req) {
  const headers = req.headers;
  var outHeaders = Object.create(null);
  const rawHeaders: string[] = [];
  var i = 0;
  for (let key in headers) {
    var originalKey = key;
    var value = headers[originalKey];

    key = key.toLowerCase();

    if (key !== "set-cookie") {
      value = String(value);
      $putByValDirect(rawHeaders, i++, originalKey);
      $putByValDirect(rawHeaders, i++, value);
      outHeaders[key] = value;
    } else {
      if ($isJSArray(value)) {
        outHeaders[key] = value.slice();

        for (let entry of value) {
          $putByValDirect(rawHeaders, i++, originalKey);
          $putByValDirect(rawHeaders, i++, entry);
        }
      } else {
        value = String(value);
        outHeaders[key] = [value];
        $putByValDirect(rawHeaders, i++, originalKey);
        $putByValDirect(rawHeaders, i++, value);
      }
    }
  }
  object.headers = outHeaders;
  object.rawHeaders = rawHeaders;
}

function assignHeaders(object, req) {
  // This fast path is an 8% speedup for a "hello world" node:http server, and a 7% speedup for a "hello world" express server
  if (assignHeadersFast(req, object, headersTuple)) {
    const headers = $getInternalField(headersTuple, 0);
    const rawHeaders = $getInternalField(headersTuple, 1);
    $putInternalField(headersTuple, 0, undefined);
    $putInternalField(headersTuple, 1, undefined);
    object.headers = headers;
    object.rawHeaders = rawHeaders;
    return true;
  } else {
    assignHeadersSlow(object, req);
    return false;
  }
}

var defaultIncomingOpts = { type: "request" };

function requestHasNoBody(method, req) {
  if ("GET" === method || "HEAD" === method || "TRACE" === method || "CONNECT" === method || "OPTIONS" === method)
    return true;
  const headers = req?.headers;
  const encoding = headers?.["transfer-encoding"];
  if (encoding?.indexOf?.("chunked") !== -1) return false;

  const contentLength = headers?.["content-length"];
  if (!parseInt(contentLength, 10)) return true;

  return false;
}

// This lets us skip some URL parsing
var isNextIncomingMessageHTTPS = false;

var typeSymbol = Symbol("type");
var reqSymbol = Symbol("req");
var bodyStreamSymbol = Symbol("bodyStream");
var noBodySymbol = Symbol("noBody");
var abortedSymbol = Symbol("aborted");
function IncomingMessage(req, defaultIncomingOpts) {
  this.method = null;
  this._consuming = false;
  this._dumped = false;
  this[noBodySymbol] = false;
  this[abortedSymbol] = false;
  this.complete = false;
  Readable.$call(this);
  var { type = "request", [kInternalRequest]: nodeReq } = defaultIncomingOpts || {};

  this[reqSymbol] = req;
  this[typeSymbol] = type;

  this[bodyStreamSymbol] = undefined;

  this.req = nodeReq;

  if (!assignHeaders(this, req)) {
    this[fakeSocketSymbol] = req;
    const reqUrl = String(req?.url || "");
    this.url = reqUrl;
  }

  if (isNextIncomingMessageHTTPS) {
    // Creating a new Duplex is expensive.
    // We can skip it if the request is not HTTPS.
    const socket = new FakeSocket();
    this[fakeSocketSymbol] = socket;
    socket.encrypted = true;
    isNextIncomingMessageHTTPS = false;
  }

  this[noBodySymbol] =
    type === "request" // TODO: Add logic for checking for body on response
      ? requestHasNoBody(this.method, this)
      : false;
}

IncomingMessage.prototype = {
  constructor: IncomingMessage,
  _construct(callback) {
    // TODO: streaming
    if (this[typeSymbol] === "response" || this[noBodySymbol]) {
      callback();
      return;
    }

    const encoding = this.headers["transfer-encoding"];
    if (encoding?.indexOf?.("chunked") === -1) {
      const contentLength = this.headers["content-length"];
      const length = contentLength ? parseInt(contentLength, 10) : 0;
      if (length === 0) {
        this[noBodySymbol] = true;
        callback();
        return;
      }
    }

    callback();
  },
  _read(size) {
    if (this[noBodySymbol]) {
      this.complete = true;
      this.push(null);
    } else if (this[bodyStreamSymbol] == null) {
      const reader = this[reqSymbol].body?.getReader() as ReadableStreamDefaultReader;
      if (!reader) {
        this.complete = true;
        this.push(null);
        return;
      }
      this[bodyStreamSymbol] = reader;
      consumeStream(this, reader);
    }
  },
  _destroy(err, cb) {
    if (!this.readableEnded || !this.complete) {
      this[abortedSymbol] = true;
      // IncomingMessage emits 'aborted'.
      // Client emits 'abort'.
      this.emit("aborted");
    }

    // Suppress "AbortError" from fetch() because we emit this in the 'aborted' event
    if (isAbortError(err)) {
      err = undefined;
    }

    const stream = this[bodyStreamSymbol];
    this[bodyStreamSymbol] = undefined;
    const streamState = stream?.$state;

    if (streamState === $streamReadable || streamState === $streamWaiting || streamState === $streamWritable) {
      stream?.cancel?.().catch(nop);
    }

    const socket = this[fakeSocketSymbol];
    if (socket) {
      socket.destroy(err);
    }

    if (cb) {
      emitErrorNextTick(this, err, cb);
    }
  },
  get aborted() {
    return this[abortedSymbol];
  },
  set aborted(value) {
    this[abortedSymbol] = value;
  },
  get connection() {
    return (this[fakeSocketSymbol] ??= new FakeSocket());
  },
  get statusCode() {
    return this[reqSymbol].status;
  },
  set statusCode(value) {
    if (!(value in STATUS_CODES)) return;
    this[reqSymbol].status = value;
  },
  get statusMessage() {
    return STATUS_CODES[this[reqSymbol].status];
  },
  set statusMessage(value) {
    // noop
  },
  get httpVersion() {
    return "1.1";
  },
  set httpVersion(value) {
    // noop
  },
  get httpVersionMajor() {
    return 1;
  },
  set httpVersionMajor(value) {
    // noop
  },
  get httpVersionMinor() {
    return 1;
  },
  set httpVersionMinor(value) {
    // noop
  },
  get rawTrailers() {
    return [];
  },
  set rawTrailers(value) {
    // noop
  },
  get trailers() {
    return kEmptyObject;
  },
  set trailers(value) {
    // noop
  },
  setTimeout(msecs, callback) {
    const req = this[reqSymbol];
    if (req) {
      setRequestTimeout(req, Math.ceil(msecs / 1000));
      typeof callback === "function" && this.once("timeout", callback);
    }
    return this;
  },
  get socket() {
    return (this[fakeSocketSymbol] ??= new FakeSocket());
  },
  set socket(value) {
    this[fakeSocketSymbol] = value;
  },
};
$setPrototypeDirect.$call(IncomingMessage.prototype, Readable.prototype);
$setPrototypeDirect.$call(IncomingMessage, Readable);

async function consumeStream(self, reader: ReadableStreamDefaultReader) {
  var done = false,
    value,
    aborted = false;
  try {
    while (true) {
      const result = reader.readMany();
      if ($isPromise(result)) {
        ({ done, value } = await result);
      } else {
        ({ done, value } = result);
      }
      if (self.destroyed || (aborted = self[abortedSymbol])) {
        break;
      }
      for (var v of value) {
        self.push(v);
      }

      if (self.destroyed || (aborted = self[abortedSymbol]) || done) {
        break;
      }
    }
  } catch (err) {
    if (aborted || self.destroyed) return;
    self.destroy(err);
  } finally {
    reader?.cancel?.().catch?.(nop);
  }

  if (!self.complete) {
    self.complete = true;
    self.push(null);
  }
}

const headersSymbol = Symbol("headers");
const finishedSymbol = Symbol("finished");
const timeoutTimerSymbol = Symbol("timeoutTimer");
const fakeSocketSymbol = Symbol("fakeSocket");
function OutgoingMessage(options) {
  Writable.$call(this, options);
  this.headersSent = false;
  this.sendDate = true;
  this[finishedSymbol] = false;
  this[kEndCalled] = false;
  this[kAbortController] = null;
}

$setPrototypeDirect.$call((OutgoingMessage.prototype = {}), Writable.prototype);
OutgoingMessage.prototype.constructor = OutgoingMessage; // Re-add constructor which got lost when setting prototype
$setPrototypeDirect.$call(OutgoingMessage, Writable);

// Express "compress" package uses this
OutgoingMessage.prototype._implicitHeader = function () {};

OutgoingMessage.prototype.appendHeader = function (name, value) {
  var headers = (this[headersSymbol] ??= new Headers());
  if (typeof value === "number") {
    value = String(value);
  }
  headers.append(name, value);
};

OutgoingMessage.prototype.flushHeaders = function () {};

OutgoingMessage.prototype.getHeader = function (name) {
  return getHeader(this[headersSymbol], name);
};

OutgoingMessage.prototype.getHeaders = function () {
  if (!this[headersSymbol]) return kEmptyObject;
  return this[headersSymbol].toJSON();
};

OutgoingMessage.prototype.getHeaderNames = function () {
  var headers = this[headersSymbol];
  if (!headers) return [];
  return Array.from(headers.keys());
};

OutgoingMessage.prototype.removeHeader = function (name) {
  if (!this[headersSymbol]) return;
  this[headersSymbol].delete(name);
};

OutgoingMessage.prototype.setHeader = function (name, value) {
  this[headersSymbol] = this[headersSymbol] ?? new Headers();
  var headers = this[headersSymbol];
  if (typeof value === "number") {
    value = String(value);
  }
  headers.set(name, value);
  return this;
};

OutgoingMessage.prototype.hasHeader = function (name) {
  if (!this[headersSymbol]) return false;
  return this[headersSymbol].has(name);
};

OutgoingMessage.prototype.addTrailers = function (headers) {
  throw new Error("not implemented");
};

function onTimeout() {
  this[timeoutTimerSymbol] = undefined;
  this[kAbortController]?.abort();
  this.emit("timeout");
}

OutgoingMessage.prototype.setTimeout = function (msecs, callback) {
  if (this.destroyed) return this;

  this.timeout = msecs = validateMsecs(msecs, "msecs");

  // Attempt to clear an existing timer in both cases -
  //  even if it will be rescheduled we don't want to leak an existing timer.
  clearTimeout(this[timeoutTimerSymbol]);

  if (msecs === 0) {
    if (callback !== undefined) {
      validateFunction(callback, "callback");
      this.removeListener("timeout", callback);
    }

    this[timeoutTimerSymbol] = undefined;
  } else {
    this[timeoutTimerSymbol] = setTimeout(onTimeout.bind(this), msecs).unref();

    if (callback !== undefined) {
      validateFunction(callback, "callback");
      this.once("timeout", callback);
    }
  }

  return this;
};

Object.defineProperty(OutgoingMessage.prototype, "headers", {
  // For compat with IncomingRequest
  get: function () {
    if (!this[headersSymbol]) return kEmptyObject;
    return this[headersSymbol].toJSON();
  },
});

Object.defineProperty(OutgoingMessage.prototype, "chunkedEncoding", {
  get: function () {
    return false;
  },

  set: function (value) {
    // throw new Error('not implemented');
  },
});

Object.defineProperty(OutgoingMessage.prototype, "shouldKeepAlive", {
  get: function () {
    return true;
  },

  set: function (value) {
    // throw new Error('not implemented');
  },
});

Object.defineProperty(OutgoingMessage.prototype, "useChunkedEncodingByDefault", {
  get: function () {
    return true;
  },

  set: function (value) {
    // throw new Error('not implemented');
  },
});

Object.defineProperty(OutgoingMessage.prototype, "socket", {
  get: function () {
    this[fakeSocketSymbol] = this[fakeSocketSymbol] ?? new FakeSocket();
    return this[fakeSocketSymbol];
  },

  set: function (val) {
    this[fakeSocketSymbol] = val;
  },
});

Object.defineProperty(OutgoingMessage.prototype, "connection", {
  get: function () {
    return this.socket;
  },
});

Object.defineProperty(OutgoingMessage.prototype, "finished", {
  get: function () {
    return this[finishedSymbol];
  },
});

function emitContinueAndSocketNT(self) {
  if (self.destroyed) return;
  // Ref: https://github.com/nodejs/node/blob/f63e8b7fa7a4b5e041ddec67307609ec8837154f/lib/_http_client.js#L803-L839
  self.emit("socket", self.socket);

  //Emit continue event for the client (internally we auto handle it)
  if (!self._closed && self.getHeader("expect") === "100-continue") {
    self.emit("continue");
  }
}
function emitCloseNT(self) {
  if (!self._closed) {
    self._closed = true;
    self.emit("close");
  }
}

function emitRequestCloseNT(self) {
  self.emit("close");
}

function onServerResponseClose() {
  // EventEmitter.emit makes a copy of the 'close' listeners array before
  // calling the listeners. detachSocket() unregisters onServerResponseClose
  // but if detachSocket() is called, directly or indirectly, by a 'close'
  // listener, onServerResponseClose is still in that copy of the listeners
  // array. That is, in the example below, b still gets called even though
  // it's been removed by a:
  //
  //   const EventEmitter = require('events');
  //   const obj = new EventEmitter();
  //   obj.on('event', a);
  //   obj.on('event', b);
  //   function a() { obj.removeListener('event', b) }
  //   function b() { throw "BAM!" }
  //   obj.emit('event');  // throws
  //
  // Ergo, we need to deal with stale 'close' events and handle the case
  // where the ServerResponse object has already been deconstructed.
  // Fortunately, that requires only a single if check. :-)
  if (this._httpMessage) {
    emitCloseNT(this._httpMessage);
  }
}

let OriginalWriteHeadFn, OriginalImplicitHeadFn;
const controllerSymbol = Symbol("controller");
const firstWriteSymbol = Symbol("firstWrite");
const deferredSymbol = Symbol("deferred");
function ServerResponse(req, reply) {
  OutgoingMessage.$call(this, reply);
  this.req = req;
  this._reply = reply;
  this.sendDate = true;
  this.statusCode = 200;
  this.headersSent = false;
  this.statusMessage = undefined;
  this[controllerSymbol] = undefined;
  this[firstWriteSymbol] = undefined;
  this._writableState.decodeStrings = false;
  this[deferredSymbol] = undefined;

  this._sent100 = false;
  this._defaultKeepAlive = false;
  this._removedConnection = false;
  this._removedContLen = false;
  this._hasBody = true;
  this[finishedSymbol] = false;

  // this is matching node's behaviour
  // https://github.com/nodejs/node/blob/cf8c6994e0f764af02da4fa70bc5962142181bf3/lib/_http_server.js#L192
  if (req.method === "HEAD") this._hasBody = false;
}
$setPrototypeDirect.$call((ServerResponse.prototype = {}), OutgoingMessage.prototype);
ServerResponse.prototype.constructor = ServerResponse; // Re-add constructor which got lost when setting prototype
$setPrototypeDirect.$call(ServerResponse, OutgoingMessage);

// Express "compress" package uses this
ServerResponse.prototype._implicitHeader = function () {
  // @ts-ignore
  this.writeHead(this.statusCode);
};

ServerResponse.prototype._write = function (chunk, encoding, callback) {
  if (this[firstWriteSymbol] === undefined && !this.headersSent) {
    this[firstWriteSymbol] = chunk;
    callback();
    return;
  }

  ensureReadableStreamController.$call(this, controller => {
    controller.write(chunk);
    callback();
  });
};

ServerResponse.prototype._writev = function (chunks, callback) {
  if (chunks.length === 1 && !this.headersSent && this[firstWriteSymbol] === undefined) {
    this[firstWriteSymbol] = chunks[0].chunk;
    callback();
    return;
  }

  ensureReadableStreamController.$call(this, controller => {
    for (const chunk of chunks) {
      controller.write(chunk.chunk);
    }

    callback();
  });
};

function ensureReadableStreamController(run) {
  const thisController = this[controllerSymbol];
  if (thisController) return run(thisController);
  this.headersSent = true;
  let firstWrite = this[firstWriteSymbol];
  this[controllerSymbol] = undefined;
  this._reply(
    new Response(
      new ReadableStream({
        type: "direct",
        pull: controller => {
          this[controllerSymbol] = controller;
          if (firstWrite) controller.write(firstWrite);
          firstWrite = undefined;
          run(controller);
          if (!this[finishedSymbol]) {
            const { promise, resolve } = $newPromiseCapability(GlobalPromise);
            this[deferredSymbol] = resolve;
            return promise;
          }
        },
      }),
      {
        headers: this[headersSymbol],
        status: this.statusCode,
        statusText: this.statusMessage ?? STATUS_CODES[this.statusCode],
      },
    ),
  );
}

function drainHeadersIfObservable() {
  if (this._implicitHeader === OriginalImplicitHeadFn && this.writeHead === OriginalWriteHeadFn) {
    return;
  }

  this._implicitHeader();
}

ServerResponse.prototype._final = function (callback) {
  const req = this.req;
  const shouldEmitClose = req && req.emit && !this[finishedSymbol];

  if (!this.headersSent) {
    var data = this[firstWriteSymbol] || "";
    this[firstWriteSymbol] = undefined;
    this[finishedSymbol] = true;
    this.headersSent = true; // https://github.com/oven-sh/bun/issues/3458
    drainHeadersIfObservable.$call(this);
    this._reply(
      new Response(data, {
        headers: this[headersSymbol],
        status: this.statusCode,
        statusText: this.statusMessage ?? STATUS_CODES[this.statusCode],
      }),
    );
    if (shouldEmitClose) {
      req.complete = true;
      process.nextTick(emitRequestCloseNT, req);
    }
    callback && callback();
    return;
  }

  this[finishedSymbol] = true;
  ensureReadableStreamController.$call(this, controller => {
    controller.end();
    if (shouldEmitClose) {
      req.complete = true;
      process.nextTick(emitRequestCloseNT, req);
    }
    callback();
    const deferred = this[deferredSymbol];
    if (deferred) {
      this[deferredSymbol] = undefined;
      deferred();
    }
  });
};

ServerResponse.prototype.writeProcessing = function () {
  throw new Error("not implemented");
};

ServerResponse.prototype.addTrailers = function (headers) {
  throw new Error("not implemented");
};

ServerResponse.prototype.assignSocket = function (socket) {
  if (socket._httpMessage) {
    throw ERR_HTTP_SOCKET_ASSIGNED();
  }
  socket._httpMessage = this;
  socket.on("close", () => onServerResponseClose.$call(socket));
  this.socket = socket;
  this._writableState.autoDestroy = false;
  this.emit("socket", socket);
};

ServerResponse.prototype.detachSocket = function (socket) {
  throw new Error("not implemented");
};

ServerResponse.prototype.writeContinue = function (callback) {
  throw new Error("not implemented");
};

ServerResponse.prototype.setTimeout = function (msecs, callback) {
  // TODO:
  return this;
};

ServerResponse.prototype.appendHeader = function (name, value) {
  this[headersSymbol] = this[headersSymbol] ?? new Headers();
  const headers = this[headersSymbol];
  if (typeof value === "number") {
    value = String(value);
  }
  headers.append(name, value);
};

ServerResponse.prototype.flushHeaders = function () {};

ServerResponse.prototype.getHeader = function (name) {
  return getHeader(this[headersSymbol], name);
};

ServerResponse.prototype.getHeaders = function () {
  const headers = this[headersSymbol];
  if (!headers) return kEmptyObject;
  return headers.toJSON();
};

ServerResponse.prototype.getHeaderNames = function () {
  const headers = this[headersSymbol];
  if (!headers) return [];
  return Array.from(headers.keys());
};

ServerResponse.prototype.removeHeader = function (name) {
  if (!this[headersSymbol]) return;
  this[headersSymbol].delete(name);
};

ServerResponse.prototype.setHeader = function (name, value) {
  this[headersSymbol] = this[headersSymbol] ?? new Headers();
  const headers = this[headersSymbol];
  if (typeof value === "number") {
    value = String(value);
  }
  setHeader(headers, name, value);
  return this;
};

ServerResponse.prototype.hasHeader = function (name) {
  if (!this[headersSymbol]) return false;
  return this[headersSymbol].has(name);
};

ServerResponse.prototype.writeHead = function (statusCode, statusMessage, headers) {
  _writeHead(statusCode, statusMessage, headers, this);

  return this;
};

Object.defineProperty(ServerResponse.prototype, "shouldKeepAlive", {
  get() {
    return true;
  },
  set(value) {
    // throw new Error('not implemented');
  },
});

Object.defineProperty(ServerResponse.prototype, "chunkedEncoding", {
  get() {
    return false;
  },
  set(value) {
    // throw new Error('not implemented');
  },
});

Object.defineProperty(ServerResponse.prototype, "useChunkedEncodingByDefault", {
  get() {
    return true;
  },
  set(value) {
    // throw new Error('not implemented');
  },
});

OriginalWriteHeadFn = ServerResponse.prototype.writeHead;
OriginalImplicitHeadFn = ServerResponse.prototype._implicitHeader;

class ClientRequest extends OutgoingMessage {
  #timeout;
  #res: IncomingMessage | null = null;
  #upgradeOrConnect = false;
  #parser = null;
  #maxHeadersCount = null;
  #reusedSocket = false;
  #host;
  #protocol;
  #method;
  #port;
  #tls = null;
  #useDefaultPort;
  #joinDuplicateHeaders;
  #maxHeaderSize;
  #agent = globalAgent;
  #path;
  #socketPath;

  #bodyChunks: Buffer[] | null = null;
  #stream: ReadableStream | null = null;
  #controller: ReadableStream | null = null;

  #fetchRequest;
  #signal: AbortSignal | null = null;
  [kAbortController]: AbortController | null = null;
  #timeoutTimer?: Timer = undefined;
  #options;
  #finished;

  _httpMessage;

  get path() {
    return this.#path;
  }

  get port() {
    return this.#port;
  }

  get method() {
    return this.#method;
  }

  get host() {
    return this.#host;
  }

  get protocol() {
    return this.#protocol;
  }

  get agent() {
    return this.#agent;
  }

  set agent(value) {
    this.#agent = value;
  }

  #createStream() {
    if (!this.#stream) {
      var self = this;

      this.#stream = new ReadableStream({
        type: "direct",
        pull(controller) {
          self.#controller = controller;
          for (let chunk of self.#bodyChunks) {
            if (chunk === null) {
              controller.close();
            } else {
              controller.write(chunk);
            }
          }
          self.#bodyChunks = null;
        },
      });
      this.#startStream();
    }
  }

  _write(chunk, encoding, callback) {
    if (this.#controller) {
      if (typeof chunk === "string") {
        this.#controller.write(Buffer.from(chunk, encoding));
      } else {
        this.#controller.write(chunk);
      }
      process.nextTick(callback);
      return;
    }
    if (!this.#bodyChunks) {
      this.#bodyChunks = [chunk];
      process.nextTick(callback);
      return;
    }

    this.#bodyChunks.push(chunk);
    this.#createStream();
    process.nextTick(callback);
  }

  _writev(chunks, callback) {
    if (this.#controller) {
      const allBuffers = chunks.allBuffers;

      if (allBuffers) {
        for (let i = 0; i < chunks.length; i++) {
          this.#controller.write(chunks[i].chunk);
        }
      } else {
        for (let i = 0; i < chunks.length; i++) {
          this.#controller.write(Buffer.from(chunks[i].chunk, chunks[i].encoding));
        }
      }
      process.nextTick(callback);
      return;
    }
    const allBuffers = chunks.allBuffers;
    if (this.#bodyChunks) {
      if (allBuffers) {
        for (let i = 0; i < chunks.length; i++) {
          this.#bodyChunks.push(chunks[i].chunk);
        }
      } else {
        for (let i = 0; i < chunks.length; i++) {
          this.#bodyChunks.push(Buffer.from(chunks[i].chunk, chunks[i].encoding));
        }
      }
    } else {
      this.#bodyChunks = new Array(chunks.length);

      if (allBuffers) {
        for (let i = 0; i < chunks.length; i++) {
          this.#bodyChunks[i] = chunks[i].chunk;
        }
      } else {
        for (let i = 0; i < chunks.length; i++) {
          this.#bodyChunks[i] = Buffer.from(chunks[i].chunk, chunks[i].encoding);
        }
      }
    }
    if (this.#bodyChunks.length > 1) {
      this.#createStream();
    }
    process.nextTick(callback);
  }

  _destroy(err, callback) {
    this.destroyed = true;
    // If request is destroyed we abort the current response
    this[kAbortController]?.abort?.();
    this.socket.destroy();
    emitErrorNextTick(this, err, callback);
  }

  _ensureTls() {
    if (this.#tls === null) this.#tls = {};
    return this.#tls;
  }

  #startStream() {
    if (this.#fetchRequest) return;

    var method = this.#method,
      body =
        this.#stream || (this.#bodyChunks?.length === 1 ? this.#bodyChunks[0] : Buffer.concat(this.#bodyChunks || []));
    let url: string;
    let proxy: string | undefined;
    const protocol = this.#protocol;
    const path = this.#path;
    if (path.startsWith("http://") || path.startsWith("https://")) {
      url = path;
      proxy = `${protocol}//${this.#host}${this.#useDefaultPort ? "" : ":" + this.#port}`;
    } else {
      url = `${protocol}//${this.#host}${this.#useDefaultPort ? "" : ":" + this.#port}${path}`;
      // support agent proxy url/string for http/https
      try {
        // getters can throw
        const agentProxy = this.#agent?.proxy;
        // this should work for URL like objects and strings
        proxy = agentProxy?.href || agentProxy;
      } catch {}
    }

    let keepalive = true;
    const agentKeepalive = this.#agent?.keepalive;
    if (agentKeepalive !== undefined) {
      keepalive = agentKeepalive;
    }
    const tls = protocol === "https:" && this.#tls ? { ...this.#tls, serverName: this.#tls.servername } : undefined;
    try {
      const fetchOptions: any = {
        method,
        headers: this.getHeaders(),
        redirect: "manual",
        signal: this[kAbortController]?.signal,
        // Timeouts are handled via this.setTimeout.
        timeout: false,
        // Disable auto gzip/deflate
        decompress: false,
        keepalive,
      };

      if (body && method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
        fetchOptions.body = body;
      }

      if (tls) {
        fetchOptions.tls = tls;
      }

      if (!!$debug) {
        fetchOptions.verbose = true;
      }

      if (proxy) {
        fetchOptions.proxy = proxy;
      }

      const socketPath = this.#socketPath;

      if (socketPath) {
        fetchOptions.unix = socketPath;
      }

      this._writableState.autoDestroy = false;
      //@ts-ignore
      this.#fetchRequest = fetch(url, fetchOptions)
        .then(response => {
          if (this.aborted) {
            return;
          }

          const prevIsHTTPS = isNextIncomingMessageHTTPS;
          isNextIncomingMessageHTTPS = response.url.startsWith("https:");
          var res = (this.#res = new IncomingMessage(response, {
            type: "response",
            [kInternalRequest]: this,
          }));
          isNextIncomingMessageHTTPS = prevIsHTTPS;
          this.emit("response", res);
        })
        .catch(err => {
          // Node treats AbortError separately.
          // The "abort" listener on the abort controller should have called this
          if (isAbortError(err)) {
            return;
          }

          if (!!$debug) globalReportError(err);

          this.emit("error", err);
        })
        .finally(() => {
          this.#fetchRequest = null;
          this[kClearTimeout]();
          emitCloseNT(this);
        });
    } catch (err) {
      if (!!$debug) globalReportError(err);
      this.emit("error", err);
    }
  }

  _final(callback) {
    this.#finished = true;
    this[kAbortController] = new AbortController();
    this[kAbortController].signal.addEventListener(
      "abort",
      () => {
        this[kClearTimeout]?.();
        if (this.destroyed) return;
        this.emit("abort");
        this.destroy();
      },
      { once: true },
    );
    if (this.#signal?.aborted) {
      this[kAbortController].abort();
    }

    if (this.#controller) {
      this.#controller.close();
      callback();
      return;
    }
    if (this.#bodyChunks?.length > 1) {
      this.#bodyChunks?.push(null);
    }

    this.#startStream();

    callback();
  }

  get aborted() {
    return this[abortedSymbol] || this.#signal?.aborted || !!this[kAbortController]?.signal.aborted;
  }

  set aborted(value) {
    this[abortedSymbol] = value;
  }

  abort() {
    if (this.aborted) return;
    this[abortedSymbol] = true;
    process.nextTick(emitAbortNextTick, this);
    this[kAbortController]?.abort?.();
    this.destroy();
  }

  constructor(input, options, cb) {
    super();
    if (typeof input === "string") {
      const urlStr = input;
      try {
        var urlObject = new URL(urlStr);
      } catch (e) {
        throw new TypeError(`Invalid URL: ${urlStr}`);
      }
      input = urlToHttpOptions(urlObject);
    } else if (input && typeof input === "object" && input instanceof URL) {
      // url.URL instance
      input = urlToHttpOptions(input);
    } else {
      cb = options;
      options = input;
      input = null;
    }

    if (typeof options === "function") {
      cb = options;
      options = input || kEmptyObject;
    } else {
      options = ObjectAssign(input || {}, options);
    }

    let agent = options.agent;
    const defaultAgent = options._defaultAgent || Agent.globalAgent;
    if (agent === false) {
      agent = new defaultAgent.constructor();
    } else if (agent == null) {
      agent = defaultAgent;
    } else if (typeof agent.addRequest !== "function") {
      throw $ERR_INVALID_ARG_TYPE("options.agent", "Agent-like Object, undefined, or false", agent);
    }
    this.#agent = agent;

    const protocol = options.protocol || defaultAgent.protocol;
    let expectedProtocol = defaultAgent.protocol;
    if (this.agent.protocol) {
      expectedProtocol = this.agent.protocol;
    }
    if (protocol !== expectedProtocol) {
      throw $ERR_INVALID_PROTOCOL(protocol, expectedProtocol);
    }
    this.#protocol = protocol;

    if (options.path) {
      const path = String(options.path);
      if (RegExpPrototypeExec.$call(INVALID_PATH_REGEX, path) !== null) {
        $debug('Path contains unescaped characters: "%s"', path);
        throw new Error("Path contains unescaped characters");
        // throw new ERR_UNESCAPED_CHARACTERS("Request path");
      }
    }

    const defaultPort = options.defaultPort || this.#agent.defaultPort;
    this.#port = options.port || defaultPort || 80;
    this.#useDefaultPort = this.#port === defaultPort;
    const host =
      (this.#host =
      options.host =
        validateHost(options.hostname, "hostname") || validateHost(options.host, "host") || "localhost");

    // const setHost = options.setHost === undefined || Boolean(options.setHost);

    this.#socketPath = options.socketPath;

    const signal = options.signal;
    if (signal) {
      //We still want to control abort function and timeout so signal call our AbortController
      signal.addEventListener("abort", () => {
        this[kAbortController]?.abort();
      });
      this.#signal = signal;
    }
    let method = options.method;
    const methodIsString = typeof method === "string";
    if (method !== null && method !== undefined && !methodIsString) {
      throw $ERR_INVALID_ARG_TYPE("options.method", "string", method);
    }

    if (methodIsString && method) {
      if (!checkIsHttpToken(method)) {
        throw $ERR_INVALID_HTTP_TOKEN("Method");
      }
      method = this.#method = StringPrototypeToUpperCase.$call(method);
    } else {
      method = this.#method = "GET";
    }

    const _maxHeaderSize = options.maxHeaderSize;
    // TODO: Validators
    // if (maxHeaderSize !== undefined)
    //   validateInteger(maxHeaderSize, "maxHeaderSize", 0);
    this.#maxHeaderSize = _maxHeaderSize;

    // const insecureHTTPParser = options.insecureHTTPParser;
    // if (insecureHTTPParser !== undefined) {
    //   validateBoolean(insecureHTTPParser, 'options.insecureHTTPParser');
    // }

    // this.insecureHTTPParser = insecureHTTPParser;
    var _joinDuplicateHeaders = options.joinDuplicateHeaders;
    if (_joinDuplicateHeaders !== undefined) {
      // TODO: Validators
      // validateBoolean(
      //   options.joinDuplicateHeaders,
      //   "options.joinDuplicateHeaders",
      // );
    }

    this.#joinDuplicateHeaders = _joinDuplicateHeaders;
    if (options.pfx) {
      throw new Error("pfx is not supported");
    }

    if (options.rejectUnauthorized !== undefined) this._ensureTls().rejectUnauthorized = options.rejectUnauthorized;
    else {
      let agentRejectUnauthorized = agent?.options?.rejectUnauthorized;
      if (agentRejectUnauthorized !== undefined) this._ensureTls().rejectUnauthorized = agentRejectUnauthorized;
      else {
        // popular https-proxy-agent uses connectOpts
        agentRejectUnauthorized = agent?.connectOpts?.rejectUnauthorized;
        if (agentRejectUnauthorized !== undefined) this._ensureTls().rejectUnauthorized = agentRejectUnauthorized;
      }
    }
    if (options.ca) {
      if (!isValidTLSArray(options.ca))
        throw new TypeError(
          "ca argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile",
        );
      this._ensureTls().ca = options.ca;
    }
    if (options.cert) {
      if (!isValidTLSArray(options.cert))
        throw new TypeError(
          "cert argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile",
        );
      this._ensureTls().cert = options.cert;
    }
    if (options.key) {
      if (!isValidTLSArray(options.key))
        throw new TypeError(
          "key argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile",
        );
      this._ensureTls().key = options.key;
    }
    if (options.passphrase) {
      if (typeof options.passphrase !== "string") throw new TypeError("passphrase argument must be a string");
      this._ensureTls().passphrase = options.passphrase;
    }
    if (options.ciphers) {
      if (typeof options.ciphers !== "string") throw new TypeError("ciphers argument must be a string");
      this._ensureTls().ciphers = options.ciphers;
    }
    if (options.servername) {
      if (typeof options.servername !== "string") throw new TypeError("servername argument must be a string");
      this._ensureTls().servername = options.servername;
    }

    if (options.secureOptions) {
      if (typeof options.secureOptions !== "number") throw new TypeError("secureOptions argument must be a string");
      this._ensureTls().secureOptions = options.secureOptions;
    }
    this.#path = options.path || "/";
    if (cb) {
      this.once("response", cb);
    }

    $debug(`new ClientRequest: ${this.#method} ${this.#protocol}//${this.#host}:${this.#port}${this.#path}`);

    // if (
    //   method === "GET" ||
    //   method === "HEAD" ||
    //   method === "DELETE" ||
    //   method === "OPTIONS" ||
    //   method === "TRACE" ||
    //   method === "CONNECT"
    // ) {
    //   this.useChunkedEncodingByDefault = false;
    // } else {
    //   this.useChunkedEncodingByDefault = true;
    // }

    this.#finished = false;
    this.#res = null;
    this.#upgradeOrConnect = false;
    this.#parser = null;
    this.#maxHeadersCount = null;
    this.#reusedSocket = false;
    this.#host = host;
    this.#protocol = protocol;

    const timeout = options.timeout;
    if (timeout !== undefined && timeout !== 0) {
      this.setTimeout(timeout, undefined);
    }

    const { headers } = options;
    const headersArray = $isJSArray(headers);
    if (!headersArray) {
      if (headers) {
        for (let key in headers) {
          this.setHeader(key, headers[key]);
        }
      }

      // if (host && !this.getHeader("host") && setHost) {
      //   let hostHeader = host;

      //   // For the Host header, ensure that IPv6 addresses are enclosed
      //   // in square brackets, as defined by URI formatting
      //   // https://tools.ietf.org/html/rfc3986#section-3.2.2
      //   const posColon = StringPrototypeIndexOf.$call(hostHeader, ":");
      //   if (
      //     posColon !== -1 &&
      //     StringPrototypeIncludes(hostHeader, ":", posColon + 1) &&
      //     StringPrototypeCharCodeAt(hostHeader, 0) !== 91 /* '[' */
      //   ) {
      //     hostHeader = `[${hostHeader}]`;
      //   }

      //   if (port && +port !== defaultPort) {
      //     hostHeader += ":" + port;
      //   }
      //   this.setHeader("Host", hostHeader);
      // }

      var auth = options.auth;
      if (auth && !this.getHeader("Authorization")) {
        this.setHeader("Authorization", "Basic " + Buffer.from(auth).toString("base64"));
      }

      //   if (this.getHeader("expect")) {
      //     if (this._header) {
      //       throw new ERR_HTTP_HEADERS_SENT("render");
      //     }

      //     this._storeHeader(
      //       this.method + " " + this.path + " HTTP/1.1\r\n",
      //       this[kOutHeaders],
      //     );
      //   }
      // } else {
      //   this._storeHeader(
      //     this.method + " " + this.path + " HTTP/1.1\r\n",
      //     options.headers,
      //   );
    }

    // this[kUniqueHeaders] = parseUniqueHeadersOption(options.uniqueHeaders);

    const { signal: _signal, ...optsWithoutSignal } = options;
    this.#options = optsWithoutSignal;

    this._httpMessage = this;

    process.nextTick(emitContinueAndSocketNT, this);
  }

  setSocketKeepAlive(enable = true, initialDelay = 0) {
    $debug(`${NODE_HTTP_WARNING}\n`, "WARN: ClientRequest.setSocketKeepAlive is a no-op");
  }

  setNoDelay(noDelay = true) {
    $debug(`${NODE_HTTP_WARNING}\n`, "WARN: ClientRequest.setNoDelay is a no-op");
  }

  [kClearTimeout]() {
    if (this.#timeoutTimer) {
      clearTimeout(this.#timeoutTimer);
      this.#timeoutTimer = undefined;
      this.removeAllListeners("timeout");
    }
  }

  #onTimeout() {
    this.#timeoutTimer = undefined;
    this[kAbortController]?.abort();
    this.emit("timeout");
  }

  setTimeout(msecs, callback) {
    if (this.destroyed) return this;

    this.timeout = msecs = validateMsecs(msecs, "msecs");

    // Attempt to clear an existing timer in both cases -
    //  even if it will be rescheduled we don't want to leak an existing timer.
    clearTimeout(this.#timeoutTimer!);

    if (msecs === 0) {
      if (callback !== undefined) {
        validateFunction(callback, "callback");
        this.removeListener("timeout", callback);
      }

      this.#timeoutTimer = undefined;
    } else {
      this.#timeoutTimer = setTimeout(this.#onTimeout.bind(this), msecs).unref();

      if (callback !== undefined) {
        validateFunction(callback, "callback");
        this.once("timeout", callback);
      }
    }

    return this;
  }
}

function validateHost(host, name) {
  if (host !== null && host !== undefined && typeof host !== "string") {
    throw $ERR_INVALID_ARG_TYPE(`options.${name}`, ["string", "undefined", "null"], host);
  }
  return host;
}

// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

const METHODS = [
  "ACL",
  "BIND",
  "CHECKOUT",
  "CONNECT",
  "COPY",
  "DELETE",
  "GET",
  "HEAD",
  "LINK",
  "LOCK",
  "M-SEARCH",
  "MERGE",
  "MKACTIVITY",
  "MKCALENDAR",
  "MKCOL",
  "MOVE",
  "NOTIFY",
  "OPTIONS",
  "PATCH",
  "POST",
  "PROPFIND",
  "PROPPATCH",
  "PURGE",
  "PUT",
  "REBIND",
  "REPORT",
  "SEARCH",
  "SOURCE",
  "SUBSCRIBE",
  "TRACE",
  "UNBIND",
  "UNLINK",
  "UNLOCK",
  "UNSUBSCRIBE",
];

const STATUS_CODES = {
  100: "Continue",
  101: "Switching Protocols",
  102: "Processing",
  103: "Early Hints",
  200: "OK",
  201: "Created",
  202: "Accepted",
  203: "Non-Authoritative Information",
  204: "No Content",
  205: "Reset Content",
  206: "Partial Content",
  207: "Multi-Status",
  208: "Already Reported",
  226: "IM Used",
  300: "Multiple Choices",
  301: "Moved Permanently",
  302: "Found",
  303: "See Other",
  304: "Not Modified",
  305: "Use Proxy",
  307: "Temporary Redirect",
  308: "Permanent Redirect",
  400: "Bad Request",
  401: "Unauthorized",
  402: "Payment Required",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  406: "Not Acceptable",
  407: "Proxy Authentication Required",
  408: "Request Timeout",
  409: "Conflict",
  410: "Gone",
  411: "Length Required",
  412: "Precondition Failed",
  413: "Payload Too Large",
  414: "URI Too Long",
  415: "Unsupported Media Type",
  416: "Range Not Satisfiable",
  417: "Expectation Failed",
  418: "I'm a Teapot",
  421: "Misdirected Request",
  422: "Unprocessable Entity",
  423: "Locked",
  424: "Failed Dependency",
  425: "Too Early",
  426: "Upgrade Required",
  428: "Precondition Required",
  429: "Too Many Requests",
  431: "Request Header Fields Too Large",
  451: "Unavailable For Legal Reasons",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
  505: "HTTP Version Not Supported",
  506: "Variant Also Negotiates",
  507: "Insufficient Storage",
  508: "Loop Detected",
  509: "Bandwidth Limit Exceeded",
  510: "Not Extended",
  511: "Network Authentication Required",
};

function _normalizeArgs(args) {
  let arr;

  if (args.length === 0) {
    arr = [{}, null];
    // arr[normalizedArgsSymbol] = true;
    return arr;
  }

  const arg0 = args[0];
  let options: any = {};
  if (typeof arg0 === "object" && arg0 !== null) {
    // (options[...][, cb])
    options = arg0;
    // } else if (isPipeName(arg0)) {
    // (path[...][, cb])
    // options.path = arg0;
  } else {
    // ([port][, host][...][, cb])
    options.port = arg0;
    if (args.length > 1 && typeof args[1] === "string") {
      options.host = args[1];
    }
  }

  const cb = args[args.length - 1];
  if (typeof cb !== "function") arr = [options, null];
  else arr = [options, cb];

  // arr[normalizedArgsSymbol] = true;
  return arr;
}

function _writeHead(statusCode, reason, obj, response) {
  statusCode |= 0;
  if (statusCode < 100 || statusCode > 999) {
    throw new Error("status code must be between 100 and 999");
  }

  if (typeof reason === "string") {
    // writeHead(statusCode, reasonPhrase[, headers])
    response.statusMessage = reason;
  } else {
    // writeHead(statusCode[, headers])
    if (!response.statusMessage) response.statusMessage = STATUS_CODES[statusCode] || "unknown";
    obj ??= reason;
  }
  response.statusCode = statusCode;

  {
    // Slow-case: when progressive API and header fields are passed.
    let k;
    if (Array.isArray(obj)) {
      if (obj.length % 2 !== 0) {
        throw new Error("raw headers must have an even number of elements");
      }

      for (let n = 0; n < obj.length; n += 2) {
        k = obj[n + 0];
        if (k) response.setHeader(k, obj[n + 1]);
      }
    } else if (obj) {
      const keys = Object.keys(obj);
      // Retain for(;;) loop for performance reasons
      // Refs: https://github.com/nodejs/node/pull/30958
      for (let i = 0; i < keys.length; i++) {
        k = keys[i];
        if (k) response.setHeader(k, obj[k]);
      }
    }
  }

  if (statusCode === 204 || statusCode === 304 || (statusCode >= 100 && statusCode <= 199)) {
    // RFC 2616, 10.2.5:
    // The 204 response MUST NOT include a message-body, and thus is always
    // terminated by the first empty line after the header fields.
    // RFC 2616, 10.3.5:
    // The 304 response MUST NOT contain a message-body, and thus is always
    // terminated by the first empty line after the header fields.
    // RFC 2616, 10.1 Informational 1xx:
    // This class of status code indicates a provisional response,
    // consisting only of the Status-Line and optional headers, and is
    // terminated by an empty line.
    response._hasBody = false;
    const req = response.req;
    if (req) {
      req.complete = true;
    }
  }
}

/**
 * Makes an HTTP request.
 * @param {string | URL} url
 * @param {HTTPRequestOptions} [options]
 * @param {Function} [cb]
 * @returns {ClientRequest}
 */
function request(url, options, cb) {
  return new ClientRequest(url, options, cb);
}

function emitCloseServer(self: Server) {
  self.emit("close");
}
function emitCloseNTServer(this: Server) {
  process.nextTick(emitCloseServer, this);
}

/**
 * Makes a `GET` HTTP request.
 * @param {string | URL} url
 * @param {HTTPRequestOptions} [options]
 * @param {Function} [cb]
 * @returns {ClientRequest}
 */
function get(url, options, cb) {
  const req = request(url, options, cb);
  req.end();
  return req;
}

function onError(self, error, cb) {
  if (error) {
    cb(error);
  } else {
    cb();
  }
}

function emitErrorNextTick(self, err, cb) {
  process.nextTick(onError, self, err, cb);
}

function emitAbortNextTick(self) {
  self.emit("abort");
}

const setMaxHTTPHeaderSize = $newZigFunction("node_http_binding.zig", "setMaxHTTPHeaderSize", 1);
const getMaxHTTPHeaderSize = $newZigFunction("node_http_binding.zig", "getMaxHTTPHeaderSize", 0);

var globalAgent = new Agent();
export default {
  Agent,
  Server,
  METHODS,
  STATUS_CODES,
  createServer,
  ServerResponse,
  IncomingMessage,
  request,
  get,
  get maxHeaderSize() {
    return getMaxHTTPHeaderSize();
  },
  set maxHeaderSize(value) {
    setMaxHTTPHeaderSize(value);
  },
  validateHeaderName,
  validateHeaderValue,
  setMaxIdleHTTPParsers(max) {
    $debug(`${NODE_HTTP_WARNING}\n`, "setMaxIdleHTTPParsers() is a no-op");
  },
  globalAgent,
  ClientRequest,
  OutgoingMessage,
  WebSocket,
  CloseEvent,
  MessageEvent,
};
