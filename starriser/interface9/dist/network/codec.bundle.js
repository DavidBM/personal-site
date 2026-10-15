// node_modules/@bufbuild/protobuf/dist/esm/is-message.js
function isMessage(arg, schema) {
  const isMessage2 = arg !== null && typeof arg == "object" && "$typeName" in arg && typeof arg.$typeName == "string";
  if (!isMessage2) {
    return false;
  }
  if (schema === void 0) {
    return true;
  }
  return schema.typeName === arg.$typeName;
}

// node_modules/@bufbuild/protobuf/dist/esm/descriptors.js
var ScalarType;
(function(ScalarType2) {
  ScalarType2[ScalarType2["DOUBLE"] = 1] = "DOUBLE";
  ScalarType2[ScalarType2["FLOAT"] = 2] = "FLOAT";
  ScalarType2[ScalarType2["INT64"] = 3] = "INT64";
  ScalarType2[ScalarType2["UINT64"] = 4] = "UINT64";
  ScalarType2[ScalarType2["INT32"] = 5] = "INT32";
  ScalarType2[ScalarType2["FIXED64"] = 6] = "FIXED64";
  ScalarType2[ScalarType2["FIXED32"] = 7] = "FIXED32";
  ScalarType2[ScalarType2["BOOL"] = 8] = "BOOL";
  ScalarType2[ScalarType2["STRING"] = 9] = "STRING";
  ScalarType2[ScalarType2["BYTES"] = 12] = "BYTES";
  ScalarType2[ScalarType2["UINT32"] = 13] = "UINT32";
  ScalarType2[ScalarType2["SFIXED32"] = 15] = "SFIXED32";
  ScalarType2[ScalarType2["SFIXED64"] = 16] = "SFIXED64";
  ScalarType2[ScalarType2["SINT32"] = 17] = "SINT32";
  ScalarType2[ScalarType2["SINT64"] = 18] = "SINT64";
})(ScalarType || (ScalarType = {}));

// node_modules/@bufbuild/protobuf/dist/esm/wire/varint.js
function varint64read() {
  const buf = this.buf;
  let pos = this.pos;
  let lo = 0;
  let hi = 0;
  for (let shift = 0; shift < 28; shift += 7) {
    const b = buf[pos++];
    lo |= (b & 127) << shift;
    if ((b & 128) == 0) {
      this.pos = pos;
      this.assertBounds();
      this.varint64Lo = lo;
      this.varint64Hi = hi;
      return;
    }
  }
  const middleByte = buf[pos++];
  lo |= (middleByte & 15) << 28;
  hi = (middleByte & 112) >> 4;
  if ((middleByte & 128) == 0) {
    this.pos = pos;
    this.assertBounds();
    this.varint64Lo = lo;
    this.varint64Hi = hi;
    return;
  }
  for (let shift = 3; shift <= 31; shift += 7) {
    const b = buf[pos++];
    hi |= (b & 127) << shift;
    if ((b & 128) == 0) {
      this.pos = pos;
      this.assertBounds();
      this.varint64Lo = lo;
      this.varint64Hi = hi;
      return;
    }
  }
  throw new Error("invalid varint");
}
var TWO_PWR_32_DBL = 4294967296;
function int64FromString(dec) {
  const minus = dec[0] === "-";
  if (minus) {
    dec = dec.slice(1);
  }
  const base = 1e6;
  let lowBits = 0;
  let highBits = 0;
  function add1e6digit(begin, end) {
    const digit1e6 = Number(dec.slice(begin, end));
    highBits *= base;
    lowBits = lowBits * base + digit1e6;
    if (lowBits >= TWO_PWR_32_DBL) {
      highBits = highBits + (lowBits / TWO_PWR_32_DBL | 0);
      lowBits = lowBits % TWO_PWR_32_DBL;
    }
  }
  add1e6digit(-24, -18);
  add1e6digit(-18, -12);
  add1e6digit(-12, -6);
  add1e6digit(-6);
  return minus ? negate(lowBits, highBits) : newBits(lowBits, highBits);
}
function int64ToString(lo, hi) {
  let bits = newBits(lo, hi);
  const negative = bits.hi & 2147483648;
  if (negative) {
    bits = negate(bits.lo, bits.hi);
  }
  const result = uInt64ToString(bits.lo, bits.hi);
  return negative ? "-" + result : result;
}
function uInt64ToString(lo, hi) {
  ({ lo, hi } = toUnsigned(lo, hi));
  if (hi <= 2097151) {
    return String(TWO_PWR_32_DBL * hi + lo);
  }
  const low = lo & 16777215;
  const mid = (lo >>> 24 | hi << 8) & 16777215;
  const high = hi >> 16 & 65535;
  let digitA = low + mid * 6777216 + high * 6710656;
  let digitB = mid + high * 8147497;
  let digitC = high * 2;
  const base = 1e7;
  if (digitA >= base) {
    digitB += Math.floor(digitA / base);
    digitA %= base;
  }
  if (digitB >= base) {
    digitC += Math.floor(digitB / base);
    digitB %= base;
  }
  return digitC.toString() + decimalFrom1e7WithLeadingZeros(digitB) + decimalFrom1e7WithLeadingZeros(digitA);
}
function toUnsigned(lo, hi) {
  return { lo: lo >>> 0, hi: hi >>> 0 };
}
function newBits(lo, hi) {
  return { lo: lo | 0, hi: hi | 0 };
}
function negate(lowBits, highBits) {
  highBits = ~highBits;
  if (lowBits) {
    lowBits = ~lowBits + 1;
  } else {
    highBits += 1;
  }
  return newBits(lowBits, highBits);
}
var decimalFrom1e7WithLeadingZeros = (digit1e7) => {
  const partial = String(digit1e7);
  return "0000000".slice(partial.length) + partial;
};
function varint32write(value, bytes) {
  if (value >>> 0 < 128) {
    bytes.push(value);
    return;
  }
  if (value >= 0) {
    while (value > 127) {
      bytes.push(value & 127 | 128);
      value = value >>> 7;
    }
    bytes.push(value);
  } else {
    for (let i = 0; i < 9; i++) {
      bytes.push(value & 127 | 128);
      value = value >> 7;
    }
    bytes.push(1);
  }
}
function varint32read() {
  let b = this.buf[this.pos++];
  if ((b & 128) === 0) {
    this.assertBounds();
    return b;
  }
  let result = b & 127;
  b = this.buf[this.pos++];
  result |= (b & 127) << 7;
  if ((b & 128) === 0) {
    this.assertBounds();
    return result;
  }
  b = this.buf[this.pos++];
  result |= (b & 127) << 14;
  if ((b & 128) === 0) {
    this.assertBounds();
    return result;
  }
  b = this.buf[this.pos++];
  result |= (b & 127) << 21;
  if ((b & 128) === 0) {
    this.assertBounds();
    return result;
  }
  b = this.buf[this.pos++];
  result |= (b & 15) << 28;
  for (let readBytes = 5; (b & 128) !== 0 && readBytes < 10; readBytes++)
    b = this.buf[this.pos++];
  if ((b & 128) !== 0)
    throw new Error("invalid varint");
  this.assertBounds();
  return result >>> 0;
}

// node_modules/@bufbuild/protobuf/dist/esm/proto-int64.js
var protoInt64 = /* @__PURE__ */ makeInt64Support();
function makeInt64Support() {
  const dv = new DataView(new ArrayBuffer(8));
  const ok = typeof BigInt === "function" && typeof dv.getBigInt64 === "function" && typeof dv.getBigUint64 === "function" && typeof dv.setBigInt64 === "function" && typeof dv.setBigUint64 === "function" && (!!globalThis.Deno || !!globalThis.Bun || typeof process != "object" || typeof process.env != "object" || process.env.BUF_BIGINT_DISABLE !== "1");
  if (ok) {
    const MIN = BigInt("-9223372036854775808");
    const MAX = BigInt("9223372036854775807");
    const UMIN = BigInt("0");
    const UMAX = BigInt("18446744073709551615");
    return {
      zero: BigInt(0),
      supported: true,
      parse(value) {
        const bi = typeof value == "bigint" ? value : BigInt(value);
        if (bi > MAX || bi < MIN) {
          throw new Error(`invalid int64: ${value}`);
        }
        return bi;
      },
      uParse(value) {
        const bi = typeof value == "bigint" ? value : BigInt(value);
        if (bi > UMAX || bi < UMIN) {
          throw new Error(`invalid uint64: ${value}`);
        }
        return bi;
      },
      enc(value) {
        dv.setBigInt64(0, this.parse(value), true);
        return {
          lo: dv.getInt32(0, true),
          hi: dv.getInt32(4, true)
        };
      },
      uEnc(value) {
        dv.setBigInt64(0, this.uParse(value), true);
        return {
          lo: dv.getInt32(0, true),
          hi: dv.getInt32(4, true)
        };
      },
      dec(lo, hi) {
        dv.setInt32(0, lo, true);
        dv.setInt32(4, hi, true);
        return dv.getBigInt64(0, true);
      },
      uDec(lo, hi) {
        dv.setInt32(0, lo, true);
        dv.setInt32(4, hi, true);
        return dv.getBigUint64(0, true);
      }
    };
  }
  return {
    zero: "0",
    supported: false,
    parse(value) {
      if (typeof value != "string") {
        value = value.toString();
      }
      assertInt64String(value);
      return value;
    },
    uParse(value) {
      if (typeof value != "string") {
        value = value.toString();
      }
      assertUInt64String(value);
      return value;
    },
    enc(value) {
      if (typeof value != "string") {
        value = value.toString();
      }
      assertInt64String(value);
      return int64FromString(value);
    },
    uEnc(value) {
      if (typeof value != "string") {
        value = value.toString();
      }
      assertUInt64String(value);
      return int64FromString(value);
    },
    dec(lo, hi) {
      return int64ToString(lo, hi);
    },
    uDec(lo, hi) {
      return uInt64ToString(lo, hi);
    }
  };
}
function assertInt64String(value) {
  if (!/^-?[0-9]+$/.test(value)) {
    throw new Error("invalid int64: " + value);
  }
}
function assertUInt64String(value) {
  if (!/^[0-9]+$/.test(value)) {
    throw new Error("invalid uint64: " + value);
  }
}

// node_modules/@bufbuild/protobuf/dist/esm/reflect/scalar.js
function scalarZeroValue(type, longAsString) {
  switch (type) {
    case ScalarType.STRING:
      return "";
    case ScalarType.BOOL:
      return false;
    case ScalarType.DOUBLE:
    case ScalarType.FLOAT:
      return 0;
    case ScalarType.INT64:
    case ScalarType.UINT64:
    case ScalarType.SFIXED64:
    case ScalarType.FIXED64:
    case ScalarType.SINT64:
      return longAsString ? "0" : protoInt64.zero;
    case ScalarType.BYTES:
      return new Uint8Array(0);
    default:
      return 0;
  }
}

// node_modules/@bufbuild/protobuf/dist/esm/reflect/unsafe.js
function unsafeIsSetExplicit(target, localName) {
  return Object.prototype.hasOwnProperty.call(target, localName) && target[localName] !== void 0;
}

// node_modules/@bufbuild/protobuf/dist/esm/reflect/guard.js
function isObject(arg) {
  return arg !== null && typeof arg == "object" && !Array.isArray(arg);
}

// node_modules/@bufbuild/protobuf/dist/esm/wkt/wrappers.js
function isWrapperDesc(messageDesc2) {
  const f = messageDesc2.fields[0];
  return isWrapperTypeName(messageDesc2.typeName) && f !== void 0 && f.fieldKind == "scalar" && f.name == "value" && f.number == 1;
}
var wrapperTypeNames = /* @__PURE__ */ new Set([
  "google.protobuf.DoubleValue",
  "google.protobuf.FloatValue",
  "google.protobuf.Int64Value",
  "google.protobuf.UInt64Value",
  "google.protobuf.Int32Value",
  "google.protobuf.UInt32Value",
  "google.protobuf.BoolValue",
  "google.protobuf.StringValue",
  "google.protobuf.BytesValue"
]);
function isWrapperTypeName(name) {
  return wrapperTypeNames.has(name);
}

// node_modules/@bufbuild/protobuf/dist/esm/create.js
var EDITION_PROTO3 = 999;
var EDITION_PROTO2 = 998;
var IMPLICIT = 2;
function create(schema, init) {
  if (isMessage(init, schema)) {
    return init;
  }
  return compiledCreate(schema)(init);
}
var compiledCreates = /* @__PURE__ */ new WeakMap();
function compiledCreate(desc) {
  let compiled = compiledCreates.get(desc);
  if (compiled === void 0) {
    compiled = compileCreate(desc);
    compiledCreates.set(desc, compiled);
  }
  return compiled;
}
var INIT_SINGULAR = 0;
var INIT_LIST = 1;
var INIT_MAP = 2;
var INIT_ONEOF = 3;
function compileCreate(desc) {
  const typeName = desc.typeName;
  const { properties, prototype } = compileInitMessage(desc);
  return (init) => {
    let message;
    if (prototype !== void 0) {
      message = Object.create(prototype);
      message.$typeName = typeName;
    } else {
      message = { $typeName: typeName };
    }
    for (let i = 0; i < properties.length; i++) {
      const property = properties[i];
      const name = property.name;
      const initValue = init === null || init === void 0 ? void 0 : init[name];
      switch (property.kind) {
        case INIT_SINGULAR:
          if (initValue != null) {
            message[name] = property.convert !== void 0 ? property.convert(initValue) : initValue;
          } else if (property.constant !== void 0) {
            message[name] = property.constant;
          }
          break;
        case INIT_LIST:
          message[name] = property.convert !== void 0 && Array.isArray(initValue) ? initValue.map(property.convert) : initValue !== null && initValue !== void 0 ? initValue : [];
          break;
        case INIT_MAP:
          if (property.convert === void 0 || !isObject(initValue)) {
            message[name] = initValue !== null && initValue !== void 0 ? initValue : {};
          } else {
            const converted = {};
            const keys = Object.keys(initValue);
            for (let k = 0; k < keys.length; k++) {
              converted[keys[k]] = property.convert(initValue[keys[k]]);
            }
            message[name] = converted;
          }
          break;
        case INIT_ONEOF: {
          const oneofValue = initValue;
          if ((oneofValue === null || oneofValue === void 0 ? void 0 : oneofValue.case) != null) {
            const convert = property.convert.get(oneofValue.case);
            if (convert !== void 0) {
              message[name] = {
                case: oneofValue.case,
                value: convert(oneofValue.value)
              };
              break;
            }
          }
          message[name] = { case: void 0 };
          break;
        }
      }
    }
    return message;
  };
}
function compileInitMessage(desc) {
  var _a, _b;
  const properties = [];
  const prototype = {};
  const usePrototype = needsPrototypeChain(desc);
  for (const member of desc.members) {
    const name = member.localName;
    if (member.kind == "oneof") {
      properties.push({
        name,
        kind: INIT_ONEOF,
        constant: void 0,
        convert: compileConvertOneof(member)
      });
      continue;
    }
    switch (member.fieldKind) {
      case "message": {
        properties.push({
          name,
          kind: INIT_SINGULAR,
          constant: void 0,
          convert: compileConvertMessage(member)
        });
        break;
      }
      case "list": {
        properties.push({
          name,
          kind: INIT_LIST,
          constant: void 0,
          convert: member.listKind == "message" ? (_a = compileConvertMessage(member)) !== null && _a !== void 0 ? _a : ((value) => value) : member.scalar == ScalarType.BYTES ? toU8Arr : void 0
        });
        break;
      }
      case "map": {
        properties.push({
          name,
          kind: INIT_MAP,
          constant: void 0,
          convert: member.mapKind == "message" ? (_b = compileConvertMessage(member)) !== null && _b !== void 0 ? _b : ((value) => value) : member.scalar == ScalarType.BYTES ? toU8Arr : void 0
        });
        break;
      }
      default: {
        const zeroValue = createZeroValue(member);
        properties.push({
          name,
          kind: INIT_SINGULAR,
          constant: member.presence == IMPLICIT ? zeroValue : void 0,
          convert: member.fieldKind == "scalar" && member.scalar == ScalarType.BYTES ? toU8Arr : void 0
        });
        if (usePrototype) {
          prototype[name] = zeroValue;
        }
        break;
      }
    }
  }
  return {
    properties,
    prototype: usePrototype ? prototype : void 0
  };
}
function compileConvertOneof(oneof) {
  const converters = /* @__PURE__ */ new Map();
  for (const field of oneof.fields) {
    let convert;
    if (field.fieldKind == "message") {
      convert = compileConvertMessage(field);
    } else if (field.fieldKind == "scalar" && field.scalar == ScalarType.BYTES) {
      convert = toU8Arr;
    }
    converters.set(field.localName, convert !== null && convert !== void 0 ? convert : ((value) => value));
  }
  return converters;
}
function compileConvertMessage(field) {
  if (field.fieldKind == "message" && !field.oneof && isWrapperDesc(field.message)) {
    return field.message.fields[0].scalar == ScalarType.BYTES ? toU8Arr : void 0;
  }
  if (field.message.typeName == "google.protobuf.Struct" && field.parent.typeName !== "google.protobuf.Value") {
    return void 0;
  }
  const messageDesc2 = field.message;
  let compiled;
  return (value) => {
    if (!isObject(value) || isMessage(value, messageDesc2)) {
      return value;
    }
    compiled !== null && compiled !== void 0 ? compiled : compiled = compiledCreate(messageDesc2);
    return compiled(value);
  };
}
function toU8Arr(value) {
  return Array.isArray(value) ? new Uint8Array(value) : value;
}
function needsPrototypeChain(desc) {
  switch (desc.file.edition) {
    case EDITION_PROTO3:
      return false;
    case EDITION_PROTO2:
      return true;
    default:
      return desc.fields.some((f) => f.presence != IMPLICIT && f.fieldKind != "message" && !f.oneof);
  }
}
function createZeroValue(field) {
  const defaultValue = field.getDefaultValue();
  if (defaultValue !== void 0) {
    return field.fieldKind == "scalar" && field.longAsString ? defaultValue.toString() : defaultValue;
  }
  return field.fieldKind == "scalar" ? scalarZeroValue(field.scalar, field.longAsString) : field.enum.values[0].number;
}

// node_modules/@bufbuild/protobuf/dist/esm/reflect/error.js
var FieldError = class extends Error {
  constructor(fieldOrOneof, message, name = "FieldValueInvalidError") {
    super(message);
    this.name = name;
    this.field = () => fieldOrOneof;
  }
};

// node_modules/@bufbuild/protobuf/dist/esm/wire/text-encoding.js
var te;
function configureTextEncoding(textEncoding) {
  var _a;
  te = Object.assign(Object.assign({}, textEncoding), { encodeUtf8Into: (_a = textEncoding.encodeUtf8Into) !== null && _a !== void 0 ? _a : emulateEncodeInto(textEncoding.encodeUtf8.bind(textEncoding)) });
}
function getTextEncoding() {
  if (!te) {
    const globals = globalThis;
    if (!globals.TextEncoder || !globals.TextDecoder) {
      throw new Error("encoding API missing: install TextEncoder and TextDecoder on globalThis");
    }
    const textEncoder = new globals.TextEncoder();
    const textDecoder = new globals.TextDecoder();
    let textDecoderStrict;
    const config = {
      encodeUtf8(text) {
        return textEncoder.encode(text);
      },
      decodeUtf8(bytes, strict) {
        if (strict) {
          if (!textDecoderStrict) {
            textDecoderStrict = new globals.TextDecoder("utf-8", {
              fatal: true
            });
          }
          return textDecoderStrict.decode(bytes);
        }
        return textDecoder.decode(bytes);
      },
      checkUtf8(text) {
        try {
          encodeURIComponent(text);
          return true;
        } catch (_) {
          return false;
        }
      }
    };
    if (textEncoder.encodeInto) {
      config.encodeUtf8Into = textEncoder.encodeInto.bind(textEncoder);
    }
    const nativeStringIsWellFormed = String.prototype.isWellFormed;
    if (nativeStringIsWellFormed) {
      config.checkUtf8 = (text) => {
        return nativeStringIsWellFormed.call(text);
      };
    }
    configureTextEncoding(config);
  }
  return te;
}
function emulateEncodeInto(encodeUtf8) {
  return (text, dest) => {
    const bytes = encodeUtf8(text);
    dest.set(bytes);
    return { written: bytes.byteLength };
  };
}

// node_modules/@bufbuild/protobuf/dist/esm/wire/binary-encoding.js
var WireType;
(function(WireType2) {
  WireType2[WireType2["Varint"] = 0] = "Varint";
  WireType2[WireType2["Bit64"] = 1] = "Bit64";
  WireType2[WireType2["LengthDelimited"] = 2] = "LengthDelimited";
  WireType2[WireType2["StartGroup"] = 3] = "StartGroup";
  WireType2[WireType2["EndGroup"] = 4] = "EndGroup";
  WireType2[WireType2["Bit32"] = 5] = "Bit32";
})(WireType || (WireType = {}));
var FLOAT32_MAX = 34028234663852886e22;
var FLOAT32_MIN = -34028234663852886e22;
var UINT32_MAX = 4294967295;
var INT32_MAX = 2147483647;
var INT32_MIN = -2147483648;
var BinaryWriter = class {
  constructor(encodeUtf8) {
    this.stackPos = [];
    this.encodeUtf8Into = encodeUtf8 ? emulateEncodeInto(encodeUtf8) : getTextEncoding().encodeUtf8Into;
    this.buffer = EMPTY_BUFFER;
    this.viewCache = EMPTY_VIEW;
    this.pos = 0;
  }
  ensureCapacity(size) {
    const required = this.pos + size;
    if (required > this.buffer.length) {
      let newLen = this.buffer.length || INITIAL_SIZE;
      while (newLen < required)
        newLen *= 2;
      const newBuf = new Uint8Array(newLen);
      if (this.pos > 0)
        newBuf.set(this.buffer);
      this.buffer = newBuf;
    }
  }
  /**
   * The DataView over `buffer`, rebuilt only if the buffer has grown since it
   * was last used.
   */
  view() {
    const bytes = this.buffer;
    const view = this.viewCache;
    if (view.byteLength === bytes.byteLength)
      return view;
    const newView = new DataView(bytes.buffer);
    this.viewCache = newView;
    return newView;
  }
  /**
   * Return all bytes written and reset this writer.
   */
  finish() {
    const result = this.buffer.slice(0, this.pos);
    this.pos = 0;
    this.stackPos = [];
    return result;
  }
  /**
   * Start a new fork for length-delimited data like a message
   * or a packed repeated field.
   *
   * Must be joined later with `join()`.
   */
  fork() {
    this.stackPos.push(this.pos);
    this.ensureCapacity(DEFAULT_LEN_PREFIX_SIZE);
    this.buffer[this.pos++] = 0;
    return this;
  }
  /**
   * Join the last fork. Write its length and bytes, then
   * return to the previous state.
   */
  join() {
    const forkPos = this.stackPos.pop();
    if (forkPos === void 0)
      throw new Error("invalid state, fork stack empty");
    const len = this.pos - forkPos - DEFAULT_LEN_PREFIX_SIZE;
    const lenPrefixSize = varint32Size(len);
    if (lenPrefixSize > DEFAULT_LEN_PREFIX_SIZE) {
      this.ensureCapacity(lenPrefixSize - DEFAULT_LEN_PREFIX_SIZE);
      this.buffer.copyWithin(forkPos + lenPrefixSize, forkPos + DEFAULT_LEN_PREFIX_SIZE, this.pos);
    }
    this.pos = forkPos;
    this.uint32(len);
    this.pos += len;
    return this;
  }
  /**
   * Writes a tag (field number and wire type).
   *
   * Equivalent to `uint32( (fieldNo << 3 | type) >>> 0 )`.
   *
   * Generated code should compute the tag ahead of time and call `uint32()`.
   */
  tag(fieldNo, type) {
    return this.uint32((fieldNo << 3 | type) >>> 0);
  }
  /**
   * Write a chunk of raw bytes.
   */
  raw(chunk) {
    this.ensureCapacity(chunk.length);
    this.buffer.set(chunk, this.pos);
    this.pos += chunk.length;
    return this;
  }
  /**
   * Write a `uint32` value, an unsigned 32 bit varint.
   */
  uint32(value) {
    assertUInt32(value);
    this.ensureCapacity(5);
    if (value < 128) {
      this.buffer[this.pos++] = value;
      return this;
    }
    while (value > 127) {
      this.buffer[this.pos++] = value & 127 | 128;
      value >>>= 7;
    }
    this.buffer[this.pos++] = value;
    return this;
  }
  /**
   * Write a `int32` value, a signed 32 bit varint.
   */
  int32(value) {
    assertInt32(value);
    if (value >= 0) {
      return this.uint32(value);
    }
    this.ensureCapacity(10);
    for (let i = 0; i < 9; i++) {
      this.buffer[this.pos++] = value & 127 | 128;
      value >>= 7;
    }
    this.buffer[this.pos++] = 1;
    return this;
  }
  /**
   * Write a `bool` value, a varint.
   */
  bool(value) {
    this.ensureCapacity(1);
    this.buffer[this.pos++] = value ? 1 : 0;
    return this;
  }
  /**
   * Write a `bytes` value, length-delimited arbitrary data.
   */
  bytes(value) {
    this.uint32(value.byteLength);
    return this.raw(value);
  }
  /**
   * Write a `string` value, length-delimited data converted to UTF-8 text.
   */
  string(value) {
    if (typeof value !== "string") {
      value = String(value);
    }
    const len = value.length;
    if (len <= ASCII_MAX_LENGTH) {
      this.ensureCapacity(len + 1);
      const ascii = this.buffer;
      let pos = this.pos;
      ascii[pos++] = len;
      let i = 0;
      for (; i < len; i++) {
        const code = value.charCodeAt(i);
        if (code > 127)
          break;
        ascii[pos++] = code;
      }
      if (i == len) {
        this.pos = pos;
        return this;
      }
    }
    this.ensureCapacity(len * 3 + 5);
    const lenPrefixSizeGuess = varint32Size(len);
    const buf = this.buffer;
    const start = this.pos;
    const { written } = this.encodeUtf8Into(value, buf.subarray(start + lenPrefixSizeGuess));
    const lenPrefixSize = varint32Size(written);
    if (lenPrefixSize != lenPrefixSizeGuess) {
      buf.copyWithin(start + lenPrefixSize, start + lenPrefixSizeGuess, start + lenPrefixSizeGuess + written);
    }
    this.uint32(written);
    this.pos += written;
    return this;
  }
  /**
   * Write a `float` value, 32-bit floating point number.
   */
  float(value) {
    assertFloat32(value);
    this.ensureCapacity(4);
    this.view().setFloat32(this.pos, value, true);
    this.pos += 4;
    return this;
  }
  /**
   * Write a `double` value, a 64-bit floating point number.
   */
  double(value) {
    this.ensureCapacity(8);
    this.view().setFloat64(this.pos, value, true);
    this.pos += 8;
    return this;
  }
  /**
   * Write a `fixed32` value, an unsigned, fixed-length 32-bit integer.
   */
  fixed32(value) {
    assertUInt32(value);
    this.ensureCapacity(4);
    this.view().setUint32(this.pos, value, true);
    this.pos += 4;
    return this;
  }
  /**
   * Write a `sfixed32` value, a signed, fixed-length 32-bit integer.
   */
  sfixed32(value) {
    assertInt32(value);
    this.ensureCapacity(4);
    this.view().setInt32(this.pos, value, true);
    this.pos += 4;
    return this;
  }
  /**
   * Write a `sint32` value, a signed, zigzag-encoded 32-bit varint.
   */
  sint32(value) {
    assertInt32(value);
    return this.uint32((value << 1 ^ value >> 31) >>> 0);
  }
  /**
   * Write a `sfixed64` value, a signed, fixed-length 64-bit integer.
   */
  sfixed64(value) {
    const tc = protoInt64.enc(value);
    this.ensureCapacity(8);
    const view = this.view();
    view.setInt32(this.pos, tc.lo, true);
    view.setInt32(this.pos + 4, tc.hi, true);
    this.pos += 8;
    return this;
  }
  /**
   * Write a `fixed64` value, an unsigned, fixed-length 64 bit integer.
   */
  fixed64(value) {
    const tc = protoInt64.uEnc(value);
    this.ensureCapacity(8);
    const view = this.view();
    view.setInt32(this.pos, tc.lo, true);
    view.setInt32(this.pos + 4, tc.hi, true);
    this.pos += 8;
    return this;
  }
  /**
   * Write a `int64` value, a signed 64-bit varint.
   */
  int64(value) {
    const tc = protoInt64.enc(value);
    return this.writeVarint64(tc.lo, tc.hi);
  }
  /**
   * Write a `sint64` value, a signed, zig-zag-encoded 64-bit varint.
   */
  sint64(value) {
    const tc = protoInt64.enc(value), sign = tc.hi >> 31, lo = tc.lo << 1 ^ sign, hi = (tc.hi << 1 | tc.lo >>> 31) ^ sign;
    return this.writeVarint64(lo, hi);
  }
  /**
   * Write a `uint64` value, an unsigned 64-bit varint.
   */
  uint64(value) {
    const tc = protoInt64.uEnc(value);
    return this.writeVarint64(tc.lo, tc.hi);
  }
  /**
   * Write a 64-bit varint directly into the buffer. Accepts the value as
   * split low/high 32-bit words.
   *
   * Ported from varint64write() to avoid the intermediate number[] buffer.
   * See https://github.com/protocolbuffers/protobuf/blob/8a71927d74a4ce34efe2d8769fda198f52d20d12/js/experimental/runtime/kernel/writer.js#L344
   */
  writeVarint64(lo, hi) {
    this.ensureCapacity(10);
    const buf = this.buffer;
    let pos = this.pos;
    for (let i = 0; i < 28; i = i + 7) {
      const shift = lo >>> i;
      const hasNext = !(shift >>> 7 == 0 && hi == 0);
      buf[pos++] = (hasNext ? shift | 128 : shift) & 255;
      if (!hasNext) {
        this.pos = pos;
        return this;
      }
    }
    const splitBits = lo >>> 28 & 15 | (hi & 7) << 4;
    const hasMoreBits = !(hi >> 3 == 0);
    buf[pos++] = (hasMoreBits ? splitBits | 128 : splitBits) & 255;
    if (!hasMoreBits) {
      this.pos = pos;
      return this;
    }
    for (let i = 3; i < 31; i = i + 7) {
      const shift = hi >>> i;
      const hasNext = !(shift >>> 7 == 0);
      buf[pos++] = (hasNext ? shift | 128 : shift) & 255;
      if (!hasNext) {
        this.pos = pos;
        return this;
      }
    }
    buf[pos++] = hi >>> 31 & 1;
    this.pos = pos;
    return this;
  }
};
var INITIAL_SIZE = 128;
var DEFAULT_LEN_PREFIX_SIZE = 1;
var EMPTY_BUFFER = new Uint8Array(0);
var EMPTY_VIEW = new DataView(EMPTY_BUFFER.buffer);
var ASCII_MAX_LENGTH = 32;
function varint32Size(value) {
  if (value < 128)
    return 1;
  if (value < 16384)
    return 2;
  if (value < 2097152)
    return 3;
  if (value < 268435456)
    return 4;
  return 5;
}
var BinaryReader = class {
  constructor(buf, decodeUtf8 = getTextEncoding().decodeUtf8) {
    this.decodeUtf8 = decodeUtf8;
    this.varint64Lo = 0;
    this.varint64Hi = 0;
    this.varint64 = varint64read;
    this.uint32 = varint32read;
    this.buf = buf;
    this.len = buf.length;
    this.pos = 0;
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  /**
   * Reads a tag - field number and wire type. Tags are uint32 varints; values
   * that do not fit in uint32 are rejected.
   */
  tag() {
    const start = this.pos;
    const tag = this.uint32();
    const bytesRead = this.pos - start;
    if (bytesRead > 5 || bytesRead == 5 && this.buf[this.pos - 1] > 15) {
      throw new Error("illegal tag: varint overflows uint32");
    }
    const fieldNo = tag >>> 3;
    const wireType = tag & 7;
    if (fieldNo <= 0 || wireType > 5) {
      throw new Error("illegal tag: field no " + fieldNo + " wire type " + wireType);
    }
    return [fieldNo, wireType];
  }
  /**
   * Skip one element and return the skipped data.
   *
   * When skipping StartGroup, provide the tags field number to check for
   * matching field number in the EndGroup tag. Recursion into nested groups
   * is guarded by the `recursionLimit` argument: When the limit is reached,
   * this method throws.
   */
  skip(wireType, fieldNo, recursionLimit = 100) {
    let start = this.pos;
    switch (wireType) {
      case WireType.Varint:
        while (this.buf[this.pos++] & 128) {
        }
        break;
      // @ts-ignore TS7029: Fallthrough case in switch -- ignore instead of expect-error for compiler settings without noFallthroughCasesInSwitch: true
      case WireType.Bit64:
        this.pos += 4;
      case WireType.Bit32:
        this.pos += 4;
        break;
      case WireType.LengthDelimited:
        let len = this.uint32();
        this.pos += len;
        break;
      case WireType.StartGroup:
        if (recursionLimit <= 0) {
          throw new Error("maximum recursion depth reached");
        }
        for (; ; ) {
          const [fn, wt] = this.tag();
          if (wt === WireType.EndGroup) {
            if (fieldNo !== void 0 && fn !== fieldNo) {
              throw new Error("invalid end group tag");
            }
            break;
          }
          this.skip(wt, fn, recursionLimit - 1);
        }
        break;
      default:
        throw new Error("cant skip wire type " + wireType);
    }
    this.assertBounds();
    return this.buf.subarray(start, this.pos);
  }
  /**
   * Throws error if position in byte array is out of range.
   */
  assertBounds() {
    if (this.pos > this.len)
      throw new RangeError("premature EOF");
  }
  /**
   * Read a `int32` field, a signed 32 bit varint.
   */
  int32() {
    return this.uint32() | 0;
  }
  /**
   * Read a `sint32` field, a signed, zigzag-encoded 32-bit varint.
   */
  sint32() {
    let zze = this.uint32();
    return zze >>> 1 ^ -(zze & 1);
  }
  /**
   * Read a `int64` field, a signed 64-bit varint.
   */
  int64() {
    this.varint64();
    return protoInt64.dec(this.varint64Lo, this.varint64Hi);
  }
  /**
   * Read a `uint64` field, an unsigned 64-bit varint.
   */
  uint64() {
    this.varint64();
    return protoInt64.uDec(this.varint64Lo, this.varint64Hi);
  }
  /**
   * Read a `sint64` field, a signed, zig-zag-encoded 64-bit varint.
   */
  sint64() {
    this.varint64();
    let lo = this.varint64Lo;
    let hi = this.varint64Hi;
    let s = -(lo & 1);
    lo = (lo >>> 1 | (hi & 1) << 31) ^ s;
    hi = hi >>> 1 ^ s;
    return protoInt64.dec(lo, hi);
  }
  /**
   * Read a `bool` field, a variant.
   */
  bool() {
    const b = this.buf[this.pos];
    if (b < 128) {
      this.pos++;
      return b !== 0;
    }
    this.varint64();
    return this.varint64Lo !== 0 || this.varint64Hi !== 0;
  }
  /**
   * Read a `fixed32` field, an unsigned, fixed-length 32-bit integer.
   */
  fixed32() {
    return this.view.getUint32((this.pos += 4) - 4, true);
  }
  /**
   * Read a `sfixed32` field, a signed, fixed-length 32-bit integer.
   */
  sfixed32() {
    return this.view.getInt32((this.pos += 4) - 4, true);
  }
  /**
   * Read a `fixed64` field, an unsigned, fixed-length 64 bit integer.
   */
  fixed64() {
    return protoInt64.uDec(this.sfixed32(), this.sfixed32());
  }
  /**
   * Read a `fixed64` field, a signed, fixed-length 64-bit integer.
   */
  sfixed64() {
    return protoInt64.dec(this.sfixed32(), this.sfixed32());
  }
  /**
   * Read a `float` field, 32-bit floating point number.
   */
  float() {
    return this.view.getFloat32((this.pos += 4) - 4, true);
  }
  /**
   * Read a `double` field, a 64-bit floating point number.
   */
  double() {
    return this.view.getFloat64((this.pos += 8) - 8, true);
  }
  /**
   * Read a `bytes` field, length-delimited arbitrary data.
   */
  bytes() {
    let len = this.uint32(), start = this.pos;
    this.pos += len;
    this.assertBounds();
    return this.buf.subarray(start, start + len);
  }
  /**
   * Read a `string` field, length-delimited data converted to UTF-8 text. If
   * `strict` is true, throw on invalid UTF-8 instead of substituting U+FFFD.
   */
  string(strict) {
    const bytes = this.bytes();
    const len = bytes.length;
    if (len <= ASCII_MAX_LENGTH) {
      const codes = new Array(len);
      for (let i = 0; i < len; i++) {
        const byte = bytes[i];
        if (byte > 127) {
          return this.decodeUtf8(bytes, strict);
        }
        codes[i] = byte;
      }
      return String.fromCharCode.apply(String, codes);
    }
    return this.decodeUtf8(bytes, strict);
  }
};
function assertInt32(arg) {
  if (typeof arg == "string") {
    arg = Number(arg);
  } else if (typeof arg != "number") {
    throw new Error("invalid int32: " + typeof arg);
  }
  if (!Number.isInteger(arg) || arg > INT32_MAX || arg < INT32_MIN)
    throw new Error("invalid int32: " + arg);
}
function assertUInt32(arg) {
  if (typeof arg == "string") {
    arg = Number(arg);
  } else if (typeof arg != "number") {
    throw new Error("invalid uint32: " + typeof arg);
  }
  if (!Number.isInteger(arg) || arg > UINT32_MAX || arg < 0)
    throw new Error("invalid uint32: " + arg);
}
function assertFloat32(arg) {
  if (typeof arg == "string") {
    const o = arg;
    arg = Number(arg);
    if (Number.isNaN(arg) && o !== "NaN") {
      throw new Error("invalid float32: " + o);
    }
  } else if (typeof arg != "number") {
    throw new Error("invalid float32: " + typeof arg);
  }
  if (Number.isFinite(arg) && (arg > FLOAT32_MAX || arg < FLOAT32_MIN))
    throw new Error("invalid float32: " + arg);
}

// node_modules/@bufbuild/protobuf/dist/esm/reflect/message.js
var NULL_VALUE = 0;
function localMessageMapper(field) {
  if (usesJsonRepresentation(field)) {
    return {
      toMessage: (local) => wktStructToReflect(local),
      toLocal: (message) => wktStructToLocal(message)
    };
  }
  if (field.fieldKind == "message" && !field.oneof && isWrapperDesc(field.message)) {
    const wrapperDesc = field.message;
    const valueLocalName = wrapperDesc.fields[0].localName;
    return {
      toMessage: (local) => {
        const message = create(wrapperDesc);
        if (local !== void 0) {
          message[valueLocalName] = local;
        }
        return message;
      },
      toLocal: (message) => message[valueLocalName]
    };
  }
  const childDesc = field.message;
  return {
    toMessage: (local) => local === void 0 ? create(childDesc) : local,
    toLocal: (message) => message
  };
}
function usesJsonRepresentation(field) {
  return field.message.typeName == "google.protobuf.Struct" && field.parent.typeName != "google.protobuf.Value";
}
function wktStructToReflect(json) {
  const struct = {
    $typeName: "google.protobuf.Struct",
    fields: {}
  };
  if (isObject(json)) {
    for (const k of Object.keys(json)) {
      struct.fields[k] = wktValueToReflect(json[k]);
    }
  }
  return struct;
}
function wktStructToLocal(val) {
  const json = {};
  for (const k of Object.keys(val.fields)) {
    json[k] = wktValueToLocal(val.fields[k]);
  }
  return json;
}
function wktValueToLocal(val) {
  switch (val.kind.case) {
    case "structValue":
      return wktStructToLocal(val.kind.value);
    case "listValue":
      return val.kind.value.values.map(wktValueToLocal);
    case "nullValue":
    case void 0:
      return null;
    default:
      return val.kind.value;
  }
}
function wktValueToReflect(json) {
  const value = {
    $typeName: "google.protobuf.Value",
    kind: { case: void 0 }
  };
  switch (typeof json) {
    case "number":
      value.kind = { case: "numberValue", value: json };
      break;
    case "string":
      value.kind = { case: "stringValue", value: json };
      break;
    case "boolean":
      value.kind = { case: "boolValue", value: json };
      break;
    case "object":
      if (json === null) {
        value.kind = { case: "nullValue", value: NULL_VALUE };
      } else if (Array.isArray(json)) {
        const listValue = {
          $typeName: "google.protobuf.ListValue",
          values: []
        };
        if (Array.isArray(json)) {
          for (const e of json) {
            listValue.values.push(wktValueToReflect(e));
          }
        }
        value.kind = {
          case: "listValue",
          value: listValue
        };
      } else {
        value.kind = {
          case: "structValue",
          value: wktStructToReflect(json)
        };
      }
      break;
  }
  return value;
}

// node_modules/@bufbuild/protobuf/dist/esm/wire/base64-encoding.js
var nativeSetFromBase64 = Uint8Array.prototype.setFromBase64;
function base64Decode(base64Str) {
  const len = base64Str.length;
  let size = len - (len + 3 >> 2);
  if ((len & 3) == 0 && base64Str[len - 1] == "=") {
    size -= base64Str[len - 2] == "=" ? 2 : 1;
  }
  const bytes = new Uint8Array(size);
  let written = -1;
  if (nativeSetFromBase64) {
    try {
      const result = nativeSetFromBase64.call(bytes, base64Str);
      if (result.read == len) {
        written = result.written;
      }
    } catch (_a) {
    }
  }
  if (written < 0) {
    written = setFromBase64(bytes, base64Str);
  }
  return written == size ? bytes : bytes.subarray(0, written);
}
function setFromBase64(bytes, base64Str) {
  const table = getDecodeTable();
  let bytePos = 0, groupPos = 0, b, p = 0;
  for (let i = 0; i < base64Str.length; i++) {
    b = table[base64Str.charCodeAt(i)];
    if (b === void 0) {
      switch (base64Str[i]) {
        // @ts-ignore TS7029: Fallthrough case in switch -- ignore instead of expect-error for compiler settings without noFallthroughCasesInSwitch: true
        case "=":
          groupPos = 0;
        // reset state when padding found
        case "\n":
        case "\r":
        case "	":
        case " ":
          continue;
        // skip white-space, and padding
        default:
          throw Error("invalid base64 string");
      }
    }
    switch (groupPos) {
      case 0:
        p = b;
        groupPos = 1;
        break;
      case 1:
        bytes[bytePos++] = p << 2 | (b & 48) >> 4;
        p = b;
        groupPos = 2;
        break;
      case 2:
        bytes[bytePos++] = (p & 15) << 4 | (b & 60) >> 2;
        p = b;
        groupPos = 3;
        break;
      case 3:
        bytes[bytePos++] = (p & 3) << 6 | b;
        groupPos = 0;
        break;
    }
  }
  if (groupPos == 1)
    throw Error("invalid base64 string");
  return bytePos;
}
var nativeToBase64 = Uint8Array.prototype.toBase64;
var encodeTableStd;
var encodeTableUrl;
var decodeTable;
function getEncodeTable(encoding) {
  if (!encodeTableStd) {
    encodeTableStd = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".split("");
    encodeTableUrl = encodeTableStd.slice(0, -2).concat("-", "_");
  }
  return encoding == "url" ? (
    // biome-ignore lint/style/noNonNullAssertion: TS fails to narrow down
    encodeTableUrl
  ) : encodeTableStd;
}
function getDecodeTable() {
  if (!decodeTable) {
    decodeTable = [];
    const encodeTable = getEncodeTable("std");
    for (let i = 0; i < encodeTable.length; i++)
      decodeTable[encodeTable[i].charCodeAt(0)] = i;
    decodeTable["-".charCodeAt(0)] = encodeTable.indexOf("+");
    decodeTable["_".charCodeAt(0)] = encodeTable.indexOf("/");
  }
  return decodeTable;
}

// node_modules/@bufbuild/protobuf/dist/esm/reflect/names.js
function protoCamelCase(snakeCase) {
  let capNext = false;
  const b = [];
  for (let i = 0; i < snakeCase.length; i++) {
    let c = snakeCase.charAt(i);
    switch (c) {
      case "_":
        capNext = true;
        break;
      case "0":
      case "1":
      case "2":
      case "3":
      case "4":
      case "5":
      case "6":
      case "7":
      case "8":
      case "9":
        b.push(c);
        capNext = false;
        break;
      default:
        if (capNext) {
          capNext = false;
          c = c.toUpperCase();
        }
        b.push(c);
        break;
    }
  }
  return b.join("");
}
var reservedObjectProperties = /* @__PURE__ */ new Set([
  // names reserved by JavaScript
  "constructor",
  "toString",
  "toJSON",
  "valueOf"
]);
function safeObjectProperty(name) {
  return reservedObjectProperties.has(name) ? name + "$" : name;
}

// node_modules/@bufbuild/protobuf/dist/esm/codegenv2/restore-json-names.js
function restoreJsonNames(message) {
  for (const f of message.field) {
    if (!unsafeIsSetExplicit(f, "jsonName")) {
      f.jsonName = protoCamelCase(f.name);
    }
  }
  message.nestedType.forEach(restoreJsonNames);
}

// node_modules/@bufbuild/protobuf/dist/esm/wire/text-format.js
function parseTextFormatEnumValue(descEnum, value) {
  const enumValue = descEnum.values.find((v) => v.name === value);
  if (!enumValue) {
    throw new Error(`cannot parse ${descEnum} default value: ${value}`);
  }
  return enumValue.number;
}
function parseTextFormatScalarValue(type, value) {
  switch (type) {
    case ScalarType.STRING:
      return value;
    case ScalarType.BYTES: {
      const u = unescapeBytesDefaultValue(value);
      if (u === false) {
        throw new Error(`cannot parse ${ScalarType[type]} default value: ${value}`);
      }
      return u;
    }
    case ScalarType.INT64:
    case ScalarType.SFIXED64:
    case ScalarType.SINT64:
      return protoInt64.parse(value);
    case ScalarType.UINT64:
    case ScalarType.FIXED64:
      return protoInt64.uParse(value);
    case ScalarType.DOUBLE:
    case ScalarType.FLOAT:
      switch (value) {
        case "inf":
          return Number.POSITIVE_INFINITY;
        case "-inf":
          return Number.NEGATIVE_INFINITY;
        case "nan":
          return Number.NaN;
        default:
          return parseFloat(value);
      }
    case ScalarType.BOOL:
      return value === "true";
    case ScalarType.INT32:
    case ScalarType.UINT32:
    case ScalarType.SINT32:
    case ScalarType.FIXED32:
    case ScalarType.SFIXED32:
      return parseInt(value, 10);
  }
}
function unescapeBytesDefaultValue(str) {
  const b = [];
  const input = {
    tail: str,
    c: "",
    next() {
      if (this.tail.length == 0) {
        return false;
      }
      this.c = this.tail[0];
      this.tail = this.tail.substring(1);
      return true;
    },
    take(n) {
      if (this.tail.length >= n) {
        const r = this.tail.substring(0, n);
        this.tail = this.tail.substring(n);
        return r;
      }
      return false;
    }
  };
  while (input.next()) {
    switch (input.c) {
      case "\\":
        if (input.next()) {
          switch (input.c) {
            case "\\":
              b.push(input.c.charCodeAt(0));
              break;
            case "b":
              b.push(8);
              break;
            case "f":
              b.push(12);
              break;
            case "n":
              b.push(10);
              break;
            case "r":
              b.push(13);
              break;
            case "t":
              b.push(9);
              break;
            case "v":
              b.push(11);
              break;
            case "0":
            case "1":
            case "2":
            case "3":
            case "4":
            case "5":
            case "6":
            case "7": {
              const s = input.c;
              const t = input.take(2);
              if (t === false) {
                return false;
              }
              const n = parseInt(s + t, 8);
              if (Number.isNaN(n)) {
                return false;
              }
              b.push(n);
              break;
            }
            case "x": {
              const s = input.c;
              const t = input.take(2);
              if (t === false) {
                return false;
              }
              const n = parseInt(s + t, 16);
              if (Number.isNaN(n)) {
                return false;
              }
              b.push(n);
              break;
            }
            case "u": {
              const s = input.c;
              const t = input.take(4);
              if (t === false) {
                return false;
              }
              const n = parseInt(s + t, 16);
              if (Number.isNaN(n)) {
                return false;
              }
              const chunk = new Uint8Array(4);
              const view = new DataView(chunk.buffer);
              view.setInt32(0, n, true);
              b.push(chunk[0], chunk[1], chunk[2], chunk[3]);
              break;
            }
            case "U": {
              const s = input.c;
              const t = input.take(8);
              if (t === false) {
                return false;
              }
              const tc = protoInt64.uEnc(s + t);
              const chunk = new Uint8Array(8);
              const view = new DataView(chunk.buffer);
              view.setInt32(0, tc.lo, true);
              view.setInt32(4, tc.hi, true);
              b.push(chunk[0], chunk[1], chunk[2], chunk[3], chunk[4], chunk[5], chunk[6], chunk[7]);
              break;
            }
          }
        }
        break;
      default:
        b.push(input.c.charCodeAt(0));
    }
  }
  return new Uint8Array(b);
}

// node_modules/@bufbuild/protobuf/dist/esm/reflect/nested-types.js
function* nestedTypes(desc) {
  switch (desc.kind) {
    case "file":
      for (const message of desc.messages) {
        yield message;
        yield* nestedTypes(message);
      }
      yield* desc.enums;
      yield* desc.services;
      yield* desc.extensions;
      break;
    case "message":
      for (const message of desc.nestedMessages) {
        yield message;
        yield* nestedTypes(message);
      }
      yield* desc.nestedEnums;
      yield* desc.nestedExtensions;
      break;
  }
}

// node_modules/@bufbuild/protobuf/dist/esm/registry.js
function createFileRegistry(...args) {
  const registry = createBaseRegistry();
  if (!args.length) {
    return registry;
  }
  if ("$typeName" in args[0] && args[0].$typeName == "google.protobuf.FileDescriptorSet") {
    for (const file of args[0].file) {
      addFile(file, registry);
    }
    return registry;
  }
  if ("$typeName" in args[0]) {
    let recurseDeps = function(file) {
      const deps = [];
      for (const protoFileName of file.dependency) {
        if (registry.getFile(protoFileName) != void 0) {
          continue;
        }
        if (seen.has(protoFileName)) {
          continue;
        }
        const dep = resolve(protoFileName);
        if (!dep) {
          throw new Error(`Unable to resolve ${protoFileName}, imported by ${file.name}`);
        }
        if ("kind" in dep) {
          registry.addFile(dep, false, true);
        } else {
          seen.add(dep.name);
          deps.push(dep);
        }
      }
      return deps.concat(...deps.map(recurseDeps));
    };
    const input = args[0];
    const resolve = args[1];
    const seen = /* @__PURE__ */ new Set();
    for (const file of [input, ...recurseDeps(input)].reverse()) {
      addFile(file, registry);
    }
  } else {
    for (const fileReg of args) {
      for (const file of fileReg.files) {
        registry.addFile(file);
      }
    }
  }
  return registry;
}
function createBaseRegistry() {
  const types = /* @__PURE__ */ new Map();
  const extendees = /* @__PURE__ */ new Map();
  const files = /* @__PURE__ */ new Map();
  return {
    kind: "registry",
    types,
    extendees,
    [Symbol.iterator]() {
      return types.values();
    },
    get files() {
      return files.values();
    },
    addFile(file, skipTypes, withDeps) {
      files.set(file.proto.name, file);
      if (!skipTypes) {
        for (const type of nestedTypes(file)) {
          this.add(type);
        }
      }
      if (withDeps) {
        for (const f of file.dependencies) {
          this.addFile(f, skipTypes, withDeps);
        }
      }
    },
    add(desc) {
      if (desc.kind == "extension") {
        let numberToExt = extendees.get(desc.extendee.typeName);
        if (!numberToExt) {
          extendees.set(
            desc.extendee.typeName,
            // biome-ignore lint/suspicious/noAssignInExpressions: no
            numberToExt = /* @__PURE__ */ new Map()
          );
        }
        numberToExt.set(desc.number, desc);
      }
      types.set(desc.typeName, desc);
    },
    get(typeName) {
      return types.get(typeName);
    },
    getFile(fileName) {
      return files.get(fileName);
    },
    getMessage(typeName) {
      const t = types.get(typeName);
      return (t === null || t === void 0 ? void 0 : t.kind) == "message" ? t : void 0;
    },
    getEnum(typeName) {
      const t = types.get(typeName);
      return (t === null || t === void 0 ? void 0 : t.kind) == "enum" ? t : void 0;
    },
    getExtension(typeName) {
      const t = types.get(typeName);
      return (t === null || t === void 0 ? void 0 : t.kind) == "extension" ? t : void 0;
    },
    getExtensionFor(extendee, no) {
      var _a;
      return (_a = extendees.get(extendee.typeName)) === null || _a === void 0 ? void 0 : _a.get(no);
    },
    getService(typeName) {
      const t = types.get(typeName);
      return (t === null || t === void 0 ? void 0 : t.kind) == "service" ? t : void 0;
    }
  };
}
var EDITION_PROTO22 = 998;
var EDITION_PROTO32 = 999;
var EDITION_UNSTABLE = 9999;
var TYPE_STRING = 9;
var TYPE_GROUP = 10;
var TYPE_MESSAGE = 11;
var TYPE_BYTES = 12;
var TYPE_ENUM = 14;
var LABEL_REPEATED = 3;
var LABEL_REQUIRED = 2;
var JS_STRING = 1;
var IDEMPOTENCY_UNKNOWN = 0;
var EXPLICIT = 1;
var IMPLICIT2 = 2;
var LEGACY_REQUIRED = 3;
var PACKED = 1;
var DELIMITED = 2;
var OPEN = 1;
var VERIFY = 2;
var maximumEdition = 1001;
var featureDefaults = {
  // EDITION_PROTO2
  998: {
    fieldPresence: 1,
    // EXPLICIT,
    enumType: 2,
    // CLOSED,
    repeatedFieldEncoding: 2,
    // EXPANDED,
    utf8Validation: 3,
    // NONE,
    messageEncoding: 1,
    // LENGTH_PREFIXED,
    jsonFormat: 2,
    // LEGACY_BEST_EFFORT,
    enforceNamingStyle: 2,
    // STYLE_LEGACY,
    defaultSymbolVisibility: 1
    // EXPORT_ALL,
  },
  // EDITION_PROTO3
  999: {
    fieldPresence: 2,
    // IMPLICIT,
    enumType: 1,
    // OPEN,
    repeatedFieldEncoding: 1,
    // PACKED,
    utf8Validation: 2,
    // VERIFY,
    messageEncoding: 1,
    // LENGTH_PREFIXED,
    jsonFormat: 1,
    // ALLOW,
    enforceNamingStyle: 2,
    // STYLE_LEGACY,
    defaultSymbolVisibility: 1
    // EXPORT_ALL,
  },
  // EDITION_2023
  1e3: {
    fieldPresence: 1,
    // EXPLICIT,
    enumType: 1,
    // OPEN,
    repeatedFieldEncoding: 1,
    // PACKED,
    utf8Validation: 2,
    // VERIFY,
    messageEncoding: 1,
    // LENGTH_PREFIXED,
    jsonFormat: 1,
    // ALLOW,
    enforceNamingStyle: 2,
    // STYLE_LEGACY,
    defaultSymbolVisibility: 1
    // EXPORT_ALL,
  },
  // EDITION_2024
  1001: {
    fieldPresence: 1,
    // EXPLICIT,
    enumType: 1,
    // OPEN,
    repeatedFieldEncoding: 1,
    // PACKED,
    utf8Validation: 2,
    // VERIFY,
    messageEncoding: 1,
    // LENGTH_PREFIXED,
    jsonFormat: 1,
    // ALLOW,
    enforceNamingStyle: 1,
    // STYLE2024,
    defaultSymbolVisibility: 2
    // EXPORT_TOP_LEVEL,
  }
};
function addFile(proto, reg) {
  var _a, _b;
  const file = {
    kind: "file",
    proto,
    deprecated: (_b = (_a = proto.options) === null || _a === void 0 ? void 0 : _a.deprecated) !== null && _b !== void 0 ? _b : false,
    edition: getFileEdition(proto),
    name: proto.name.replace(/\.proto$/, ""),
    dependencies: findFileDependencies(proto, reg),
    enums: [],
    messages: [],
    extensions: [],
    services: [],
    toString() {
      return `file ${proto.name}`;
    }
  };
  const mapEntriesStore = /* @__PURE__ */ new Map();
  const mapEntries = {
    get(typeName) {
      return mapEntriesStore.get(typeName);
    },
    add(desc) {
      var _a2;
      assert(((_a2 = desc.proto.options) === null || _a2 === void 0 ? void 0 : _a2.mapEntry) === true);
      mapEntriesStore.set(desc.typeName, desc);
    }
  };
  for (const enumProto of proto.enumType) {
    addEnum(enumProto, file, void 0, reg);
  }
  for (const messageProto of proto.messageType) {
    addMessage(messageProto, file, void 0, reg, mapEntries);
  }
  for (const serviceProto of proto.service) {
    addService(serviceProto, file, reg);
  }
  addExtensions(file, reg);
  for (const mapEntry of mapEntriesStore.values()) {
    addFields(mapEntry, reg, mapEntries);
  }
  for (const message of file.messages) {
    addFields(message, reg, mapEntries);
    addExtensions(message, reg);
  }
  reg.addFile(file, true);
}
function addExtensions(desc, reg) {
  switch (desc.kind) {
    case "file":
      for (const proto of desc.proto.extension) {
        const ext = newField(proto, desc, reg);
        desc.extensions.push(ext);
        reg.add(ext);
      }
      break;
    case "message":
      for (const proto of desc.proto.extension) {
        const ext = newField(proto, desc, reg);
        desc.nestedExtensions.push(ext);
        reg.add(ext);
      }
      for (const message of desc.nestedMessages) {
        addExtensions(message, reg);
      }
      break;
  }
}
function addFields(message, reg, mapEntries) {
  const allOneofs = message.proto.oneofDecl.map((proto) => newOneof(proto, message));
  const oneofsSeen = /* @__PURE__ */ new Set();
  for (const proto of message.proto.field) {
    const oneof = findOneof(proto, allOneofs);
    const field = newField(proto, message, reg, oneof, mapEntries);
    message.fields.push(field);
    message.field[field.localName] = field;
    if (oneof === void 0) {
      message.members.push(field);
    } else {
      oneof.fields.push(field);
      if (!oneofsSeen.has(oneof)) {
        oneofsSeen.add(oneof);
        message.members.push(oneof);
      }
    }
  }
  for (const oneof of allOneofs.filter((o) => oneofsSeen.has(o))) {
    message.oneofs.push(oneof);
  }
  for (const child of message.nestedMessages) {
    addFields(child, reg, mapEntries);
  }
}
function addEnum(proto, file, parent, reg) {
  var _a, _b, _c, _d, _e;
  const sharedPrefix = findEnumSharedPrefix(proto.name, proto.value);
  const desc = {
    kind: "enum",
    proto,
    deprecated: (_b = (_a = proto.options) === null || _a === void 0 ? void 0 : _a.deprecated) !== null && _b !== void 0 ? _b : false,
    file,
    parent,
    open: true,
    name: proto.name,
    typeName: makeTypeName(proto, parent, file),
    value: {},
    values: [],
    sharedPrefix,
    toString() {
      return `enum ${this.typeName}`;
    }
  };
  desc.open = isEnumOpen(desc);
  reg.add(desc);
  for (const p of proto.value) {
    const name = p.name;
    desc.values.push(
      // biome-ignore lint/suspicious/noAssignInExpressions: no
      desc.value[p.number] = {
        kind: "enum_value",
        proto: p,
        deprecated: (_d = (_c = p.options) === null || _c === void 0 ? void 0 : _c.deprecated) !== null && _d !== void 0 ? _d : false,
        parent: desc,
        name,
        localName: safeObjectProperty(sharedPrefix == void 0 ? name : name.substring(sharedPrefix.length)),
        number: p.number,
        toString() {
          return `enum value ${desc.typeName}.${name}`;
        }
      }
    );
  }
  ((_e = parent === null || parent === void 0 ? void 0 : parent.nestedEnums) !== null && _e !== void 0 ? _e : file.enums).push(desc);
}
function addMessage(proto, file, parent, reg, mapEntries) {
  var _a, _b, _c, _d;
  const desc = {
    kind: "message",
    proto,
    deprecated: (_b = (_a = proto.options) === null || _a === void 0 ? void 0 : _a.deprecated) !== null && _b !== void 0 ? _b : false,
    file,
    parent,
    name: proto.name,
    typeName: makeTypeName(proto, parent, file),
    fields: [],
    field: {},
    oneofs: [],
    members: [],
    nestedEnums: [],
    nestedMessages: [],
    nestedExtensions: [],
    toString() {
      return `message ${this.typeName}`;
    }
  };
  if (((_c = proto.options) === null || _c === void 0 ? void 0 : _c.mapEntry) === true) {
    mapEntries.add(desc);
  } else {
    ((_d = parent === null || parent === void 0 ? void 0 : parent.nestedMessages) !== null && _d !== void 0 ? _d : file.messages).push(desc);
    reg.add(desc);
  }
  for (const enumProto of proto.enumType) {
    addEnum(enumProto, file, desc, reg);
  }
  for (const messageProto of proto.nestedType) {
    addMessage(messageProto, file, desc, reg, mapEntries);
  }
}
function addService(proto, file, reg) {
  var _a, _b;
  const desc = {
    kind: "service",
    proto,
    deprecated: (_b = (_a = proto.options) === null || _a === void 0 ? void 0 : _a.deprecated) !== null && _b !== void 0 ? _b : false,
    file,
    name: proto.name,
    typeName: makeTypeName(proto, void 0, file),
    methods: [],
    method: {},
    toString() {
      return `service ${this.typeName}`;
    }
  };
  file.services.push(desc);
  reg.add(desc);
  for (const methodProto of proto.method) {
    const method = newMethod(methodProto, desc, reg);
    desc.methods.push(method);
    desc.method[method.localName] = method;
  }
}
function newMethod(proto, parent, reg) {
  var _a, _b, _c, _d;
  let methodKind;
  if (proto.clientStreaming && proto.serverStreaming) {
    methodKind = "bidi_streaming";
  } else if (proto.clientStreaming) {
    methodKind = "client_streaming";
  } else if (proto.serverStreaming) {
    methodKind = "server_streaming";
  } else {
    methodKind = "unary";
  }
  const input = reg.getMessage(trimLeadingDot(proto.inputType));
  const output = reg.getMessage(trimLeadingDot(proto.outputType));
  assert(input, `invalid MethodDescriptorProto: input_type ${proto.inputType} not found`);
  assert(output, `invalid MethodDescriptorProto: output_type ${proto.inputType} not found`);
  const name = proto.name;
  return {
    kind: "rpc",
    proto,
    deprecated: (_b = (_a = proto.options) === null || _a === void 0 ? void 0 : _a.deprecated) !== null && _b !== void 0 ? _b : false,
    parent,
    name,
    localName: safeObjectProperty(name.length ? safeObjectProperty(name[0].toLowerCase() + name.substring(1)) : name),
    methodKind,
    input,
    output,
    idempotency: (_d = (_c = proto.options) === null || _c === void 0 ? void 0 : _c.idempotencyLevel) !== null && _d !== void 0 ? _d : IDEMPOTENCY_UNKNOWN,
    toString() {
      return `rpc ${parent.typeName}.${name}`;
    }
  };
}
function newOneof(proto, parent) {
  return {
    kind: "oneof",
    proto,
    deprecated: false,
    parent,
    fields: [],
    name: proto.name,
    localName: safeObjectProperty(protoCamelCase(proto.name)),
    toString() {
      return `oneof ${parent.typeName}.${this.name}`;
    }
  };
}
function newField(proto, parentOrFile, reg, oneof, mapEntries) {
  var _a, _b, _c;
  const isExtension = mapEntries === void 0;
  const field = {
    kind: "field",
    proto,
    deprecated: (_b = (_a = proto.options) === null || _a === void 0 ? void 0 : _a.deprecated) !== null && _b !== void 0 ? _b : false,
    name: proto.name,
    number: proto.number,
    scalar: void 0,
    message: void 0,
    enum: void 0,
    presence: getFieldPresence(proto, oneof, isExtension, parentOrFile),
    utf8Validation: isUtf8Validated(proto, parentOrFile),
    listKind: void 0,
    mapKind: void 0,
    mapKey: void 0,
    delimitedEncoding: void 0,
    packed: void 0,
    longAsString: false,
    getDefaultValue: void 0
  };
  let toStr;
  if (isExtension) {
    const file = parentOrFile.kind == "file" ? parentOrFile : parentOrFile.file;
    const parent = parentOrFile.kind == "file" ? void 0 : parentOrFile;
    const typeName = makeTypeName(proto, parent, file);
    field.kind = "extension";
    field.file = file;
    field.parent = parent;
    field.oneof = void 0;
    field.typeName = typeName;
    field.jsonName = `[${typeName}]`;
    toStr = () => `extension ${typeName}`;
    const extendee = reg.getMessage(trimLeadingDot(proto.extendee));
    assert(extendee, `invalid FieldDescriptorProto: extendee ${proto.extendee} not found`);
    field.extendee = extendee;
  } else {
    const parent = parentOrFile;
    assert(parent.kind == "message");
    field.parent = parent;
    field.oneof = oneof;
    field.localName = oneof ? protoCamelCase(proto.name) : safeObjectProperty(protoCamelCase(proto.name));
    field.jsonName = proto.jsonName;
    toStr = () => `field ${parent.typeName}.${proto.name}`;
  }
  Object.defineProperty(field, "toString", {
    value: toStr,
    writable: true,
    enumerable: true,
    configurable: true
  });
  const label = proto.label;
  const type = proto.type;
  const jstype = (_c = proto.options) === null || _c === void 0 ? void 0 : _c.jstype;
  if (label === LABEL_REPEATED) {
    const mapEntry = type == TYPE_MESSAGE ? mapEntries === null || mapEntries === void 0 ? void 0 : mapEntries.get(trimLeadingDot(proto.typeName)) : void 0;
    if (mapEntry) {
      field.fieldKind = "map";
      const { key: key2, value } = findMapEntryFields(mapEntry);
      field.mapKey = key2.scalar;
      field.mapKind = value.fieldKind;
      field.message = value.message;
      field.delimitedEncoding = false;
      field.enum = value.enum;
      field.scalar = value.scalar;
      return field;
    }
    field.fieldKind = "list";
    switch (type) {
      case TYPE_MESSAGE:
      case TYPE_GROUP:
        field.listKind = "message";
        field.message = reg.getMessage(trimLeadingDot(proto.typeName));
        assert(field.message);
        field.delimitedEncoding = isDelimitedEncoding(proto, parentOrFile);
        break;
      case TYPE_ENUM:
        field.listKind = "enum";
        field.enum = reg.getEnum(trimLeadingDot(proto.typeName));
        assert(field.enum);
        break;
      default:
        field.listKind = "scalar";
        field.scalar = type;
        field.longAsString = jstype == JS_STRING;
        break;
    }
    field.packed = isPackedField(proto, parentOrFile);
    return field;
  }
  switch (type) {
    case TYPE_MESSAGE:
    case TYPE_GROUP:
      field.fieldKind = "message";
      field.message = reg.getMessage(trimLeadingDot(proto.typeName));
      assert(field.message, `invalid FieldDescriptorProto: type_name ${proto.typeName} not found`);
      field.delimitedEncoding = isDelimitedEncoding(proto, parentOrFile);
      field.getDefaultValue = () => void 0;
      break;
    case TYPE_ENUM: {
      const enumeration = reg.getEnum(trimLeadingDot(proto.typeName));
      assert(enumeration !== void 0, `invalid FieldDescriptorProto: type_name ${proto.typeName} not found`);
      field.fieldKind = "enum";
      field.enum = reg.getEnum(trimLeadingDot(proto.typeName));
      field.getDefaultValue = () => {
        return unsafeIsSetExplicit(proto, "defaultValue") ? parseTextFormatEnumValue(enumeration, proto.defaultValue) : void 0;
      };
      break;
    }
    default: {
      field.fieldKind = "scalar";
      field.scalar = type;
      field.longAsString = jstype == JS_STRING;
      field.getDefaultValue = () => {
        return unsafeIsSetExplicit(proto, "defaultValue") ? parseTextFormatScalarValue(type, proto.defaultValue) : void 0;
      };
      break;
    }
  }
  return field;
}
function getFileEdition(proto) {
  switch (proto.syntax) {
    case "":
    case "proto2":
      return EDITION_PROTO22;
    case "proto3":
      return EDITION_PROTO32;
    case "editions":
      if (proto.edition === EDITION_UNSTABLE) {
        return maximumEdition;
      }
      if (proto.edition in featureDefaults) {
        return proto.edition;
      }
      throw new Error(`${proto.name}: unsupported edition`);
    default:
      throw new Error(`${proto.name}: unsupported syntax "${proto.syntax}"`);
  }
}
function findFileDependencies(proto, reg) {
  return proto.dependency.map((wantName) => {
    const dep = reg.getFile(wantName);
    if (!dep) {
      throw new Error(`Cannot find ${wantName}, imported by ${proto.name}`);
    }
    return dep;
  });
}
function findEnumSharedPrefix(enumName, values) {
  const prefix = camelToSnakeCase(enumName) + "_";
  for (const value of values) {
    if (!value.name.toLowerCase().startsWith(prefix)) {
      return void 0;
    }
    const shortName = value.name.substring(prefix.length);
    if (shortName.length == 0) {
      return void 0;
    }
    if (/^\d/.test(shortName)) {
      return void 0;
    }
  }
  return prefix;
}
function camelToSnakeCase(camel) {
  return (camel.substring(0, 1) + camel.substring(1).replace(/[A-Z]/g, (c) => "_" + c)).toLowerCase();
}
function makeTypeName(proto, parent, file) {
  let typeName;
  if (parent) {
    typeName = `${parent.typeName}.${proto.name}`;
  } else if (file.proto.package.length > 0) {
    typeName = `${file.proto.package}.${proto.name}`;
  } else {
    typeName = `${proto.name}`;
  }
  return typeName;
}
function trimLeadingDot(typeName) {
  return typeName.startsWith(".") ? typeName.substring(1) : typeName;
}
function findOneof(proto, allOneofs) {
  if (!unsafeIsSetExplicit(proto, "oneofIndex")) {
    return void 0;
  }
  if (proto.proto3Optional) {
    return void 0;
  }
  const oneof = allOneofs[proto.oneofIndex];
  assert(oneof, `invalid FieldDescriptorProto: oneof #${proto.oneofIndex} for field #${proto.number} not found`);
  return oneof;
}
function getFieldPresence(proto, oneof, isExtension, parent) {
  if (proto.label == LABEL_REQUIRED) {
    return LEGACY_REQUIRED;
  }
  if (proto.label == LABEL_REPEATED) {
    return IMPLICIT2;
  }
  if (!!oneof || proto.proto3Optional) {
    return EXPLICIT;
  }
  if (isExtension) {
    return EXPLICIT;
  }
  const resolved = resolveFeature("fieldPresence", { proto, parent });
  if (resolved == IMPLICIT2 && (proto.type == TYPE_MESSAGE || proto.type == TYPE_GROUP)) {
    return EXPLICIT;
  }
  return resolved;
}
function isPackedField(proto, parent) {
  if (proto.label != LABEL_REPEATED) {
    return false;
  }
  switch (proto.type) {
    case TYPE_STRING:
    case TYPE_BYTES:
    case TYPE_GROUP:
    case TYPE_MESSAGE:
      return false;
  }
  const o = proto.options;
  if (o && unsafeIsSetExplicit(o, "packed")) {
    return o.packed;
  }
  return PACKED == resolveFeature("repeatedFieldEncoding", {
    proto,
    parent
  });
}
function findMapEntryFields(mapEntry) {
  const key2 = mapEntry.fields.find((f) => f.number === 1);
  const value = mapEntry.fields.find((f) => f.number === 2);
  assert(key2 && key2.fieldKind == "scalar" && key2.scalar != ScalarType.BYTES && key2.scalar != ScalarType.FLOAT && key2.scalar != ScalarType.DOUBLE && value && value.fieldKind != "list" && value.fieldKind != "map");
  return { key: key2, value };
}
function isEnumOpen(desc) {
  var _a;
  return OPEN == resolveFeature("enumType", {
    proto: desc.proto,
    parent: (_a = desc.parent) !== null && _a !== void 0 ? _a : desc.file
  });
}
function isDelimitedEncoding(proto, parent) {
  if (proto.type == TYPE_GROUP) {
    return true;
  }
  return DELIMITED == resolveFeature("messageEncoding", {
    proto,
    parent
  });
}
function isUtf8Validated(proto, parent) {
  return VERIFY == resolveFeature("utf8Validation", {
    proto,
    parent
  });
}
function resolveFeature(name, ref) {
  var _a, _b;
  const featureSet = (_a = ref.proto.options) === null || _a === void 0 ? void 0 : _a.features;
  if (featureSet) {
    const val = featureSet[name];
    if (val != 0) {
      return val;
    }
  }
  if ("kind" in ref) {
    if (ref.kind == "message") {
      return resolveFeature(name, (_b = ref.parent) !== null && _b !== void 0 ? _b : ref.file);
    }
    const editionDefaults = featureDefaults[ref.edition];
    if (!editionDefaults) {
      throw new Error(`feature default for edition ${ref.edition} not found`);
    }
    return editionDefaults[name];
  }
  return resolveFeature(name, ref.parent);
}
function assert(condition, msg) {
  if (!condition) {
    throw new Error(msg);
  }
}

// node_modules/@bufbuild/protobuf/dist/esm/codegenv2/boot.js
function boot(boot2) {
  const root = bootFileDescriptorProto(boot2);
  root.messageType.forEach(restoreJsonNames);
  const reg = createFileRegistry(root, () => void 0);
  return reg.getFile(root.name);
}
function bootFileDescriptorProto(init) {
  const proto = /* @__PURE__ */ Object.create({
    syntax: "",
    edition: 0
  });
  return Object.assign(proto, Object.assign(Object.assign({ $typeName: "google.protobuf.FileDescriptorProto", dependency: [], publicDependency: [], weakDependency: [], optionDependency: [], service: [], extension: [] }, init), { messageType: init.messageType.map(bootDescriptorProto), enumType: init.enumType.map(bootEnumDescriptorProto) }));
}
function bootDescriptorProto(init) {
  var _a, _b, _c, _d, _e, _f, _g, _h;
  const proto = /* @__PURE__ */ Object.create({
    visibility: 0
  });
  return Object.assign(proto, {
    $typeName: "google.protobuf.DescriptorProto",
    name: init.name,
    field: (_b = (_a = init.field) === null || _a === void 0 ? void 0 : _a.map(bootFieldDescriptorProto)) !== null && _b !== void 0 ? _b : [],
    extension: [],
    nestedType: (_d = (_c = init.nestedType) === null || _c === void 0 ? void 0 : _c.map(bootDescriptorProto)) !== null && _d !== void 0 ? _d : [],
    enumType: (_f = (_e = init.enumType) === null || _e === void 0 ? void 0 : _e.map(bootEnumDescriptorProto)) !== null && _f !== void 0 ? _f : [],
    extensionRange: (_h = (_g = init.extensionRange) === null || _g === void 0 ? void 0 : _g.map((e) => Object.assign({ $typeName: "google.protobuf.DescriptorProto.ExtensionRange" }, e))) !== null && _h !== void 0 ? _h : [],
    oneofDecl: [],
    reservedRange: [],
    reservedName: []
  });
}
function bootFieldDescriptorProto(init) {
  const proto = /* @__PURE__ */ Object.create({
    label: 1,
    typeName: "",
    extendee: "",
    defaultValue: "",
    oneofIndex: 0,
    jsonName: "",
    proto3Optional: false
  });
  return Object.assign(proto, Object.assign(Object.assign({ $typeName: "google.protobuf.FieldDescriptorProto" }, init), { options: init.options ? bootFieldOptions(init.options) : void 0 }));
}
function bootFieldOptions(init) {
  var _a, _b, _c;
  const proto = /* @__PURE__ */ Object.create({
    ctype: 0,
    packed: false,
    jstype: 0,
    lazy: false,
    unverifiedLazy: false,
    deprecated: false,
    weak: false,
    debugRedact: false,
    retention: 0
  });
  return Object.assign(proto, Object.assign(Object.assign({ $typeName: "google.protobuf.FieldOptions" }, init), { targets: (_a = init.targets) !== null && _a !== void 0 ? _a : [], editionDefaults: (_c = (_b = init.editionDefaults) === null || _b === void 0 ? void 0 : _b.map((e) => Object.assign({ $typeName: "google.protobuf.FieldOptions.EditionDefault" }, e))) !== null && _c !== void 0 ? _c : [], uninterpretedOption: [] }));
}
function bootEnumDescriptorProto(init) {
  const proto = /* @__PURE__ */ Object.create({
    visibility: 0
  });
  return Object.assign(proto, {
    $typeName: "google.protobuf.EnumDescriptorProto",
    name: init.name,
    reservedName: [],
    reservedRange: [],
    value: init.value.map((e) => Object.assign({ $typeName: "google.protobuf.EnumValueDescriptorProto" }, e))
  });
}

// node_modules/@bufbuild/protobuf/dist/esm/codegenv2/message.js
function messageDesc(file, path, ...paths) {
  return paths.reduce((acc, cur) => acc.nestedMessages[cur], file.messages[path]);
}

// node_modules/@bufbuild/protobuf/dist/esm/wkt/gen/google/protobuf/descriptor_pb.js
var file_google_protobuf_descriptor = /* @__PURE__ */ boot({ "name": "google/protobuf/descriptor.proto", "package": "google.protobuf", "messageType": [{ "name": "FileDescriptorSet", "field": [{ "name": "file", "number": 1, "type": 11, "label": 3, "typeName": ".google.protobuf.FileDescriptorProto" }], "extensionRange": [{ "start": 536e6, "end": 536000001 }] }, { "name": "FileDescriptorProto", "field": [{ "name": "name", "number": 1, "type": 9, "label": 1 }, { "name": "package", "number": 2, "type": 9, "label": 1 }, { "name": "dependency", "number": 3, "type": 9, "label": 3 }, { "name": "public_dependency", "number": 10, "type": 5, "label": 3 }, { "name": "weak_dependency", "number": 11, "type": 5, "label": 3 }, { "name": "option_dependency", "number": 15, "type": 9, "label": 3 }, { "name": "message_type", "number": 4, "type": 11, "label": 3, "typeName": ".google.protobuf.DescriptorProto" }, { "name": "enum_type", "number": 5, "type": 11, "label": 3, "typeName": ".google.protobuf.EnumDescriptorProto" }, { "name": "service", "number": 6, "type": 11, "label": 3, "typeName": ".google.protobuf.ServiceDescriptorProto" }, { "name": "extension", "number": 7, "type": 11, "label": 3, "typeName": ".google.protobuf.FieldDescriptorProto" }, { "name": "options", "number": 8, "type": 11, "label": 1, "typeName": ".google.protobuf.FileOptions" }, { "name": "source_code_info", "number": 9, "type": 11, "label": 1, "typeName": ".google.protobuf.SourceCodeInfo" }, { "name": "syntax", "number": 12, "type": 9, "label": 1 }, { "name": "edition", "number": 14, "type": 14, "label": 1, "typeName": ".google.protobuf.Edition" }] }, { "name": "DescriptorProto", "field": [{ "name": "name", "number": 1, "type": 9, "label": 1 }, { "name": "field", "number": 2, "type": 11, "label": 3, "typeName": ".google.protobuf.FieldDescriptorProto" }, { "name": "extension", "number": 6, "type": 11, "label": 3, "typeName": ".google.protobuf.FieldDescriptorProto" }, { "name": "nested_type", "number": 3, "type": 11, "label": 3, "typeName": ".google.protobuf.DescriptorProto" }, { "name": "enum_type", "number": 4, "type": 11, "label": 3, "typeName": ".google.protobuf.EnumDescriptorProto" }, { "name": "extension_range", "number": 5, "type": 11, "label": 3, "typeName": ".google.protobuf.DescriptorProto.ExtensionRange" }, { "name": "oneof_decl", "number": 8, "type": 11, "label": 3, "typeName": ".google.protobuf.OneofDescriptorProto" }, { "name": "options", "number": 7, "type": 11, "label": 1, "typeName": ".google.protobuf.MessageOptions" }, { "name": "reserved_range", "number": 9, "type": 11, "label": 3, "typeName": ".google.protobuf.DescriptorProto.ReservedRange" }, { "name": "reserved_name", "number": 10, "type": 9, "label": 3 }, { "name": "visibility", "number": 11, "type": 14, "label": 1, "typeName": ".google.protobuf.SymbolVisibility" }], "nestedType": [{ "name": "ExtensionRange", "field": [{ "name": "start", "number": 1, "type": 5, "label": 1 }, { "name": "end", "number": 2, "type": 5, "label": 1 }, { "name": "options", "number": 3, "type": 11, "label": 1, "typeName": ".google.protobuf.ExtensionRangeOptions" }] }, { "name": "ReservedRange", "field": [{ "name": "start", "number": 1, "type": 5, "label": 1 }, { "name": "end", "number": 2, "type": 5, "label": 1 }] }] }, { "name": "ExtensionRangeOptions", "field": [{ "name": "uninterpreted_option", "number": 999, "type": 11, "label": 3, "typeName": ".google.protobuf.UninterpretedOption" }, { "name": "declaration", "number": 2, "type": 11, "label": 3, "typeName": ".google.protobuf.ExtensionRangeOptions.Declaration", "options": { "retention": 2 } }, { "name": "features", "number": 50, "type": 11, "label": 1, "typeName": ".google.protobuf.FeatureSet" }, { "name": "verification", "number": 3, "type": 14, "label": 1, "typeName": ".google.protobuf.ExtensionRangeOptions.VerificationState", "defaultValue": "UNVERIFIED", "options": { "retention": 2 } }], "nestedType": [{ "name": "Declaration", "field": [{ "name": "number", "number": 1, "type": 5, "label": 1 }, { "name": "full_name", "number": 2, "type": 9, "label": 1 }, { "name": "type", "number": 3, "type": 9, "label": 1 }, { "name": "reserved", "number": 5, "type": 8, "label": 1 }, { "name": "repeated", "number": 6, "type": 8, "label": 1 }] }], "enumType": [{ "name": "VerificationState", "value": [{ "name": "DECLARATION", "number": 0 }, { "name": "UNVERIFIED", "number": 1 }] }], "extensionRange": [{ "start": 1e3, "end": 536870912 }] }, { "name": "FieldDescriptorProto", "field": [{ "name": "name", "number": 1, "type": 9, "label": 1 }, { "name": "number", "number": 3, "type": 5, "label": 1 }, { "name": "label", "number": 4, "type": 14, "label": 1, "typeName": ".google.protobuf.FieldDescriptorProto.Label" }, { "name": "type", "number": 5, "type": 14, "label": 1, "typeName": ".google.protobuf.FieldDescriptorProto.Type" }, { "name": "type_name", "number": 6, "type": 9, "label": 1 }, { "name": "extendee", "number": 2, "type": 9, "label": 1 }, { "name": "default_value", "number": 7, "type": 9, "label": 1 }, { "name": "oneof_index", "number": 9, "type": 5, "label": 1 }, { "name": "json_name", "number": 10, "type": 9, "label": 1 }, { "name": "options", "number": 8, "type": 11, "label": 1, "typeName": ".google.protobuf.FieldOptions" }, { "name": "proto3_optional", "number": 17, "type": 8, "label": 1 }], "enumType": [{ "name": "Type", "value": [{ "name": "TYPE_DOUBLE", "number": 1 }, { "name": "TYPE_FLOAT", "number": 2 }, { "name": "TYPE_INT64", "number": 3 }, { "name": "TYPE_UINT64", "number": 4 }, { "name": "TYPE_INT32", "number": 5 }, { "name": "TYPE_FIXED64", "number": 6 }, { "name": "TYPE_FIXED32", "number": 7 }, { "name": "TYPE_BOOL", "number": 8 }, { "name": "TYPE_STRING", "number": 9 }, { "name": "TYPE_GROUP", "number": 10 }, { "name": "TYPE_MESSAGE", "number": 11 }, { "name": "TYPE_BYTES", "number": 12 }, { "name": "TYPE_UINT32", "number": 13 }, { "name": "TYPE_ENUM", "number": 14 }, { "name": "TYPE_SFIXED32", "number": 15 }, { "name": "TYPE_SFIXED64", "number": 16 }, { "name": "TYPE_SINT32", "number": 17 }, { "name": "TYPE_SINT64", "number": 18 }] }, { "name": "Label", "value": [{ "name": "LABEL_OPTIONAL", "number": 1 }, { "name": "LABEL_REPEATED", "number": 3 }, { "name": "LABEL_REQUIRED", "number": 2 }] }] }, { "name": "OneofDescriptorProto", "field": [{ "name": "name", "number": 1, "type": 9, "label": 1 }, { "name": "options", "number": 2, "type": 11, "label": 1, "typeName": ".google.protobuf.OneofOptions" }] }, { "name": "EnumDescriptorProto", "field": [{ "name": "name", "number": 1, "type": 9, "label": 1 }, { "name": "value", "number": 2, "type": 11, "label": 3, "typeName": ".google.protobuf.EnumValueDescriptorProto" }, { "name": "options", "number": 3, "type": 11, "label": 1, "typeName": ".google.protobuf.EnumOptions" }, { "name": "reserved_range", "number": 4, "type": 11, "label": 3, "typeName": ".google.protobuf.EnumDescriptorProto.EnumReservedRange" }, { "name": "reserved_name", "number": 5, "type": 9, "label": 3 }, { "name": "visibility", "number": 6, "type": 14, "label": 1, "typeName": ".google.protobuf.SymbolVisibility" }], "nestedType": [{ "name": "EnumReservedRange", "field": [{ "name": "start", "number": 1, "type": 5, "label": 1 }, { "name": "end", "number": 2, "type": 5, "label": 1 }] }] }, { "name": "EnumValueDescriptorProto", "field": [{ "name": "name", "number": 1, "type": 9, "label": 1 }, { "name": "number", "number": 2, "type": 5, "label": 1 }, { "name": "options", "number": 3, "type": 11, "label": 1, "typeName": ".google.protobuf.EnumValueOptions" }] }, { "name": "ServiceDescriptorProto", "field": [{ "name": "name", "number": 1, "type": 9, "label": 1 }, { "name": "method", "number": 2, "type": 11, "label": 3, "typeName": ".google.protobuf.MethodDescriptorProto" }, { "name": "options", "number": 3, "type": 11, "label": 1, "typeName": ".google.protobuf.ServiceOptions" }] }, { "name": "MethodDescriptorProto", "field": [{ "name": "name", "number": 1, "type": 9, "label": 1 }, { "name": "input_type", "number": 2, "type": 9, "label": 1 }, { "name": "output_type", "number": 3, "type": 9, "label": 1 }, { "name": "options", "number": 4, "type": 11, "label": 1, "typeName": ".google.protobuf.MethodOptions" }, { "name": "client_streaming", "number": 5, "type": 8, "label": 1, "defaultValue": "false" }, { "name": "server_streaming", "number": 6, "type": 8, "label": 1, "defaultValue": "false" }] }, { "name": "FileOptions", "field": [{ "name": "java_package", "number": 1, "type": 9, "label": 1 }, { "name": "java_outer_classname", "number": 8, "type": 9, "label": 1 }, { "name": "java_multiple_files", "number": 10, "type": 8, "label": 1, "defaultValue": "false", "options": {} }, { "name": "java_generate_equals_and_hash", "number": 20, "type": 8, "label": 1, "options": { "deprecated": true } }, { "name": "java_string_check_utf8", "number": 27, "type": 8, "label": 1, "defaultValue": "false" }, { "name": "optimize_for", "number": 9, "type": 14, "label": 1, "typeName": ".google.protobuf.FileOptions.OptimizeMode", "defaultValue": "SPEED" }, { "name": "go_package", "number": 11, "type": 9, "label": 1 }, { "name": "cc_generic_services", "number": 16, "type": 8, "label": 1, "defaultValue": "false" }, { "name": "java_generic_services", "number": 17, "type": 8, "label": 1, "defaultValue": "false" }, { "name": "py_generic_services", "number": 18, "type": 8, "label": 1, "defaultValue": "false" }, { "name": "deprecated", "number": 23, "type": 8, "label": 1, "defaultValue": "false" }, { "name": "cc_enable_arenas", "number": 31, "type": 8, "label": 1, "defaultValue": "true" }, { "name": "objc_class_prefix", "number": 36, "type": 9, "label": 1 }, { "name": "csharp_namespace", "number": 37, "type": 9, "label": 1 }, { "name": "swift_prefix", "number": 39, "type": 9, "label": 1 }, { "name": "php_class_prefix", "number": 40, "type": 9, "label": 1 }, { "name": "php_namespace", "number": 41, "type": 9, "label": 1 }, { "name": "php_metadata_namespace", "number": 44, "type": 9, "label": 1 }, { "name": "ruby_package", "number": 45, "type": 9, "label": 1 }, { "name": "features", "number": 50, "type": 11, "label": 1, "typeName": ".google.protobuf.FeatureSet" }, { "name": "uninterpreted_option", "number": 999, "type": 11, "label": 3, "typeName": ".google.protobuf.UninterpretedOption" }], "enumType": [{ "name": "OptimizeMode", "value": [{ "name": "SPEED", "number": 1 }, { "name": "CODE_SIZE", "number": 2 }, { "name": "LITE_RUNTIME", "number": 3 }] }], "extensionRange": [{ "start": 1e3, "end": 536870912 }] }, { "name": "MessageOptions", "field": [{ "name": "message_set_wire_format", "number": 1, "type": 8, "label": 1, "defaultValue": "false" }, { "name": "no_standard_descriptor_accessor", "number": 2, "type": 8, "label": 1, "defaultValue": "false" }, { "name": "deprecated", "number": 3, "type": 8, "label": 1, "defaultValue": "false" }, { "name": "map_entry", "number": 7, "type": 8, "label": 1 }, { "name": "deprecated_legacy_json_field_conflicts", "number": 11, "type": 8, "label": 1, "options": { "deprecated": true } }, { "name": "features", "number": 12, "type": 11, "label": 1, "typeName": ".google.protobuf.FeatureSet" }, { "name": "uninterpreted_option", "number": 999, "type": 11, "label": 3, "typeName": ".google.protobuf.UninterpretedOption" }], "extensionRange": [{ "start": 1e3, "end": 536870912 }] }, { "name": "FieldOptions", "field": [{ "name": "ctype", "number": 1, "type": 14, "label": 1, "typeName": ".google.protobuf.FieldOptions.CType", "defaultValue": "STRING" }, { "name": "packed", "number": 2, "type": 8, "label": 1 }, { "name": "jstype", "number": 6, "type": 14, "label": 1, "typeName": ".google.protobuf.FieldOptions.JSType", "defaultValue": "JS_NORMAL" }, { "name": "lazy", "number": 5, "type": 8, "label": 1, "defaultValue": "false" }, { "name": "unverified_lazy", "number": 15, "type": 8, "label": 1, "defaultValue": "false" }, { "name": "deprecated", "number": 3, "type": 8, "label": 1, "defaultValue": "false" }, { "name": "weak", "number": 10, "type": 8, "label": 1, "defaultValue": "false", "options": { "deprecated": true } }, { "name": "debug_redact", "number": 16, "type": 8, "label": 1, "defaultValue": "false" }, { "name": "retention", "number": 17, "type": 14, "label": 1, "typeName": ".google.protobuf.FieldOptions.OptionRetention" }, { "name": "targets", "number": 19, "type": 14, "label": 3, "typeName": ".google.protobuf.FieldOptions.OptionTargetType" }, { "name": "edition_defaults", "number": 20, "type": 11, "label": 3, "typeName": ".google.protobuf.FieldOptions.EditionDefault" }, { "name": "features", "number": 21, "type": 11, "label": 1, "typeName": ".google.protobuf.FeatureSet" }, { "name": "feature_support", "number": 22, "type": 11, "label": 1, "typeName": ".google.protobuf.FieldOptions.FeatureSupport" }, { "name": "uninterpreted_option", "number": 999, "type": 11, "label": 3, "typeName": ".google.protobuf.UninterpretedOption" }], "nestedType": [{ "name": "EditionDefault", "field": [{ "name": "edition", "number": 3, "type": 14, "label": 1, "typeName": ".google.protobuf.Edition" }, { "name": "value", "number": 2, "type": 9, "label": 1 }] }, { "name": "FeatureSupport", "field": [{ "name": "edition_introduced", "number": 1, "type": 14, "label": 1, "typeName": ".google.protobuf.Edition" }, { "name": "edition_deprecated", "number": 2, "type": 14, "label": 1, "typeName": ".google.protobuf.Edition" }, { "name": "deprecation_warning", "number": 3, "type": 9, "label": 1 }, { "name": "edition_removed", "number": 4, "type": 14, "label": 1, "typeName": ".google.protobuf.Edition" }, { "name": "removal_error", "number": 5, "type": 9, "label": 1 }] }], "enumType": [{ "name": "CType", "value": [{ "name": "STRING", "number": 0 }, { "name": "CORD", "number": 1 }, { "name": "STRING_PIECE", "number": 2 }] }, { "name": "JSType", "value": [{ "name": "JS_NORMAL", "number": 0 }, { "name": "JS_STRING", "number": 1 }, { "name": "JS_NUMBER", "number": 2 }] }, { "name": "OptionRetention", "value": [{ "name": "RETENTION_UNKNOWN", "number": 0 }, { "name": "RETENTION_RUNTIME", "number": 1 }, { "name": "RETENTION_SOURCE", "number": 2 }] }, { "name": "OptionTargetType", "value": [{ "name": "TARGET_TYPE_UNKNOWN", "number": 0 }, { "name": "TARGET_TYPE_FILE", "number": 1 }, { "name": "TARGET_TYPE_EXTENSION_RANGE", "number": 2 }, { "name": "TARGET_TYPE_MESSAGE", "number": 3 }, { "name": "TARGET_TYPE_FIELD", "number": 4 }, { "name": "TARGET_TYPE_ONEOF", "number": 5 }, { "name": "TARGET_TYPE_ENUM", "number": 6 }, { "name": "TARGET_TYPE_ENUM_ENTRY", "number": 7 }, { "name": "TARGET_TYPE_SERVICE", "number": 8 }, { "name": "TARGET_TYPE_METHOD", "number": 9 }] }], "extensionRange": [{ "start": 1e3, "end": 536870912 }] }, { "name": "OneofOptions", "field": [{ "name": "features", "number": 1, "type": 11, "label": 1, "typeName": ".google.protobuf.FeatureSet" }, { "name": "uninterpreted_option", "number": 999, "type": 11, "label": 3, "typeName": ".google.protobuf.UninterpretedOption" }], "extensionRange": [{ "start": 1e3, "end": 536870912 }] }, { "name": "EnumOptions", "field": [{ "name": "allow_alias", "number": 2, "type": 8, "label": 1 }, { "name": "deprecated", "number": 3, "type": 8, "label": 1, "defaultValue": "false" }, { "name": "deprecated_legacy_json_field_conflicts", "number": 6, "type": 8, "label": 1, "options": { "deprecated": true } }, { "name": "features", "number": 7, "type": 11, "label": 1, "typeName": ".google.protobuf.FeatureSet" }, { "name": "uninterpreted_option", "number": 999, "type": 11, "label": 3, "typeName": ".google.protobuf.UninterpretedOption" }], "extensionRange": [{ "start": 1e3, "end": 536870912 }] }, { "name": "EnumValueOptions", "field": [{ "name": "deprecated", "number": 1, "type": 8, "label": 1, "defaultValue": "false" }, { "name": "features", "number": 2, "type": 11, "label": 1, "typeName": ".google.protobuf.FeatureSet" }, { "name": "debug_redact", "number": 3, "type": 8, "label": 1, "defaultValue": "false" }, { "name": "feature_support", "number": 4, "type": 11, "label": 1, "typeName": ".google.protobuf.FieldOptions.FeatureSupport" }, { "name": "uninterpreted_option", "number": 999, "type": 11, "label": 3, "typeName": ".google.protobuf.UninterpretedOption" }], "extensionRange": [{ "start": 1e3, "end": 536870912 }] }, { "name": "ServiceOptions", "field": [{ "name": "features", "number": 34, "type": 11, "label": 1, "typeName": ".google.protobuf.FeatureSet" }, { "name": "deprecated", "number": 33, "type": 8, "label": 1, "defaultValue": "false" }, { "name": "uninterpreted_option", "number": 999, "type": 11, "label": 3, "typeName": ".google.protobuf.UninterpretedOption" }], "extensionRange": [{ "start": 1e3, "end": 536870912 }] }, { "name": "MethodOptions", "field": [{ "name": "deprecated", "number": 33, "type": 8, "label": 1, "defaultValue": "false" }, { "name": "idempotency_level", "number": 34, "type": 14, "label": 1, "typeName": ".google.protobuf.MethodOptions.IdempotencyLevel", "defaultValue": "IDEMPOTENCY_UNKNOWN" }, { "name": "features", "number": 35, "type": 11, "label": 1, "typeName": ".google.protobuf.FeatureSet" }, { "name": "uninterpreted_option", "number": 999, "type": 11, "label": 3, "typeName": ".google.protobuf.UninterpretedOption" }], "enumType": [{ "name": "IdempotencyLevel", "value": [{ "name": "IDEMPOTENCY_UNKNOWN", "number": 0 }, { "name": "NO_SIDE_EFFECTS", "number": 1 }, { "name": "IDEMPOTENT", "number": 2 }] }], "extensionRange": [{ "start": 1e3, "end": 536870912 }] }, { "name": "UninterpretedOption", "field": [{ "name": "name", "number": 2, "type": 11, "label": 3, "typeName": ".google.protobuf.UninterpretedOption.NamePart" }, { "name": "identifier_value", "number": 3, "type": 9, "label": 1 }, { "name": "positive_int_value", "number": 4, "type": 4, "label": 1 }, { "name": "negative_int_value", "number": 5, "type": 3, "label": 1 }, { "name": "double_value", "number": 6, "type": 1, "label": 1 }, { "name": "string_value", "number": 7, "type": 12, "label": 1 }, { "name": "aggregate_value", "number": 8, "type": 9, "label": 1 }], "nestedType": [{ "name": "NamePart", "field": [{ "name": "name_part", "number": 1, "type": 9, "label": 2 }, { "name": "is_extension", "number": 2, "type": 8, "label": 2 }] }] }, { "name": "FeatureSet", "field": [{ "name": "field_presence", "number": 1, "type": 14, "label": 1, "typeName": ".google.protobuf.FeatureSet.FieldPresence", "options": { "retention": 1, "targets": [4, 1], "editionDefaults": [{ "value": "EXPLICIT", "edition": 900 }, { "value": "IMPLICIT", "edition": 999 }, { "value": "EXPLICIT", "edition": 1e3 }] } }, { "name": "enum_type", "number": 2, "type": 14, "label": 1, "typeName": ".google.protobuf.FeatureSet.EnumType", "options": { "retention": 1, "targets": [6, 1], "editionDefaults": [{ "value": "CLOSED", "edition": 900 }, { "value": "OPEN", "edition": 999 }] } }, { "name": "repeated_field_encoding", "number": 3, "type": 14, "label": 1, "typeName": ".google.protobuf.FeatureSet.RepeatedFieldEncoding", "options": { "retention": 1, "targets": [4, 1], "editionDefaults": [{ "value": "EXPANDED", "edition": 900 }, { "value": "PACKED", "edition": 999 }] } }, { "name": "utf8_validation", "number": 4, "type": 14, "label": 1, "typeName": ".google.protobuf.FeatureSet.Utf8Validation", "options": { "retention": 1, "targets": [4, 1], "editionDefaults": [{ "value": "NONE", "edition": 900 }, { "value": "VERIFY", "edition": 999 }] } }, { "name": "message_encoding", "number": 5, "type": 14, "label": 1, "typeName": ".google.protobuf.FeatureSet.MessageEncoding", "options": { "retention": 1, "targets": [4, 1], "editionDefaults": [{ "value": "LENGTH_PREFIXED", "edition": 900 }] } }, { "name": "json_format", "number": 6, "type": 14, "label": 1, "typeName": ".google.protobuf.FeatureSet.JsonFormat", "options": { "retention": 1, "targets": [3, 6, 1], "editionDefaults": [{ "value": "LEGACY_BEST_EFFORT", "edition": 900 }, { "value": "ALLOW", "edition": 999 }] } }, { "name": "enforce_naming_style", "number": 7, "type": 14, "label": 1, "typeName": ".google.protobuf.FeatureSet.EnforceNamingStyle", "options": { "retention": 2, "targets": [1, 2, 3, 4, 5, 6, 7, 8, 9], "editionDefaults": [{ "value": "STYLE_LEGACY", "edition": 900 }, { "value": "STYLE2024", "edition": 1001 }] } }, { "name": "default_symbol_visibility", "number": 8, "type": 14, "label": 1, "typeName": ".google.protobuf.FeatureSet.VisibilityFeature.DefaultSymbolVisibility", "options": { "retention": 2, "targets": [1], "editionDefaults": [{ "value": "EXPORT_ALL", "edition": 900 }, { "value": "EXPORT_TOP_LEVEL", "edition": 1001 }] } }], "nestedType": [{ "name": "VisibilityFeature", "enumType": [{ "name": "DefaultSymbolVisibility", "value": [{ "name": "DEFAULT_SYMBOL_VISIBILITY_UNKNOWN", "number": 0 }, { "name": "EXPORT_ALL", "number": 1 }, { "name": "EXPORT_TOP_LEVEL", "number": 2 }, { "name": "LOCAL_ALL", "number": 3 }, { "name": "STRICT", "number": 4 }] }] }], "enumType": [{ "name": "FieldPresence", "value": [{ "name": "FIELD_PRESENCE_UNKNOWN", "number": 0 }, { "name": "EXPLICIT", "number": 1 }, { "name": "IMPLICIT", "number": 2 }, { "name": "LEGACY_REQUIRED", "number": 3 }] }, { "name": "EnumType", "value": [{ "name": "ENUM_TYPE_UNKNOWN", "number": 0 }, { "name": "OPEN", "number": 1 }, { "name": "CLOSED", "number": 2 }] }, { "name": "RepeatedFieldEncoding", "value": [{ "name": "REPEATED_FIELD_ENCODING_UNKNOWN", "number": 0 }, { "name": "PACKED", "number": 1 }, { "name": "EXPANDED", "number": 2 }] }, { "name": "Utf8Validation", "value": [{ "name": "UTF8_VALIDATION_UNKNOWN", "number": 0 }, { "name": "VERIFY", "number": 2 }, { "name": "NONE", "number": 3 }] }, { "name": "MessageEncoding", "value": [{ "name": "MESSAGE_ENCODING_UNKNOWN", "number": 0 }, { "name": "LENGTH_PREFIXED", "number": 1 }, { "name": "DELIMITED", "number": 2 }] }, { "name": "JsonFormat", "value": [{ "name": "JSON_FORMAT_UNKNOWN", "number": 0 }, { "name": "ALLOW", "number": 1 }, { "name": "LEGACY_BEST_EFFORT", "number": 2 }] }, { "name": "EnforceNamingStyle", "value": [{ "name": "ENFORCE_NAMING_STYLE_UNKNOWN", "number": 0 }, { "name": "STYLE2024", "number": 1 }, { "name": "STYLE_LEGACY", "number": 2 }] }], "extensionRange": [{ "start": 1e3, "end": 9995 }, { "start": 9995, "end": 1e4 }, { "start": 1e4, "end": 10001 }] }, { "name": "FeatureSetDefaults", "field": [{ "name": "defaults", "number": 1, "type": 11, "label": 3, "typeName": ".google.protobuf.FeatureSetDefaults.FeatureSetEditionDefault" }, { "name": "minimum_edition", "number": 4, "type": 14, "label": 1, "typeName": ".google.protobuf.Edition" }, { "name": "maximum_edition", "number": 5, "type": 14, "label": 1, "typeName": ".google.protobuf.Edition" }], "nestedType": [{ "name": "FeatureSetEditionDefault", "field": [{ "name": "edition", "number": 3, "type": 14, "label": 1, "typeName": ".google.protobuf.Edition" }, { "name": "overridable_features", "number": 4, "type": 11, "label": 1, "typeName": ".google.protobuf.FeatureSet" }, { "name": "fixed_features", "number": 5, "type": 11, "label": 1, "typeName": ".google.protobuf.FeatureSet" }] }] }, { "name": "SourceCodeInfo", "field": [{ "name": "location", "number": 1, "type": 11, "label": 3, "typeName": ".google.protobuf.SourceCodeInfo.Location" }], "nestedType": [{ "name": "Location", "field": [{ "name": "path", "number": 1, "type": 5, "label": 3, "options": { "packed": true } }, { "name": "span", "number": 2, "type": 5, "label": 3, "options": { "packed": true } }, { "name": "leading_comments", "number": 3, "type": 9, "label": 1 }, { "name": "trailing_comments", "number": 4, "type": 9, "label": 1 }, { "name": "leading_detached_comments", "number": 6, "type": 9, "label": 3 }] }], "extensionRange": [{ "start": 536e6, "end": 536000001 }] }, { "name": "GeneratedCodeInfo", "field": [{ "name": "annotation", "number": 1, "type": 11, "label": 3, "typeName": ".google.protobuf.GeneratedCodeInfo.Annotation" }], "nestedType": [{ "name": "Annotation", "field": [{ "name": "path", "number": 1, "type": 5, "label": 3, "options": { "packed": true } }, { "name": "source_file", "number": 2, "type": 9, "label": 1 }, { "name": "begin", "number": 3, "type": 5, "label": 1 }, { "name": "end", "number": 4, "type": 5, "label": 1 }, { "name": "semantic", "number": 5, "type": 14, "label": 1, "typeName": ".google.protobuf.GeneratedCodeInfo.Annotation.Semantic" }], "enumType": [{ "name": "Semantic", "value": [{ "name": "NONE", "number": 0 }, { "name": "SET", "number": 1 }, { "name": "ALIAS", "number": 2 }] }] }] }], "enumType": [{ "name": "Edition", "value": [{ "name": "EDITION_UNKNOWN", "number": 0 }, { "name": "EDITION_LEGACY", "number": 900 }, { "name": "EDITION_PROTO2", "number": 998 }, { "name": "EDITION_PROTO3", "number": 999 }, { "name": "EDITION_2023", "number": 1e3 }, { "name": "EDITION_2024", "number": 1001 }, { "name": "EDITION_UNSTABLE", "number": 9999 }, { "name": "EDITION_1_TEST_ONLY", "number": 1 }, { "name": "EDITION_2_TEST_ONLY", "number": 2 }, { "name": "EDITION_99997_TEST_ONLY", "number": 99997 }, { "name": "EDITION_99998_TEST_ONLY", "number": 99998 }, { "name": "EDITION_99999_TEST_ONLY", "number": 99999 }, { "name": "EDITION_MAX", "number": 2147483647 }] }, { "name": "SymbolVisibility", "value": [{ "name": "VISIBILITY_UNSET", "number": 0 }, { "name": "VISIBILITY_LOCAL", "number": 1 }, { "name": "VISIBILITY_EXPORT", "number": 2 }] }] });
var FileDescriptorProtoSchema = /* @__PURE__ */ messageDesc(file_google_protobuf_descriptor, 1);
var ExtensionRangeOptions_VerificationState;
(function(ExtensionRangeOptions_VerificationState2) {
  ExtensionRangeOptions_VerificationState2[ExtensionRangeOptions_VerificationState2["DECLARATION"] = 0] = "DECLARATION";
  ExtensionRangeOptions_VerificationState2[ExtensionRangeOptions_VerificationState2["UNVERIFIED"] = 1] = "UNVERIFIED";
})(ExtensionRangeOptions_VerificationState || (ExtensionRangeOptions_VerificationState = {}));
var FieldDescriptorProto_Type;
(function(FieldDescriptorProto_Type2) {
  FieldDescriptorProto_Type2[FieldDescriptorProto_Type2["DOUBLE"] = 1] = "DOUBLE";
  FieldDescriptorProto_Type2[FieldDescriptorProto_Type2["FLOAT"] = 2] = "FLOAT";
  FieldDescriptorProto_Type2[FieldDescriptorProto_Type2["INT64"] = 3] = "INT64";
  FieldDescriptorProto_Type2[FieldDescriptorProto_Type2["UINT64"] = 4] = "UINT64";
  FieldDescriptorProto_Type2[FieldDescriptorProto_Type2["INT32"] = 5] = "INT32";
  FieldDescriptorProto_Type2[FieldDescriptorProto_Type2["FIXED64"] = 6] = "FIXED64";
  FieldDescriptorProto_Type2[FieldDescriptorProto_Type2["FIXED32"] = 7] = "FIXED32";
  FieldDescriptorProto_Type2[FieldDescriptorProto_Type2["BOOL"] = 8] = "BOOL";
  FieldDescriptorProto_Type2[FieldDescriptorProto_Type2["STRING"] = 9] = "STRING";
  FieldDescriptorProto_Type2[FieldDescriptorProto_Type2["GROUP"] = 10] = "GROUP";
  FieldDescriptorProto_Type2[FieldDescriptorProto_Type2["MESSAGE"] = 11] = "MESSAGE";
  FieldDescriptorProto_Type2[FieldDescriptorProto_Type2["BYTES"] = 12] = "BYTES";
  FieldDescriptorProto_Type2[FieldDescriptorProto_Type2["UINT32"] = 13] = "UINT32";
  FieldDescriptorProto_Type2[FieldDescriptorProto_Type2["ENUM"] = 14] = "ENUM";
  FieldDescriptorProto_Type2[FieldDescriptorProto_Type2["SFIXED32"] = 15] = "SFIXED32";
  FieldDescriptorProto_Type2[FieldDescriptorProto_Type2["SFIXED64"] = 16] = "SFIXED64";
  FieldDescriptorProto_Type2[FieldDescriptorProto_Type2["SINT32"] = 17] = "SINT32";
  FieldDescriptorProto_Type2[FieldDescriptorProto_Type2["SINT64"] = 18] = "SINT64";
})(FieldDescriptorProto_Type || (FieldDescriptorProto_Type = {}));
var FieldDescriptorProto_Label;
(function(FieldDescriptorProto_Label2) {
  FieldDescriptorProto_Label2[FieldDescriptorProto_Label2["OPTIONAL"] = 1] = "OPTIONAL";
  FieldDescriptorProto_Label2[FieldDescriptorProto_Label2["REPEATED"] = 3] = "REPEATED";
  FieldDescriptorProto_Label2[FieldDescriptorProto_Label2["REQUIRED"] = 2] = "REQUIRED";
})(FieldDescriptorProto_Label || (FieldDescriptorProto_Label = {}));
var FileOptions_OptimizeMode;
(function(FileOptions_OptimizeMode2) {
  FileOptions_OptimizeMode2[FileOptions_OptimizeMode2["SPEED"] = 1] = "SPEED";
  FileOptions_OptimizeMode2[FileOptions_OptimizeMode2["CODE_SIZE"] = 2] = "CODE_SIZE";
  FileOptions_OptimizeMode2[FileOptions_OptimizeMode2["LITE_RUNTIME"] = 3] = "LITE_RUNTIME";
})(FileOptions_OptimizeMode || (FileOptions_OptimizeMode = {}));
var FieldOptions_CType;
(function(FieldOptions_CType2) {
  FieldOptions_CType2[FieldOptions_CType2["STRING"] = 0] = "STRING";
  FieldOptions_CType2[FieldOptions_CType2["CORD"] = 1] = "CORD";
  FieldOptions_CType2[FieldOptions_CType2["STRING_PIECE"] = 2] = "STRING_PIECE";
})(FieldOptions_CType || (FieldOptions_CType = {}));
var FieldOptions_JSType;
(function(FieldOptions_JSType2) {
  FieldOptions_JSType2[FieldOptions_JSType2["JS_NORMAL"] = 0] = "JS_NORMAL";
  FieldOptions_JSType2[FieldOptions_JSType2["JS_STRING"] = 1] = "JS_STRING";
  FieldOptions_JSType2[FieldOptions_JSType2["JS_NUMBER"] = 2] = "JS_NUMBER";
})(FieldOptions_JSType || (FieldOptions_JSType = {}));
var FieldOptions_OptionRetention;
(function(FieldOptions_OptionRetention2) {
  FieldOptions_OptionRetention2[FieldOptions_OptionRetention2["RETENTION_UNKNOWN"] = 0] = "RETENTION_UNKNOWN";
  FieldOptions_OptionRetention2[FieldOptions_OptionRetention2["RETENTION_RUNTIME"] = 1] = "RETENTION_RUNTIME";
  FieldOptions_OptionRetention2[FieldOptions_OptionRetention2["RETENTION_SOURCE"] = 2] = "RETENTION_SOURCE";
})(FieldOptions_OptionRetention || (FieldOptions_OptionRetention = {}));
var FieldOptions_OptionTargetType;
(function(FieldOptions_OptionTargetType2) {
  FieldOptions_OptionTargetType2[FieldOptions_OptionTargetType2["TARGET_TYPE_UNKNOWN"] = 0] = "TARGET_TYPE_UNKNOWN";
  FieldOptions_OptionTargetType2[FieldOptions_OptionTargetType2["TARGET_TYPE_FILE"] = 1] = "TARGET_TYPE_FILE";
  FieldOptions_OptionTargetType2[FieldOptions_OptionTargetType2["TARGET_TYPE_EXTENSION_RANGE"] = 2] = "TARGET_TYPE_EXTENSION_RANGE";
  FieldOptions_OptionTargetType2[FieldOptions_OptionTargetType2["TARGET_TYPE_MESSAGE"] = 3] = "TARGET_TYPE_MESSAGE";
  FieldOptions_OptionTargetType2[FieldOptions_OptionTargetType2["TARGET_TYPE_FIELD"] = 4] = "TARGET_TYPE_FIELD";
  FieldOptions_OptionTargetType2[FieldOptions_OptionTargetType2["TARGET_TYPE_ONEOF"] = 5] = "TARGET_TYPE_ONEOF";
  FieldOptions_OptionTargetType2[FieldOptions_OptionTargetType2["TARGET_TYPE_ENUM"] = 6] = "TARGET_TYPE_ENUM";
  FieldOptions_OptionTargetType2[FieldOptions_OptionTargetType2["TARGET_TYPE_ENUM_ENTRY"] = 7] = "TARGET_TYPE_ENUM_ENTRY";
  FieldOptions_OptionTargetType2[FieldOptions_OptionTargetType2["TARGET_TYPE_SERVICE"] = 8] = "TARGET_TYPE_SERVICE";
  FieldOptions_OptionTargetType2[FieldOptions_OptionTargetType2["TARGET_TYPE_METHOD"] = 9] = "TARGET_TYPE_METHOD";
})(FieldOptions_OptionTargetType || (FieldOptions_OptionTargetType = {}));
var MethodOptions_IdempotencyLevel;
(function(MethodOptions_IdempotencyLevel2) {
  MethodOptions_IdempotencyLevel2[MethodOptions_IdempotencyLevel2["IDEMPOTENCY_UNKNOWN"] = 0] = "IDEMPOTENCY_UNKNOWN";
  MethodOptions_IdempotencyLevel2[MethodOptions_IdempotencyLevel2["NO_SIDE_EFFECTS"] = 1] = "NO_SIDE_EFFECTS";
  MethodOptions_IdempotencyLevel2[MethodOptions_IdempotencyLevel2["IDEMPOTENT"] = 2] = "IDEMPOTENT";
})(MethodOptions_IdempotencyLevel || (MethodOptions_IdempotencyLevel = {}));
var FeatureSet_VisibilityFeature_DefaultSymbolVisibility;
(function(FeatureSet_VisibilityFeature_DefaultSymbolVisibility2) {
  FeatureSet_VisibilityFeature_DefaultSymbolVisibility2[FeatureSet_VisibilityFeature_DefaultSymbolVisibility2["DEFAULT_SYMBOL_VISIBILITY_UNKNOWN"] = 0] = "DEFAULT_SYMBOL_VISIBILITY_UNKNOWN";
  FeatureSet_VisibilityFeature_DefaultSymbolVisibility2[FeatureSet_VisibilityFeature_DefaultSymbolVisibility2["EXPORT_ALL"] = 1] = "EXPORT_ALL";
  FeatureSet_VisibilityFeature_DefaultSymbolVisibility2[FeatureSet_VisibilityFeature_DefaultSymbolVisibility2["EXPORT_TOP_LEVEL"] = 2] = "EXPORT_TOP_LEVEL";
  FeatureSet_VisibilityFeature_DefaultSymbolVisibility2[FeatureSet_VisibilityFeature_DefaultSymbolVisibility2["LOCAL_ALL"] = 3] = "LOCAL_ALL";
  FeatureSet_VisibilityFeature_DefaultSymbolVisibility2[FeatureSet_VisibilityFeature_DefaultSymbolVisibility2["STRICT"] = 4] = "STRICT";
})(FeatureSet_VisibilityFeature_DefaultSymbolVisibility || (FeatureSet_VisibilityFeature_DefaultSymbolVisibility = {}));
var FeatureSet_FieldPresence;
(function(FeatureSet_FieldPresence2) {
  FeatureSet_FieldPresence2[FeatureSet_FieldPresence2["FIELD_PRESENCE_UNKNOWN"] = 0] = "FIELD_PRESENCE_UNKNOWN";
  FeatureSet_FieldPresence2[FeatureSet_FieldPresence2["EXPLICIT"] = 1] = "EXPLICIT";
  FeatureSet_FieldPresence2[FeatureSet_FieldPresence2["IMPLICIT"] = 2] = "IMPLICIT";
  FeatureSet_FieldPresence2[FeatureSet_FieldPresence2["LEGACY_REQUIRED"] = 3] = "LEGACY_REQUIRED";
})(FeatureSet_FieldPresence || (FeatureSet_FieldPresence = {}));
var FeatureSet_EnumType;
(function(FeatureSet_EnumType2) {
  FeatureSet_EnumType2[FeatureSet_EnumType2["ENUM_TYPE_UNKNOWN"] = 0] = "ENUM_TYPE_UNKNOWN";
  FeatureSet_EnumType2[FeatureSet_EnumType2["OPEN"] = 1] = "OPEN";
  FeatureSet_EnumType2[FeatureSet_EnumType2["CLOSED"] = 2] = "CLOSED";
})(FeatureSet_EnumType || (FeatureSet_EnumType = {}));
var FeatureSet_RepeatedFieldEncoding;
(function(FeatureSet_RepeatedFieldEncoding2) {
  FeatureSet_RepeatedFieldEncoding2[FeatureSet_RepeatedFieldEncoding2["REPEATED_FIELD_ENCODING_UNKNOWN"] = 0] = "REPEATED_FIELD_ENCODING_UNKNOWN";
  FeatureSet_RepeatedFieldEncoding2[FeatureSet_RepeatedFieldEncoding2["PACKED"] = 1] = "PACKED";
  FeatureSet_RepeatedFieldEncoding2[FeatureSet_RepeatedFieldEncoding2["EXPANDED"] = 2] = "EXPANDED";
})(FeatureSet_RepeatedFieldEncoding || (FeatureSet_RepeatedFieldEncoding = {}));
var FeatureSet_Utf8Validation;
(function(FeatureSet_Utf8Validation2) {
  FeatureSet_Utf8Validation2[FeatureSet_Utf8Validation2["UTF8_VALIDATION_UNKNOWN"] = 0] = "UTF8_VALIDATION_UNKNOWN";
  FeatureSet_Utf8Validation2[FeatureSet_Utf8Validation2["VERIFY"] = 2] = "VERIFY";
  FeatureSet_Utf8Validation2[FeatureSet_Utf8Validation2["NONE"] = 3] = "NONE";
})(FeatureSet_Utf8Validation || (FeatureSet_Utf8Validation = {}));
var FeatureSet_MessageEncoding;
(function(FeatureSet_MessageEncoding2) {
  FeatureSet_MessageEncoding2[FeatureSet_MessageEncoding2["MESSAGE_ENCODING_UNKNOWN"] = 0] = "MESSAGE_ENCODING_UNKNOWN";
  FeatureSet_MessageEncoding2[FeatureSet_MessageEncoding2["LENGTH_PREFIXED"] = 1] = "LENGTH_PREFIXED";
  FeatureSet_MessageEncoding2[FeatureSet_MessageEncoding2["DELIMITED"] = 2] = "DELIMITED";
})(FeatureSet_MessageEncoding || (FeatureSet_MessageEncoding = {}));
var FeatureSet_JsonFormat;
(function(FeatureSet_JsonFormat2) {
  FeatureSet_JsonFormat2[FeatureSet_JsonFormat2["JSON_FORMAT_UNKNOWN"] = 0] = "JSON_FORMAT_UNKNOWN";
  FeatureSet_JsonFormat2[FeatureSet_JsonFormat2["ALLOW"] = 1] = "ALLOW";
  FeatureSet_JsonFormat2[FeatureSet_JsonFormat2["LEGACY_BEST_EFFORT"] = 2] = "LEGACY_BEST_EFFORT";
})(FeatureSet_JsonFormat || (FeatureSet_JsonFormat = {}));
var FeatureSet_EnforceNamingStyle;
(function(FeatureSet_EnforceNamingStyle2) {
  FeatureSet_EnforceNamingStyle2[FeatureSet_EnforceNamingStyle2["ENFORCE_NAMING_STYLE_UNKNOWN"] = 0] = "ENFORCE_NAMING_STYLE_UNKNOWN";
  FeatureSet_EnforceNamingStyle2[FeatureSet_EnforceNamingStyle2["STYLE2024"] = 1] = "STYLE2024";
  FeatureSet_EnforceNamingStyle2[FeatureSet_EnforceNamingStyle2["STYLE_LEGACY"] = 2] = "STYLE_LEGACY";
})(FeatureSet_EnforceNamingStyle || (FeatureSet_EnforceNamingStyle = {}));
var GeneratedCodeInfo_Annotation_Semantic;
(function(GeneratedCodeInfo_Annotation_Semantic2) {
  GeneratedCodeInfo_Annotation_Semantic2[GeneratedCodeInfo_Annotation_Semantic2["NONE"] = 0] = "NONE";
  GeneratedCodeInfo_Annotation_Semantic2[GeneratedCodeInfo_Annotation_Semantic2["SET"] = 1] = "SET";
  GeneratedCodeInfo_Annotation_Semantic2[GeneratedCodeInfo_Annotation_Semantic2["ALIAS"] = 2] = "ALIAS";
})(GeneratedCodeInfo_Annotation_Semantic || (GeneratedCodeInfo_Annotation_Semantic = {}));
var Edition;
(function(Edition2) {
  Edition2[Edition2["EDITION_UNKNOWN"] = 0] = "EDITION_UNKNOWN";
  Edition2[Edition2["EDITION_LEGACY"] = 900] = "EDITION_LEGACY";
  Edition2[Edition2["EDITION_PROTO2"] = 998] = "EDITION_PROTO2";
  Edition2[Edition2["EDITION_PROTO3"] = 999] = "EDITION_PROTO3";
  Edition2[Edition2["EDITION_2023"] = 1e3] = "EDITION_2023";
  Edition2[Edition2["EDITION_2024"] = 1001] = "EDITION_2024";
  Edition2[Edition2["EDITION_UNSTABLE"] = 9999] = "EDITION_UNSTABLE";
  Edition2[Edition2["EDITION_1_TEST_ONLY"] = 1] = "EDITION_1_TEST_ONLY";
  Edition2[Edition2["EDITION_2_TEST_ONLY"] = 2] = "EDITION_2_TEST_ONLY";
  Edition2[Edition2["EDITION_99997_TEST_ONLY"] = 99997] = "EDITION_99997_TEST_ONLY";
  Edition2[Edition2["EDITION_99998_TEST_ONLY"] = 99998] = "EDITION_99998_TEST_ONLY";
  Edition2[Edition2["EDITION_99999_TEST_ONLY"] = 99999] = "EDITION_99999_TEST_ONLY";
  Edition2[Edition2["EDITION_MAX"] = 2147483647] = "EDITION_MAX";
})(Edition || (Edition = {}));
var SymbolVisibility;
(function(SymbolVisibility2) {
  SymbolVisibility2[SymbolVisibility2["VISIBILITY_UNSET"] = 0] = "VISIBILITY_UNSET";
  SymbolVisibility2[SymbolVisibility2["VISIBILITY_LOCAL"] = 1] = "VISIBILITY_LOCAL";
  SymbolVisibility2[SymbolVisibility2["VISIBILITY_EXPORT"] = 2] = "VISIBILITY_EXPORT";
})(SymbolVisibility || (SymbolVisibility = {}));

// node_modules/@bufbuild/protobuf/dist/esm/from-binary.js
function makeReadContext(options) {
  return Object.assign(Object.assign({ readUnknownFields: true, recursionLimit: 100 }, options), { depth: 0 });
}
function fromBinary(schema, bytes, options) {
  const message = create(schema);
  compiledReader(schema).read(message, new BinaryReader(bytes), makeReadContext(options), bytes.byteLength);
  return message;
}
var compiledReaders = /* @__PURE__ */ new WeakMap();
function compiledReader(desc) {
  let compiled = compiledReaders.get(desc);
  if (compiled === void 0) {
    compiled = compileMessage(desc);
  }
  return compiled;
}
function compileMessage(desc) {
  const descString = String(desc);
  const fieldReaders = /* @__PURE__ */ new Map();
  const compiled = {
    read: compileMessageReader(descString, fieldReaders),
    readGroup: compileGroupReader(descString, fieldReaders)
  };
  compiledReaders.set(desc, compiled);
  for (const field of desc.fields) {
    fieldReaders.set(field.number, compileFieldReader(field));
  }
  return compiled;
}
function compileMessageReader(descString, fieldReaders) {
  return (message, reader, ctx, length) => {
    var _a;
    if (++ctx.depth > ctx.recursionLimit) {
      throw new Error(`cannot decode ${descString} from binary: maximum recursion depth of ${ctx.recursionLimit} reached`);
    }
    const end = reader.pos + length;
    const unknownFields = (_a = message.$unknown) !== null && _a !== void 0 ? _a : [];
    while (reader.pos < end) {
      const [fieldNo, wireType] = reader.tag();
      const fieldReader = fieldReaders.get(fieldNo);
      if (fieldReader === void 0) {
        const data = reader.skip(wireType, fieldNo, ctx.recursionLimit - ctx.depth);
        if (ctx.readUnknownFields) {
          unknownFields.push({ no: fieldNo, wireType, data });
        }
        continue;
      }
      fieldReader(message, reader, ctx, wireType);
    }
    if (unknownFields.length > 0) {
      message.$unknown = unknownFields;
    }
    ctx.depth--;
  };
}
function compileGroupReader(descString, fieldReaders) {
  return (message, reader, ctx, fieldNo) => {
    var _a;
    if (++ctx.depth > ctx.recursionLimit) {
      throw new Error(`cannot decode ${descString} from binary: maximum recursion depth of ${ctx.recursionLimit} reached`);
    }
    let recordFieldNo;
    let wireType;
    const unknownFields = (_a = message.$unknown) !== null && _a !== void 0 ? _a : [];
    while (reader.pos < reader.len) {
      [recordFieldNo, wireType] = reader.tag();
      if (wireType == WireType.EndGroup) {
        break;
      }
      const fieldReader = fieldReaders.get(recordFieldNo);
      if (fieldReader === void 0) {
        const data = reader.skip(wireType, recordFieldNo, ctx.recursionLimit - ctx.depth);
        if (ctx.readUnknownFields) {
          unknownFields.push({ no: recordFieldNo, wireType, data });
        }
        continue;
      }
      fieldReader(message, reader, ctx, wireType);
    }
    if (wireType != WireType.EndGroup || recordFieldNo !== fieldNo) {
      throw new Error("invalid end group tag");
    }
    if (unknownFields.length > 0) {
      message.$unknown = unknownFields;
    }
    ctx.depth--;
  };
}
function compileFieldReader(field) {
  switch (field.fieldKind) {
    case "scalar":
      return compileScalarFieldReader(field);
    case "enum":
      return compileEnumFieldReader(field);
    case "message":
      return compileMessageFieldReader(field);
    case "list":
      return compileListFieldReader(field);
    case "map":
      return compileMapFieldReader(field);
  }
}
function compileScalarFieldReader(field) {
  const readScalar = compileScalarReader(field.scalar, field.utf8Validation, field.longAsString);
  const localName = field.localName;
  if (field.oneof) {
    const oneofLocalName = field.oneof.localName;
    return (message, reader) => {
      message[oneofLocalName] = {
        case: localName,
        value: readScalar(reader)
      };
    };
  }
  return (message, reader) => {
    message[localName] = readScalar(reader);
  };
}
function compileEnumFieldReader(field) {
  var _a;
  const localName = field.localName;
  const oneofLocalName = (_a = field.oneof) === null || _a === void 0 ? void 0 : _a.localName;
  if (field.enum.open) {
    if (oneofLocalName !== void 0) {
      return (message, reader) => {
        message[oneofLocalName] = { case: localName, value: reader.int32() };
      };
    }
    return (message, reader) => {
      message[localName] = reader.int32();
    };
  }
  const values = field.enum.values;
  const fieldNo = field.number;
  return (message, reader, ctx, wireType) => {
    var _a2;
    const val = reader.int32();
    if (values.some((v) => v.number === val)) {
      if (oneofLocalName !== void 0) {
        message[oneofLocalName] = { case: localName, value: val };
      } else {
        message[localName] = val;
      }
    } else if (ctx.readUnknownFields) {
      const bytes = [];
      varint32write(val, bytes);
      const unknownFields = (_a2 = message.$unknown) !== null && _a2 !== void 0 ? _a2 : [];
      unknownFields.push({
        no: fieldNo,
        wireType,
        data: new Uint8Array(bytes)
      });
      message.$unknown = unknownFields;
    }
  };
}
function compileMessageFieldReader(field) {
  const localName = field.localName;
  const { toMessage, toLocal } = localMessageMapper(field);
  const readChild = compileChildReader(field);
  if (field.oneof) {
    const oneofLocalName = field.oneof.localName;
    return (message, reader, ctx) => {
      const oneof = message[oneofLocalName];
      const child = toMessage(oneof.case === localName ? oneof.value : void 0);
      readChild(child, reader, ctx);
      message[oneofLocalName] = { case: localName, value: toLocal(child) };
    };
  }
  return (message, reader, ctx) => {
    const child = toMessage(message[localName]);
    readChild(child, reader, ctx);
    message[localName] = toLocal(child);
  };
}
function compileChildReader(field) {
  const compiledChild = compiledReader(field.message);
  if (field.delimitedEncoding) {
    const fieldNo = field.number;
    return (child, reader, ctx) => compiledChild.readGroup(child, reader, ctx, fieldNo);
  }
  return (child, reader, ctx) => compiledChild.read(child, reader, ctx, reader.uint32());
}
function compileListFieldReader(field) {
  const localName = field.localName;
  if (field.listKind == "message") {
    const { toMessage, toLocal } = localMessageMapper(field);
    const readChild = compileChildReader(field);
    return (message, reader, ctx) => {
      const child = toMessage(void 0);
      readChild(child, reader, ctx);
      message[localName].push(toLocal(child));
    };
  }
  const scalarType = field.listKind == "enum" ? ScalarType.INT32 : field.scalar;
  const longAsString = field.listKind == "scalar" ? field.longAsString : false;
  const readScalar = compileScalarReader(scalarType, field.utf8Validation, longAsString);
  const packedPossible = scalarType != ScalarType.STRING && scalarType != ScalarType.BYTES;
  return (message, reader, ctx, wireType) => {
    const items = message[localName];
    if (wireType == WireType.LengthDelimited && packedPossible) {
      const end = reader.uint32() + reader.pos;
      while (reader.pos < end) {
        items.push(readScalar(reader));
      }
    } else {
      items.push(readScalar(reader));
    }
  };
}
function compileMapFieldReader(field) {
  const localName = field.localName;
  const readKey = compileScalarReader(field.mapKey, field.utf8Validation, false);
  const keyZero = scalarZeroValue(field.mapKey, false);
  let readValue;
  let valueDefault;
  switch (field.mapKind) {
    case "scalar": {
      const scalar = field.scalar;
      const readScalar = compileScalarReader(scalar, field.utf8Validation, false);
      readValue = (reader) => readScalar(reader);
      if (scalar == ScalarType.BYTES) {
        valueDefault = () => new Uint8Array(0);
      } else {
        const zero = scalarZeroValue(scalar, false);
        valueDefault = () => zero;
      }
      break;
    }
    case "enum": {
      const zero = field.enum.values[0].number;
      readValue = (reader) => reader.int32();
      valueDefault = () => zero;
      break;
    }
    case "message": {
      const { toMessage, toLocal } = localMessageMapper(field);
      const readChild = compiledReader(field.message).read;
      readValue = (reader, ctx) => {
        const child = toMessage(void 0);
        readChild(child, reader, ctx, reader.uint32());
        return toLocal(child);
      };
      valueDefault = () => toLocal(toMessage(void 0));
      break;
    }
  }
  return (message, reader, ctx) => {
    const record = message[localName];
    let key2;
    let val;
    const len = reader.uint32();
    const end = reader.pos + len;
    while (reader.pos < end) {
      const [fieldNo] = reader.tag();
      switch (fieldNo) {
        case 1:
          key2 = readKey(reader);
          break;
        case 2:
          val = readValue(reader, ctx);
          break;
      }
    }
    if (key2 === void 0) {
      key2 = keyZero;
    }
    if (val === void 0) {
      val = valueDefault();
    }
    record[key2] = val;
  };
}
function compileScalarReader(type, utf8Validation, longAsString) {
  switch (type) {
    case ScalarType.STRING:
      return (reader) => reader.string(utf8Validation);
    case ScalarType.BOOL:
      return (reader) => reader.bool();
    case ScalarType.DOUBLE:
      return (reader) => reader.double();
    case ScalarType.FLOAT:
      return (reader) => reader.float();
    case ScalarType.INT32:
      return (reader) => reader.int32();
    case ScalarType.INT64:
      if (longAsString) {
        return (reader) => String(reader.int64());
      }
      return (reader) => reader.int64();
    case ScalarType.UINT64:
      if (longAsString) {
        return (reader) => String(reader.uint64());
      }
      return (reader) => reader.uint64();
    case ScalarType.FIXED64:
      if (longAsString) {
        return (reader) => String(reader.fixed64());
      }
      return (reader) => reader.fixed64();
    case ScalarType.BYTES:
      return (reader) => reader.bytes();
    case ScalarType.FIXED32:
      return (reader) => reader.fixed32();
    case ScalarType.SFIXED32:
      return (reader) => reader.sfixed32();
    case ScalarType.SFIXED64:
      if (longAsString) {
        return (reader) => String(reader.sfixed64());
      }
      return (reader) => reader.sfixed64();
    case ScalarType.SINT64:
      if (longAsString) {
        return (reader) => String(reader.sint64());
      }
      return (reader) => reader.sint64();
    case ScalarType.UINT32:
      return (reader) => reader.uint32();
    case ScalarType.SINT32:
      return (reader) => reader.sint32();
  }
}

// node_modules/@bufbuild/protobuf/dist/esm/codegenv2/file.js
function fileDesc(b64, imports) {
  var _a;
  const root = fromBinary(FileDescriptorProtoSchema, base64Decode(b64));
  root.messageType.forEach(restoreJsonNames);
  root.dependency = (_a = imports === null || imports === void 0 ? void 0 : imports.map((f) => f.proto.name)) !== null && _a !== void 0 ? _a : [];
  const reg = createFileRegistry(root, (protoFileName) => imports === null || imports === void 0 ? void 0 : imports.find((f) => f.proto.name === protoFileName));
  return reg.getFile(root.name);
}

// node_modules/@bufbuild/protobuf/dist/esm/to-binary.js
var IMPLICIT3 = 2;
var LEGACY_REQUIRED2 = 3;
var writeDefaults = {
  writeUnknownFields: true
};
function makeWriteOptions(options) {
  return options ? Object.assign(Object.assign({}, writeDefaults), options) : writeDefaults;
}
function toBinary(schema, message, options) {
  const writer = new BinaryWriter();
  compiledWriter(schema)(writer, makeWriteOptions(options), message);
  return writer.finish();
}
var compiledWriters = /* @__PURE__ */ new WeakMap();
function compiledWriter(desc) {
  let compiled = compiledWriters.get(desc);
  if (compiled === void 0) {
    compiled = compileMessage2(desc);
  }
  return compiled;
}
function compileMessage2(desc) {
  const typeName = desc.typeName;
  const sortedFields = desc.fields.concat().sort((a, b) => a.number - b.number);
  const foreignField = sortedFields[0];
  const fieldWriters = [];
  const compiled = (writer, opts, message) => {
    if (message.$typeName !== typeName && foreignField !== void 0) {
      throw new FieldError(foreignField, `cannot use ${foreignField} with message ${message.$typeName}`, "ForeignFieldError");
    }
    for (let i = 0; i < fieldWriters.length; i++) {
      fieldWriters[i](writer, opts, message);
    }
    const unknown = message.$unknown;
    if (unknown !== void 0 && opts.writeUnknownFields) {
      for (let i = 0; i < unknown.length; i++) {
        const { no, wireType, data } = unknown[i];
        writer.tag(no, wireType).raw(data);
      }
    }
  };
  compiledWriters.set(desc, compiled);
  for (const field of sortedFields) {
    fieldWriters.push(compileField(field));
  }
  return compiled;
}
function compileField(field) {
  switch (field.fieldKind) {
    case "message":
    case "scalar":
    case "enum":
      return compileSingularField(field);
    case "list":
      return compileListField(field);
    case "map":
      return compileMapField(field);
  }
}
function compileSingularField(field) {
  const writeValue = compileSingularValue(field);
  const localName = field.localName;
  if (field.oneof) {
    const oneofLocalName = field.oneof.localName;
    return (writer, opts, message) => {
      const oneof = message[oneofLocalName];
      if (oneof.case === localName) {
        writeValue(writer, opts, oneof.value);
      }
    };
  }
  if (field.presence != IMPLICIT3) {
    const requiredError = field.presence == LEGACY_REQUIRED2 ? `cannot encode ${field} to binary: required field not set` : void 0;
    return (writer, opts, message) => {
      const value = message[localName];
      if (value !== void 0 && Object.prototype.hasOwnProperty.call(message, localName)) {
        writeValue(writer, opts, value);
      } else if (requiredError !== void 0) {
        throw new Error(requiredError);
      }
    };
  }
  if (field.fieldKind == "enum") {
    const zero = field.enum.values[0].number;
    return (writer, opts, message) => {
      const value = message[localName];
      if (value !== zero) {
        writeValue(writer, opts, value);
      }
    };
  }
  switch (field.scalar) {
    case ScalarType.BOOL:
      return (writer, opts, message) => {
        const value = message[localName];
        if (value !== false) {
          writeValue(writer, opts, value);
        }
      };
    case ScalarType.STRING:
      return (writer, opts, message) => {
        const value = message[localName];
        if (value !== "") {
          writeValue(writer, opts, value);
        }
      };
    case ScalarType.BYTES:
      return (writer, opts, message) => {
        const value = message[localName];
        if (!(value instanceof Uint8Array) || value.byteLength > 0) {
          writeValue(writer, opts, value);
        }
      };
    case ScalarType.DOUBLE:
    case ScalarType.FLOAT:
      return (writer, opts, message) => {
        const value = message[localName];
        if (!Object.is(value, 0)) {
          writeValue(writer, opts, value);
        }
      };
    default:
      return (writer, opts, message) => {
        const value = message[localName];
        if (value != 0) {
          writeValue(writer, opts, value);
        }
      };
  }
}
function compileSingularValue(field) {
  switch (field.fieldKind) {
    case "message": {
      const { toMessage } = localMessageMapper(field);
      const writeChild = compileChildWriter(field);
      return (writer, opts, value) => {
        writeChild(writer, opts, toMessage(value));
      };
    }
    case "scalar":
    case "enum": {
      const scalarType = field.fieldKind == "enum" ? ScalarType.INT32 : field.scalar;
      const fieldNo = field.number;
      const wireType = writeTypeOfScalar(scalarType);
      const writeScalar = compileScalarValue(scalarType, field.parent.typeName, field.name);
      return (writer, opts, value) => {
        writer.tag(fieldNo, wireType);
        writeScalar(writer, value);
      };
    }
  }
}
function compileListField(field) {
  const localName = field.localName;
  const fieldNo = field.number;
  switch (field.listKind) {
    case "message": {
      const { toMessage } = localMessageMapper(field);
      const writeChild = compileChildWriter(field);
      return (writer, opts, message) => {
        const items = message[localName];
        for (let i = 0; i < items.length; i++) {
          writeChild(writer, opts, toMessage(items[i]));
        }
      };
    }
    case "scalar":
    case "enum": {
      const scalarType = field.listKind == "enum" ? ScalarType.INT32 : field.scalar;
      const writeScalar = compileScalarValue(scalarType, field.parent.typeName, field.name);
      if (field.packed) {
        return (writer, opts, message) => {
          const items = message[localName];
          if (items.length == 0) {
            return;
          }
          writer.tag(fieldNo, WireType.LengthDelimited).fork();
          for (let i = 0; i < items.length; i++) {
            writeScalar(writer, items[i]);
          }
          writer.join();
        };
      }
      const wireType = writeTypeOfScalar(scalarType);
      return (writer, opts, message) => {
        const items = message[localName];
        for (let i = 0; i < items.length; i++) {
          writer.tag(fieldNo, wireType);
          writeScalar(writer, items[i]);
        }
      };
    }
  }
}
function compileMapField(field) {
  const localName = field.localName;
  const fieldNo = field.number;
  const writeKey = compileMapKey(field);
  if (field.mapKind == "message") {
    const { toMessage } = localMessageMapper(field);
    const writeMessage = compiledWriter(field.message);
    return (writer, opts, message) => {
      const record = message[localName];
      const keys = Object.keys(record);
      for (let i = 0; i < keys.length; i++) {
        const key2 = keys[i];
        writer.tag(fieldNo, WireType.LengthDelimited).fork();
        writeKey(writer, key2);
        writer.tag(2, WireType.LengthDelimited).fork();
        writeMessage(writer, opts, toMessage(record[key2]));
        writer.join();
        writer.join();
      }
    };
  }
  const scalarType = field.mapKind == "enum" ? ScalarType.INT32 : field.scalar;
  const valueWireType = writeTypeOfScalar(scalarType);
  const writeScalar = compileScalarValue(scalarType, field.parent.typeName, field.name);
  return (writer, opts, message) => {
    const record = message[localName];
    const keys = Object.keys(record);
    for (let i = 0; i < keys.length; i++) {
      const key2 = keys[i];
      writer.tag(fieldNo, WireType.LengthDelimited).fork();
      writeKey(writer, key2);
      writer.tag(2, valueWireType);
      writeScalar(writer, record[key2]);
      writer.join();
    }
  };
}
function compileMapKey(field) {
  const wireType = writeTypeOfScalar(field.mapKey);
  const writeScalar = compileScalarValue(field.mapKey, field.parent.typeName, field.name);
  const convertKey = compileMapKeyConverter(field.mapKey);
  return (writer, key2) => {
    writer.tag(1, wireType);
    writeScalar(writer, convertKey(key2));
  };
}
function compileMapKeyConverter(type) {
  switch (type) {
    case ScalarType.STRING:
      return (key2) => key2;
    case ScalarType.BOOL:
      return (key2) => key2 === "true" ? true : key2 === "false" ? false : key2;
    case ScalarType.UINT64:
    case ScalarType.FIXED64:
      return (key2) => {
        try {
          return protoInt64.uParse(key2);
        } catch (_a) {
          return key2;
        }
      };
    case ScalarType.INT64:
    case ScalarType.SFIXED64:
    case ScalarType.SINT64:
      return (key2) => {
        try {
          return protoInt64.parse(key2);
        } catch (_a) {
          return key2;
        }
      };
    default:
      return (key2) => {
        const n = Number.parseInt(key2);
        return Number.isFinite(n) ? n : key2;
      };
  }
}
function compileScalarValue(type, messageName, fieldName) {
  const writeScalar = compileScalarWrite(type);
  return (writer, value) => {
    try {
      writeScalar(writer, value);
    } catch (e) {
      if (e instanceof Error) {
        throw new Error(`cannot encode field ${messageName}.${fieldName} to binary: ${e.message}`);
      }
      throw e;
    }
  };
}
function compileScalarWrite(type) {
  switch (type) {
    case ScalarType.STRING:
      return (writer, value) => writer.string(value);
    case ScalarType.BOOL:
      return (writer, value) => writer.bool(value);
    case ScalarType.DOUBLE:
      return (writer, value) => writer.double(value);
    case ScalarType.FLOAT:
      return (writer, value) => writer.float(value);
    case ScalarType.INT32:
      return (writer, value) => writer.int32(value);
    case ScalarType.INT64:
      return (writer, value) => writer.int64(value);
    case ScalarType.UINT64:
      return (writer, value) => writer.uint64(value);
    case ScalarType.FIXED64:
      return (writer, value) => writer.fixed64(value);
    case ScalarType.BYTES:
      return (writer, value) => writer.bytes(value);
    case ScalarType.FIXED32:
      return (writer, value) => writer.fixed32(value);
    case ScalarType.SFIXED32:
      return (writer, value) => writer.sfixed32(value);
    case ScalarType.SFIXED64:
      return (writer, value) => writer.sfixed64(value);
    case ScalarType.SINT64:
      return (writer, value) => writer.sint64(value);
    case ScalarType.UINT32:
      return (writer, value) => writer.uint32(value);
    case ScalarType.SINT32:
      return (writer, value) => writer.sint32(value);
  }
}
function compileChildWriter(field) {
  const fieldNo = field.number;
  const writeMessage = compiledWriter(field.message);
  if (field.delimitedEncoding) {
    return (writer, opts, child) => {
      writer.tag(fieldNo, WireType.StartGroup);
      writeMessage(writer, opts, child);
      writer.tag(fieldNo, WireType.EndGroup);
    };
  }
  return (writer, opts, child) => {
    writer.tag(fieldNo, WireType.LengthDelimited).fork();
    writeMessage(writer, opts, child);
    writer.join();
  };
}
function writeTypeOfScalar(type) {
  switch (type) {
    case ScalarType.BYTES:
    case ScalarType.STRING:
      return WireType.LengthDelimited;
    case ScalarType.DOUBLE:
    case ScalarType.FIXED64:
    case ScalarType.SFIXED64:
      return WireType.Bit64;
    case ScalarType.FIXED32:
    case ScalarType.SFIXED32:
    case ScalarType.FLOAT:
      return WireType.Bit32;
    default:
      return WireType.Varint;
  }
}

// js/network/generated/galaxy/v1/galaxy_pb.ts
var file_galaxy_v1_galaxy = /* @__PURE__ */ fileDesc("ChZnYWxheHkvdjEvZ2FsYXh5LnByb3RvEglnYWxheHkudjEieQoOQXV0aG9yaXR5U2NvcGUSEAoId29ybGRfaWQYASABKAwSEAoIc2hhcmRfaWQYAiABKAwSEQoJc3lzdGVtX2lkGAMgASgMEhMKC293bmVyX2Vwb2NoGAQgASgEEhsKE3JlY292ZXJ5X2dlbmVyYXRpb24YBSABKAQiXQoKQ29tbWFuZEtleRISCgpjb21tYW5kX2lkGAEgASgMEh0KFXJlY2VpcHRfaG9tZV9zaGFyZF9pZBgCIAEoDBIcChRhZG1pc3Npb25fZ2VuZXJhdGlvbhgDIAEoBCKfAQoOQWRtaXNzaW9uR3JhbnQSHQoVcmVjZWlwdF9ob21lX3NoYXJkX2lkGAEgASgMEhIKCmdlbmVyYXRpb24YAiABKAQSGwoTbm90X2FmdGVyX3NlcnZlcl9tcxgDIAEoBBINCgV0b2tlbhgEIAEoDBIuCg10cmF2ZWxfcG9saWN5GAUgASgLMhcuZ2FsYXh5LnYxLlRyYXZlbFBvbGljeSJvCgxUcmF2ZWxQb2xpY3kSDwoHanVtcF9tcxgBIAEoBBITCgtjb29sZG93bl9tcxgCIAEoBBIeChZjb25maWd1cmF0aW9uX3JldmlzaW9uGAMgASgEEhkKEW1vZGlmaWVyX3JldmlzaW9uGAQgASgEIlAKDFRyYXZlbFRpbWluZxInCgZwb2xpY3kYASABKAsyFy5nYWxheHkudjEuVHJhdmVsUG9saWN5EhcKD3JlYWR5X3NlcnZlcl9tcxgCIAEoBCI9Cg5SZW5ld0FkbWlzc2lvbhIRCglzeXN0ZW1faWQYAyABKAwSEgoKcmVxdWVzdF9pZBgCIAEoBEoECAEQAiL/AQoQQWRtaXNzaW9uUmVuZXdlZBI0ChBtb3ZlbWVudF9jb250ZXh0GAcgASgLMhouZ2FsYXh5LnYxLk1vdmVtZW50Q29udGV4dBIoCgVzY29wZRgGIAEoCzIZLmdhbGF4eS52MS5BdXRob3JpdHlTY29wZRIdChVyZWNlaXB0X2hvbWVfc2hhcmRfaWQYASABKAwSEgoKcmVxdWVzdF9pZBgCIAEoBBIWCg5zZXJ2ZXJfdGltZV9tcxgDIAEoBBIoCgVncmFudBgEIAEoCzIZLmdhbGF4eS52MS5BZG1pc3Npb25HcmFudBIWCg5yZXRyeV9hZnRlcl9tcxgFIAEoDSKKAQoPTW92ZW1lbnRDb250ZXh0Eg8KB3ZlcnNpb24YASABKA0SEgoKY2F0YWxvZ19pZBgCIAEoCRIYChBzcGVlZF9wZXJfc2Vjb25kGAMgASgBEhEKCWNsZWFyYW5jZRgEIAEoARIOCgZleHRlbnQYBSABKAESFQoNc3VuX2NsZWFyYW5jZRgGIAEoASJeCgxUcmFjZUNvbnRleHQSEAoIdHJhY2VfaWQYASABKAwSDwoHc3Bhbl9pZBgCIAEoDBIWCg5wYXJlbnRfc3Bhbl9pZBgDIAEoDBITCgt0cmFjZV9mbGFncxgEIAEoDSLTAQoORGlhZ25vc3RpY1NwYW4SDQoFc3RhZ2UYASABKAkSKAoHY29udGV4dBgCIAEoCzIXLmdhbGF4eS52MS5UcmFjZUNvbnRleHQSEAoIY2xvY2tfaWQYAyABKAkSEgoKc3RhcnRlZF91cxgEIAEoBBITCgtkdXJhdGlvbl91cxgFIAEoBBIrCgZzdGF0dXMYBiABKA4yGy5nYWxheHkudjEuRGlhZ25vc3RpY1N0YXR1cxIMCgRjb2RlGAcgASgJEhIKCmNvbW1hbmRfaWQYCCABKAwiTAoPRGlhZ25vc3RpY0JhdGNoEigKBXNwYW5zGAEgAygLMhkuZ2FsYXh5LnYxLkRpYWdub3N0aWNTcGFuEg8KB2Ryb3BwZWQYAiABKA0ixAEKC0NsaWVudEhlbGxvEiAKGG1pbmltdW1fcHJvdG9jb2xfdmVyc2lvbhgBIAEoDRIgChhtYXhpbXVtX3Byb3RvY29sX3ZlcnNpb24YAiABKA0SHwoXc3VwcG9ydGVkX3J1bGVfdmVyc2lvbnMYAyADKA0SNAoVcmVxdWlyZWRfY2FwYWJpbGl0aWVzGAQgAygOMhUuZ2FsYXh5LnYxLkNhcGFiaWxpdHkSGgoSc2Vzc2lvbl9jcmVkZW50aWFsGAUgASgMIs4BCg1TZXJ2ZXJXZWxjb21lEhgKEHByb3RvY29sX3ZlcnNpb24YASABKA0SFAoMcnVsZV92ZXJzaW9uGAIgASgNEhEKCXBsYXllcl9pZBgDIAEoDBIdChVjb25uZWN0aW9uX2dlbmVyYXRpb24YBCABKAQSFgoOc2VydmVyX3RpbWVfbXMYBSABKAQSKwoMY2FwYWJpbGl0aWVzGAYgAygOMhUuZ2FsYXh5LnYxLkNhcGFiaWxpdHkSEAoId29ybGRfaWQYCCABKAxKBAgHEAgiMAoNTG9jYWxQb3NpdGlvbhIJCgF4GAEgASgBEgkKAXoYAiABKAESCQoBeRgDIAEoASLeAgoLTW92ZUNvbW1hbmQSFwoKb3JiaXRfYm9keRgIIAEoDUgAiAEBEiIKA2tleRgBIAEoCzIVLmdhbGF4eS52MS5Db21tYW5kS2V5EigKBXNjb3BlGAIgASgLMhkuZ2FsYXh5LnYxLkF1dGhvcml0eVNjb3BlEhAKCGZsZWV0X2lkGAMgASgMEigKBnRhcmdldBgEIAEoCzIYLmdhbGF4eS52MS5Mb2NhbFBvc2l0aW9uEiUKGGV4cGVjdGVkX3N5c3RlbV9yZXZpc2lvbhgFIAEoBEgBiAEBEhcKD2FkbWlzc2lvbl90b2tlbhgGIAEoDBIkChdleHBlY3RlZF9mbGVldF9yZXZpc2lvbhgHIAEoBEgCiAEBQg0KC19vcmJpdF9ib2R5QhsKGV9leHBlY3RlZF9zeXN0ZW1fcmV2aXNpb25CGgoYX2V4cGVjdGVkX2ZsZWV0X3JldmlzaW9uIqUCCg9UcmFuc2ZlckNvbW1hbmQSIgoDa2V5GAEgASgLMhUuZ2FsYXh5LnYxLkNvbW1hbmRLZXkSKAoFc2NvcGUYAiABKAsyGS5nYWxheHkudjEuQXV0aG9yaXR5U2NvcGUSEAoIZmxlZXRfaWQYAyABKAwSHQoVZGVzdGluYXRpb25fc3lzdGVtX2lkGAQgASgMEjYKFGRlc3RpbmF0aW9uX3Bvc2l0aW9uGAUgASgLMhguZ2FsYXh5LnYxLkxvY2FsUG9zaXRpb24SJQoYZXhwZWN0ZWRfc3lzdGVtX3JldmlzaW9uGAYgASgESACIAQESFwoPYWRtaXNzaW9uX3Rva2VuGAcgASgMQhsKGV9leHBlY3RlZF9zeXN0ZW1fcmV2aXNpb24iRAoMUmVjZWlwdFF1ZXJ5EhAKCHdvcmxkX2lkGAEgASgMEiIKA2tleRgCIAEoCzIVLmdhbGF4eS52MS5Db21tYW5kS2V5Il4KDE1vdmVBY2NlcHRlZBIXCg9zeXN0ZW1fcmV2aXNpb24YASABKAQSFgoOZmxlZXRfcmV2aXNpb24YAiABKAQSHQoVYWNjZXB0ZWRfYXRfc2VydmVyX21zGAMgASgEIkEKD0NvbW1hbmRSZWplY3RlZBIuCgZyZWFzb24YASABKA4yHi5nYWxheHkudjEuQ29tbWFuZFJlamVjdFJlYXNvbiJBCg5Db21tYW5kVW5rbm93bhIvCgZyZWFzb24YASABKA4yHy5nYWxheHkudjEuQ29tbWFuZFVua25vd25SZWFzb24ixgEKC01vdmVSZWNlaXB0EiIKA2tleRgBIAEoCzIVLmdhbGF4eS52MS5Db21tYW5kS2V5EisKCGFjY2VwdGVkGAIgASgLMhcuZ2FsYXh5LnYxLk1vdmVBY2NlcHRlZEgAEi4KCHJlamVjdGVkGAMgASgLMhouZ2FsYXh5LnYxLkNvbW1hbmRSZWplY3RlZEgAEiwKB3Vua25vd24YBCABKAsyGS5nYWxheHkudjEuQ29tbWFuZFVua25vd25IAEIICgZyZXN1bHQiygEKCUZsZWV0TW92ZRIlCgN2aWEYBiADKAsyGC5nYWxheHkudjEuTG9jYWxQb3NpdGlvbhImCgRmcm9tGAEgASgLMhguZ2FsYXh5LnYxLkxvY2FsUG9zaXRpb24SJAoCdG8YAiABKAsyGC5nYWxheHkudjEuTG9jYWxQb3NpdGlvbhIbChNkZXBhcnR1cmVfc2VydmVyX21zGAMgASgEEhkKEWFycml2YWxfc2VydmVyX21zGAQgASgEEhAKCG9yZGVyX2lkGAUgASgMIkQKDUh1bGxSZWZlcmVuY2USDwoHaHVsbF9pZBgBIAEoDBIPCgd2ZXJzaW9uGAIgASgNEhEKCWFzc2V0X2tleRgDIAEoCSK+AQoKU2hpcERlc2lnbhIRCglkZXNpZ25faWQYASABKAwSDwoHdmVyc2lvbhgCIAEoDRIMCgRyb2xlGAMgASgNEiYKBGh1bGwYBCABKAsyGC5nYWxheHkudjEuSHVsbFJlZmVyZW5jZRITCgtodWxsX3BvaW50cxgFIAEoDRIVCg1zaGllbGRfcG9pbnRzGAYgASgNEhUKDWF0dGFja19wb2ludHMYByABKA0SEwoLY2FyZ29fdW5pdHMYCCABKA0iWQoKRmxlZXRHcm91cBIlCgZkZXNpZ24YASABKAsyFS5nYWxheHkudjEuU2hpcERlc2lnbhINCgVjb3VudBgCIAEoDRIVCg1kYW1hZ2VfcG9pbnRzGAMgASgEIjkKEEZsZWV0Q29tcG9zaXRpb24SJQoGZ3JvdXBzGAEgAygLMhUuZ2FsYXh5LnYxLkZsZWV0R3JvdXAiOwoPRmxlZXRBcHBlYXJhbmNlEhMKC3RvdGFsX3NoaXBzGAEgASgNEhMKC2h1bGxfY291bnRzGAIgAygNIrICCg9GbGVldFByb2plY3Rpb24SDQoFb3JiaXQYCCABKAwSEAoIZmxlZXRfaWQYASABKAwSEAoIcmV2aXNpb24YAiABKAQSKgoIcG9zaXRpb24YAyABKAsyGC5nYWxheHkudjEuTG9jYWxQb3NpdGlvbhImCghtb3ZlbWVudBgEIAEoCzIULmdhbGF4eS52MS5GbGVldE1vdmUSFAoMY29udHJvbGxhYmxlGAUgASgIEiAKGHRyYW5zZmVyX3JlYWR5X3NlcnZlcl9tcxgGIAEoBBIwCgtjb21wb3NpdGlvbhgHIAEoCzIbLmdhbGF4eS52MS5GbGVldENvbXBvc2l0aW9uEi4KCmFwcGVhcmFuY2UYCSABKAsyGi5nYWxheHkudjEuRmxlZXRBcHBlYXJhbmNlIiYKDkdhbGF4eVBvc2l0aW9uEgkKAXgYASABKAESCQoBehgCIAEoASJwCg9Ub3BvbG9neUNsdXN0ZXISEgoKY2x1c3Rlcl9pZBgBIAEoDBIMCgRuYW1lGAIgASgJEisKCHBvc2l0aW9uGAMgASgLMhkuZ2FsYXh5LnYxLkdhbGF4eVBvc2l0aW9uEg4KBnJhZGl1cxgEIAEoASJyCg5Ub3BvbG9neVN5c3RlbRIRCglzeXN0ZW1faWQYASABKAwSEgoKY2x1c3Rlcl9pZBgCIAEoDBIMCgRuYW1lGAMgASgJEisKCHBvc2l0aW9uGAQgASgLMhkuZ2FsYXh5LnYxLkdhbGF4eVBvc2l0aW9uIjgKElRvcG9sb2d5Q29ubmVjdGlvbhIQCghzeXN0ZW1fYRgBIAEoDBIQCghzeXN0ZW1fYhgCIAEoDCLcAQoNV29ybGRUb3BvbG9neRIQCgh3b3JsZF9pZBgBIAEoDBIQCghyZXZpc2lvbhgCIAEoBBIsCghjbHVzdGVycxgDIAMoCzIaLmdhbGF4eS52MS5Ub3BvbG9neUNsdXN0ZXISKgoHc3lzdGVtcxgEIAMoCzIZLmdhbGF4eS52MS5Ub3BvbG9neVN5c3RlbRIyCgtjb25uZWN0aW9ucxgFIAMoCzIdLmdhbGF4eS52MS5Ub3BvbG9neUNvbm5lY3Rpb24SGQoRaG9zdGVkX3N5c3RlbV9pZHMYBiADKAwiPQoPUHJvdG9jb2xGYWlsdXJlEioKBGNvZGUYASABKA4yHC5nYWxheHkudjEuUHJvdG9jb2xFcnJvckNvZGUiuQMKDUNsaWVudE1lc3NhZ2USGAoQcHJvdG9jb2xfdmVyc2lvbhgBIAEoDRIdChVjb25uZWN0aW9uX2dlbmVyYXRpb24YAiABKAQSJwoFaGVsbG8YCiABKAsyFi5nYWxheHkudjEuQ2xpZW50SGVsbG9IABImCgRtb3ZlGAsgASgLMhYuZ2FsYXh5LnYxLk1vdmVDb21tYW5kSAASMAoNcmVjZWlwdF9xdWVyeRgMIAEoCzIXLmdhbGF4eS52MS5SZWNlaXB0UXVlcnlIABIuCgh0cmFuc2ZlchgOIAEoCzIaLmdhbGF4eS52MS5UcmFuc2ZlckNvbW1hbmRIABI0Cg9yZW5ld19hZG1pc3Npb24YDyABKAsyGS5nYWxheHkudjEuUmVuZXdBZG1pc3Npb25IABIuCgx2aWV3X3JlcXVlc3QYEiABKAsyFi5nYWxheHkudjEuVmlld1JlcXVlc3RIABI2ChBnYW1lcGxheV9yZXF1ZXN0GBMgASgLMhouZ2FsYXh5LnYxLkdhbWVwbGF5UmVxdWVzdEgAQgYKBGJvZHlKBAgNEA5KBAgQEBFKBAgREBJKBAgDEAQihwQKDVNlcnZlck1lc3NhZ2USGAoQcHJvdG9jb2xfdmVyc2lvbhgBIAEoDRIdChVjb25uZWN0aW9uX2dlbmVyYXRpb24YAiABKAQSKwoHd2VsY29tZRgKIAEoCzIYLmdhbGF4eS52MS5TZXJ2ZXJXZWxjb21lSAASKQoHcmVjZWlwdBgLIAEoCzIWLmdhbGF4eS52MS5Nb3ZlUmVjZWlwdEgAEi0KB2ZhaWx1cmUYDiABKAsyGi5nYWxheHkudjEuUHJvdG9jb2xGYWlsdXJlSAASOAoRYWRtaXNzaW9uX3JlbmV3ZWQYECABKAsyGy5nYWxheHkudjEuQWRtaXNzaW9uUmVuZXdlZEgAEioKCnZpZXdfZXZlbnQYEyABKAsyFC5nYWxheHkudjEuVmlld0V2ZW50SAASMgoOdmlld19wbGFjZW1lbnQYFCABKAsyGC5nYWxheHkudjEuVmlld1BsYWNlbWVudEgAEjIKDmdhbWVwbGF5X3JlcGx5GBUgASgLMhguZ2FsYXh5LnYxLkdhbWVwbGF5UmVwbHlIABI2ChBnYW1lcGxheV9jaGFuZ2VkGBYgASgLMhouZ2FsYXh5LnYxLkdhbWVwbGF5Q2hhbmdlZEgAQgYKBGJvZHlKBAgMEA1KBAgNEA5KBAgPEBBKBAgREBJKBAgSEBNKBAgDEARKBAgEEAUicwoSVHJhbnNmZXJGbGVldFN0YXRlEhcKD293bmVyX3BsYXllcl9pZBgBIAEoDBIuCgpwcm9qZWN0aW9uGAIgASgLMhouZ2FsYXh5LnYxLkZsZWV0UHJvamVjdGlvbhIUCgxydWxlX3ZlcnNpb24YAyABKA0ilgQKDUZsZWV0VHJhbnNmZXISEwoLdHJhbnNmZXJfaWQYASABKAwSGgoSaW50ZW50X2ZpbmdlcnByaW50GAIgASgMEjYKE3NvdXJjZV9hdF9kZXBhcnR1cmUYAyABKAsyGS5nYWxheHkudjEuQXV0aG9yaXR5U2NvcGUSHAoUZGVzdGluYXRpb25fc2hhcmRfaWQYBCABKAwSHQoVZGVzdGluYXRpb25fc3lzdGVtX2lkGAUgASgMEiwKBWZsZWV0GAYgASgLMh0uZ2FsYXh5LnYxLlRyYW5zZmVyRmxlZXRTdGF0ZRIyChNvcmlnaW5hdGluZ19jb21tYW5kGAcgASgLMhUuZ2FsYXh5LnYxLkNvbW1hbmRLZXkSGwoTZGVwYXJ0dXJlX3NlcnZlcl9tcxgIIAEoBBIZChFhcnJpdmFsX3NlcnZlcl9tcxgJIAEoBBI2ChRkZXN0aW5hdGlvbl9wb3NpdGlvbhgKIAEoCzIYLmdhbGF4eS52MS5Mb2NhbFBvc2l0aW9uEhcKD3NvdXJjZV9yZXZpc2lvbhgLIAEoBBIlChhleHBlY3RlZF9zeXN0ZW1fcmV2aXNpb24YDCABKARIAIgBARIwCg9hY2NlcHRlZF90aW1pbmcYDSABKAsyFy5nYWxheHkudjEuVHJhdmVsVGltaW5nQhsKGV9leHBlY3RlZF9zeXN0ZW1fcmV2aXNpb24iTwoQVHJhbnNmZXJJbXBvcnRlZBIjChtkZXN0aW5hdGlvbl9zeXN0ZW1fcmV2aXNpb24YASABKAQSFgoOZmxlZXRfcmV2aXNpb24YAiABKAQiQwoQVHJhbnNmZXJSZWplY3RlZBIvCgZyZWFzb24YASABKA4yHy5nYWxheHkudjEuVHJhbnNmZXJSZWplY3RSZWFzb24irAIKD1RyYW5zZmVyUmVjZWlwdBITCgt0cmFuc2Zlcl9pZBgBIAEoDBIaChJpbnRlbnRfZmluZ2VycHJpbnQYAiABKAwSLwoIaW1wb3J0ZWQYAyABKAsyGy5nYWxheHkudjEuVHJhbnNmZXJJbXBvcnRlZEgAEi8KCHJlamVjdGVkGAQgASgLMhsuZ2FsYXh5LnYxLlRyYW5zZmVyUmVqZWN0ZWRIABIiCgNrZXkYBSABKAsyFS5nYWxheHkudjEuQ29tbWFuZEtleRI6ChdkZXN0aW5hdGlvbl9hdF9kZWNpc2lvbhgGIAEoCzIZLmdhbGF4eS52MS5BdXRob3JpdHlTY29wZRIcChRkZWNpZGVkX2F0X3NlcnZlcl9tcxgHIAEoBEIICgZyZXN1bHQiZwoNVHJhbnNmZXJRdWVyeRITCgt0cmFuc2Zlcl9pZBgBIAEoDBIiCgNrZXkYAiABKAsyFS5nYWxheHkudjEuQ29tbWFuZEtleRIdChVkZXN0aW5hdGlvbl9zeXN0ZW1faWQYAyABKAwiqgEKC0hvbWVSZXF1ZXN0EhEKCXBsYXllcl9pZBgBIAEoDBImCgRtb3ZlGAIgASgLMhYuZ2FsYXh5LnYxLk1vdmVDb21tYW5kSAASLgoIdHJhbnNmZXIYAyABKAsyGi5nYWxheHkudjEuVHJhbnNmZXJDb21tYW5kSAASKAoFcXVlcnkYBCABKAsyFy5nYWxheHkudjEuUmVjZWlwdFF1ZXJ5SABCBgoEYm9keSI8ChVSZXRpcmVtZW50U3lzdGVtRmxvb3ISEQoJc3lzdGVtX2lkGAEgASgMEhAKCHJldmlzaW9uGAIgASgEIrQCChdUcmFuc2ZlclJldGlyZW1lbnRQcm9vZhI0ChFzb3VyY2VfYXRfcHJlcGFyZRgBIAEoCzIZLmdhbGF4eS52MS5BdXRob3JpdHlTY29wZRIcChRkZXN0aW5hdGlvbl9zaGFyZF9pZBgCIAEoDBIYChBwcmV2aW91c190aHJvdWdoGAMgASgEEg8KB3Rocm91Z2gYBCABKAQSFwoPcHJldmlvdXNfZGlnZXN0GAUgASgMEg4KBmRpZ2VzdBgGIAEoDBIPCgdyZWNvcmRzGAcgASgNEiAKGHNvdXJjZV9yZXF1aXJlZF9yZXZpc2lvbhgIIAEoBBI+ChRkZXN0aW5hdGlvbl9yZXF1aXJlZBgJIAMoCzIgLmdhbGF4eS52MS5SZXRpcmVtZW50U3lzdGVtRmxvb3IioQQKC1BlZXJNZXNzYWdlEhgKEHByb3RvY29sX3ZlcnNpb24YASABKA0SKQoGc2VuZGVyGAIgASgLMhkuZ2FsYXh5LnYxLkF1dGhvcml0eVNjb3BlEi4KDXRyYWNlX2NvbnRleHQYAyABKAsyFy5nYWxheHkudjEuVHJhY2VDb250ZXh0Ei8KC2RpYWdub3N0aWNzGAQgASgLMhouZ2FsYXh5LnYxLkRpYWdub3N0aWNCYXRjaBIsCgh0cmFuc2ZlchgKIAEoCzIYLmdhbGF4eS52MS5GbGVldFRyYW5zZmVySAASLQoHcmVjZWlwdBgLIAEoCzIaLmdhbGF4eS52MS5UcmFuc2ZlclJlY2VpcHRIABIpCgVxdWVyeRgMIAEoCzIYLmdhbGF4eS52MS5UcmFuc2ZlclF1ZXJ5SAASLgoMaG9tZV9yZXF1ZXN0GA0gASgLMhYuZ2FsYXh5LnYxLkhvbWVSZXF1ZXN0SAASLgoMaG9tZV9yZWNlaXB0GA4gASgLMhYuZ2FsYXh5LnYxLk1vdmVSZWNlaXB0SAASPgoQcmV0aXJlbWVudF9vZmZlchgPIAEoCzIiLmdhbGF4eS52MS5UcmFuc2ZlclJldGlyZW1lbnRQcm9vZkgAEjwKDnJldGlyZW1lbnRfYWNrGBAgASgLMiIuZ2FsYXh5LnYxLlRyYW5zZmVyUmV0aXJlbWVudFByb29mSABCBgoEYm9keSLSAQoLVmlld1JlcXVlc3QSEAoId29ybGRfaWQYASABKAwSDAoEc2xvdBgCIAEoDRIaChJyZXF1ZXN0X2dlbmVyYXRpb24YAyABKAQSKgoHcmVwbGFjZRgEIAEoCzIXLmdhbGF4eS52MS5WaWV3U2VsZWN0b3JIABInCgZyZXN1bWUYBSABKAsyFS5nYWxheHkudjEuVmlld1Jlc3VtZUgAEiUKBWNsb3NlGAYgASgLMhQuZ2FsYXh5LnYxLlZpZXdDbG9zZUgAQgsKCW9wZXJhdGlvbiKfAQoMVmlld1NlbGVjdG9yEi8KCG92ZXJ2aWV3GAEgASgLMhsuZ2FsYXh5LnYxLk92ZXJ2aWV3U2VsZWN0b3JIABIpCgVvd25lZBgCIAEoCzIYLmdhbGF4eS52MS5Pd25lZFNlbGVjdG9ySAASKwoGZGV0YWlsGAMgASgLMhkuZ2FsYXh5LnYxLkRldGFpbFNlbGVjdG9ySABCBgoEa2luZCJXChBPdmVydmlld1NlbGVjdG9yEhoKEndob2xlX2tub3duX2dhbGF4eRgBIAEoCBISCgpzeXN0ZW1faWRzGAIgAygMEhMKC2NsdXN0ZXJfaWRzGAMgAygMIg8KDU93bmVkU2VsZWN0b3IiIwoORGV0YWlsU2VsZWN0b3ISEQoJc3lzdGVtX2lkGAEgASgMIgsKCVZpZXdDbG9zZSJwCgpWaWV3UmVzdW1lEhsKE2Jhc2VsaW5lX2dlbmVyYXRpb24YBCABKAQSEwoLYmFzZWxpbmVfaWQYASABKAwSGAoQdmlzaWJpbGl0eV9lcG9jaBgCIAEoBBIWCg5hZnRlcl9zZXF1ZW5jZRgDIAEoBCKPAwoJVmlld0V2ZW50EhAKCHdvcmxkX2lkGAEgASgMEgwKBHNsb3QYAiABKA0SGgoScmVxdWVzdF9nZW5lcmF0aW9uGAMgASgEEhgKEHZpc2liaWxpdHlfZXBvY2gYBCABKAQSJQoFYmVnaW4YBSABKAsyFC5nYWxheHkudjEuVmlld0JlZ2luSAASJQoFY2h1bmsYBiABKAsyFC5nYWxheHkudjEuVmlld0NodW5rSAASJQoFcmVhZHkYByABKAsyFC5nYWxheHkudjEuVmlld1JlYWR5SAASJQoFZGVsdGEYCCABKAsyFC5nYWxheHkudjEuVmlld0RlbHRhSAASMQoLaW52YWxpZGF0ZWQYCSABKAsyGi5nYWxheHkudjEuVmlld0ludmFsaWRhdGVkSAASKwoIcmVqZWN0ZWQYCiABKAsyFy5nYWxheHkudjEuVmlld1JlamVjdGVkSAASJgoGY2xvc2VkGAsgASgLMhQuZ2FsYXh5LnYxLlZpZXdDbG9zZUgAQggKBnJlc3VsdCLSAQoJVmlld0JlZ2luEhkKEXRvcG9sb2d5X3JldmlzaW9uGAcgASgEEhsKE2Jhc2VsaW5lX2dlbmVyYXRpb24YBiABKAQSEwoLYmFzZWxpbmVfaWQYASABKAwSKQoIc2VsZWN0b3IYAiABKAsyFy5nYWxheHkudjEuVmlld1NlbGVjdG9yEhsKE3Byb2plY3Rpb25fb3duZXJfaWQYAyABKAwSEwoLb3duZXJfZXBvY2gYBCABKAQSGwoTcmVjb3ZlcnlfZ2VuZXJhdGlvbhgFIAEoBCLXAQoJVmlld0NodW5rEhsKE2Jhc2VsaW5lX2dlbmVyYXRpb24YBiABKAQSEwoLYmFzZWxpbmVfaWQYASABKAwSEwoLY2h1bmtfaW5kZXgYAiABKA0SKwoIb3ZlcnZpZXcYAyABKAsyFy5nYWxheHkudjEuT3ZlcnZpZXdSb3dzSAASJQoFb3duZWQYBCABKAsyFC5nYWxheHkudjEuT3duZWRSb3dzSAASJwoGZGV0YWlsGAUgASgLMhUuZ2FsYXh5LnYxLkRldGFpbFJvd3NIAEIGCgRyb3dzInYKCVZpZXdSZWFkeRIbChNiYXNlbGluZV9nZW5lcmF0aW9uGAUgASgEEhMKC2Jhc2VsaW5lX2lkGAEgASgMEhMKC2NodW5rX2NvdW50GAIgASgNEhAKCHNlcXVlbmNlGAMgASgEEhAKCGNvbXBsZXRlGAQgASgIIusBCglWaWV3RGVsdGESGwoTYmFzZWxpbmVfZ2VuZXJhdGlvbhgHIAEoBBITCgtiYXNlbGluZV9pZBgBIAEoDBIVCg1iYXNlX3NlcXVlbmNlGAIgASgEEhAKCHNlcXVlbmNlGAMgASgEEisKCG92ZXJ2aWV3GAQgASgLMhcuZ2FsYXh5LnYxLk92ZXJ2aWV3Um93c0gAEiUKBW93bmVkGAUgASgLMhQuZ2FsYXh5LnYxLk93bmVkUm93c0gAEicKBmRldGFpbBgGIAEoCzIVLmdhbGF4eS52MS5EZXRhaWxSb3dzSABCBgoEcm93cyI+Cg9WaWV3SW52YWxpZGF0ZWQSDgoGcmVhc29uGAEgASgNEhsKE2Jhc2VsaW5lX2dlbmVyYXRpb24YAiABKAQiNgoMVmlld1JlamVjdGVkEg4KBnJlYXNvbhgBIAEoDRIWCg5yZXRyeV9hZnRlcl9tcxgCIAEoDSKCAQoRU291cmNlT2JzZXJ2YXRpb24SKAoFc2NvcGUYASABKAsyGS5nYWxheHkudjEuQXV0aG9yaXR5U2NvcGUSEAoIcmV2aXNpb24YAiABKAQSGwoTY29tbWl0dGVkX3NlcnZlcl9tcxgDIAEoBBIUCgxhdmFpbGFiaWxpdHkYBCABKA0itAEKDk92ZXJ2aWV3U3lzdGVtEhEKCXN5c3RlbV9pZBgBIAEoDBIxCgtvYnNlcnZhdGlvbhgCIAEoCzIcLmdhbGF4eS52MS5Tb3VyY2VPYnNlcnZhdGlvbhIbCg5wcmVzZW50X2ZsZWV0cxgDIAEoDUgAiAEBEhoKDW1vdmluZ19mbGVldHMYBCABKA1IAYgBAUIRCg9fcHJlc2VudF9mbGVldHNCEAoOX21vdmluZ19mbGVldHMivwIKDE92ZXJ2aWV3Um93cxIsCghjbHVzdGVycxgBIAMoCzIaLmdhbGF4eS52MS5Ub3BvbG9neUNsdXN0ZXISKgoHc3lzdGVtcxgCIAMoCzIZLmdhbGF4eS52MS5Ub3BvbG9neVN5c3RlbRIyCgtjb25uZWN0aW9ucxgDIAMoCzIdLmdhbGF4eS52MS5Ub3BvbG9neUNvbm5lY3Rpb24SLAoJc3VtbWFyaWVzGAQgAygLMhkuZ2FsYXh5LnYxLk92ZXJ2aWV3U3lzdGVtEhoKEnJlbW92ZWRfc3lzdGVtX2lkcxgFIAMoDBIbChNyZW1vdmVkX2NsdXN0ZXJfaWRzGAYgAygMEjoKE3JlbW92ZWRfY29ubmVjdGlvbnMYByADKAsyHS5nYWxheHkudjEuVG9wb2xvZ3lDb25uZWN0aW9uIrwCCg1Pd25lZEZsZWV0Um93EhAKCGZsZWV0X2lkGAEgASgMEhYKDmZsZWV0X3JldmlzaW9uGAIgASgEEiwKBnNvdXJjZRgDIAEoCzIcLmdhbGF4eS52MS5Tb3VyY2VPYnNlcnZhdGlvbhINCgVzdGF0ZRgEIAEoDRIRCglzeXN0ZW1faWQYBSABKAwSHQoVZGVzdGluYXRpb25fc3lzdGVtX2lkGAYgASgMEhMKC3RyYW5zZmVyX2lkGAcgASgMEh4KEWFycml2YWxfc2VydmVyX21zGAggASgESACIAQESGQoMbWVtYmVyX2NvdW50GAkgASgNSAGIAQESGwoTZGVwYXJ0dXJlX3N5c3RlbV9pZBgKIAEoDEIUChJfYXJyaXZhbF9zZXJ2ZXJfbXNCDwoNX21lbWJlcl9jb3VudCJxCglPd25lZFJvd3MSKQoHdXBzZXJ0cxgBIAMoCzIYLmdhbGF4eS52MS5Pd25lZEZsZWV0Um93EhkKEXJlbW92ZWRfZmxlZXRfaWRzGAIgAygMEh4KFnVuYXZhaWxhYmxlX3NvdXJjZV9pZHMYAyADKAwihwEKCkRldGFpbFJvd3MSMQoLb2JzZXJ2YXRpb24YASABKAsyHC5nYWxheHkudjEuU291cmNlT2JzZXJ2YXRpb24SKwoHdXBzZXJ0cxgCIAMoCzIaLmdhbGF4eS52MS5GbGVldFByb2plY3Rpb24SGQoRcmVtb3ZlZF9mbGVldF9pZHMYAyADKAwijQIKDVZpZXdQbGFjZW1lbnQSEQoJcGxheWVyX2lkGAogASgMEhAKCHdvcmxkX2lkGAEgASgMEhsKE3BsYXllcl9wYXJ0aXRpb25faWQYAiABKAwSDwoHaG9zdF9pZBgDIAEoDBIVCg13ZWJzb2NrZXRfdXJsGAQgASgJEh0KEHdlYnRyYW5zcG9ydF91cmwYBSABKAlIAIgBARIaChJjZXJ0aWZpY2F0ZV9zaGEyNTYYBiABKAwSEAoIb3duZXJfaWQYByABKAwSEwoLb3duZXJfZXBvY2gYCCABKAQSGwoTcmVjb3ZlcnlfZ2VuZXJhdGlvbhgJIAEoBEITChFfd2VidHJhbnNwb3J0X3VybCJnCg9HYW1lcGxheVJlcXVlc3QSEgoKcmVxdWVzdF9pZBgBIAEoBBIvCglvcGVyYXRpb24YAiABKA4yHC5nYWxheHkudjEuR2FtZXBsYXlPcGVyYXRpb24SDwoHcGF5bG9hZBgDIAEoDCJeCg1HYW1lcGxheVJlcGx5EhIKCnJlcXVlc3RfaWQYASABKAQSDgoGc3RhdHVzGAIgASgNEhgKEHZpc2liaWxpdHlfZXBvY2gYAyABKAQSDwoHcGF5bG9hZBgEIAEoDCI0Cg9HYW1lcGxheUNoYW5nZWQSDgoGdG9waWNzGAEgASgNEhEKCWZsZWV0X2lkcxgCIAMoDCqaAwoKQ2FwYWJpbGl0eRIaChZDQVBBQklMSVRZX1VOU1BFQ0lGSUVEEAASIwofQ0FQQUJJTElUWV9JTlRSQV9TWVNURU1fTU9WRV9WMRABEiEKHUNBUEFCSUxJVFlfT1dORURfUlVMRV9TRUVEX1YxEAQSJwojQ0FQQUJJTElUWV9DUk9TU19TWVNURU1fVFJBTlNGRVJfVjEQBRIjCh9DQVBBQklMSVRZX0FETUlTU0lPTl9SRU5FV0FMX1YxEAcSHgoaQ0FQQUJJTElUWV9QTEFZRVJfVklFV1NfVjEQCxIiCh5DQVBBQklMSVRZX0dBTUVQTEFZX0NIQU5ORUxfVjEQDxIkCiBDQVBBQklMSVRZX0xPQ0FMX1BPU0lUSU9OX1hZWl9WMRAMEiAKHENBUEFCSUxJVFlfRkxFRVRfUkVUQVJHRVRfVjEQDRIqCiZDQVBBQklMSVRZX1BMQU5FVF9BVk9JRElOR19NT1ZFTUVOVF9WMRAOIgQIAhACIgQIAxADIgQIBhAGIgQICBAIIgQICRAJIgQIChAKKmwKEERpYWdub3N0aWNTdGF0dXMSIQodRElBR05PU1RJQ19TVEFUVVNfVU5TUEVDSUZJRUQQABIYChRESUFHTk9TVElDX1NUQVRVU19PSxABEhsKF0RJQUdOT1NUSUNfU1RBVFVTX0VSUk9SEAIq2QIKE0NvbW1hbmRSZWplY3RSZWFzb24SJQohQ09NTUFORF9SRUpFQ1RfUkVBU09OX1VOU1BFQ0lGSUVEEAASJgoiQ09NTUFORF9SRUpFQ1RfUkVBU09OX1VOQVVUSE9SSVpFRBABEigKJENPTU1BTkRfUkVKRUNUX1JFQVNPTl9JTlZBTElEX1RBUkdFVBACEigKJENPTU1BTkRfUkVKRUNUX1JFQVNPTl9TVEFMRV9SRVZJU0lPThADEiUKIUNPTU1BTkRfUkVKRUNUX1JFQVNPTl9XUk9OR19PV05FUhAEEisKJ0NPTU1BTkRfUkVKRUNUX1JFQVNPTl9JREVOVElUWV9DT05GTElDVBAFEisKJ0NPTU1BTkRfUkVKRUNUX1JFQVNPTl9BRE1JU1NJT05fRVhQSVJFRBAGEh4KGkNPTU1BTkRfUkVKRUNUX1JFQVNPTl9CVVNZEAcqtgEKFENvbW1hbmRVbmtub3duUmVhc29uEiYKIkNPTU1BTkRfVU5LTk9XTl9SRUFTT05fVU5TUEVDSUZJRUQQABIkCiBDT01NQU5EX1VOS05PV05fUkVBU09OX05PVF9GT1VORBABEiIKHkNPTU1BTkRfVU5LTk9XTl9SRUFTT05fRVhQSVJFRBACEiwKKENPTU1BTkRfVU5LTk9XTl9SRUFTT05fUkVDT1ZFUllfUkVRVUlSRUQQAyqsAgoRUHJvdG9jb2xFcnJvckNvZGUSIwofUFJPVE9DT0xfRVJST1JfQ09ERV9VTlNQRUNJRklFRBAAEisKJ1BST1RPQ09MX0VSUk9SX0NPREVfVU5TVVBQT1JURURfVkVSU0lPThABEigKJFBST1RPQ09MX0VSUk9SX0NPREVfVU5TVVBQT1JURURfUlVMRRACEi4KKlBST1RPQ09MX0VSUk9SX0NPREVfVU5TVVBQT1JURURfQ0FQQUJJTElUWRADEiEKHVBST1RPQ09MX0VSUk9SX0NPREVfTUFMRk9STUVEEAQSJAogUFJPVE9DT0xfRVJST1JfQ09ERV9VTkFVVEhPUklaRUQQBRIiCh5QUk9UT0NPTF9FUlJPUl9DT0RFX09WRVJMT0FERUQQBirBAQoUVHJhbnNmZXJSZWplY3RSZWFzb24SJgoiVFJBTlNGRVJfUkVKRUNUX1JFQVNPTl9VTlNQRUNJRklFRBAAEi4KKlRSQU5TRkVSX1JFSkVDVF9SRUFTT05fSU5WQUxJRF9ERVNUSU5BVElPThABEiwKKFRSQU5TRkVSX1JFSkVDVF9SRUFTT05fSURFTlRJVFlfQ09ORkxJQ1QQAhIjCh9UUkFOU0ZFUl9SRUpFQ1RfUkVBU09OX0NBUEFDSVRZEAMq2AMKEUdhbWVwbGF5T3BlcmF0aW9uEiIKHkdBTUVQTEFZX09QRVJBVElPTl9VTlNQRUNJRklFRBAAEh4KGkdBTUVQTEFZX09QRVJBVElPTl9KT1VSTkVZEAESIAocR0FNRVBMQVlfT1BFUkFUSU9OX0VOQ09VTlRFUhACEh0KGUdBTUVQTEFZX09QRVJBVElPTl9CQVRUTEUQAxIfChtHQU1FUExBWV9PUEVSQVRJT05fSU5EVVNUUlkQBBIiCh5HQU1FUExBWV9PUEVSQVRJT05fREVWRUxPUE1FTlQQBRIjCh9HQU1FUExBWV9PUEVSQVRJT05fRkxFRVRfU1RBVFVTEAYSHQoZR0FNRVBMQVlfT1BFUkFUSU9OX1NVUlZFWRAHEh8KG0dBTUVQTEFZX09QRVJBVElPTl9JTkNPTUlORxAIEiQKIEdBTUVQTEFZX09QRVJBVElPTl9ST1VURV9QUkVWSUVXEAkSIwofR0FNRVBMQVlfT1BFUkFUSU9OX1RFU1RFUl9GTEVFVBAKEiMKH0dBTUVQTEFZX09QRVJBVElPTl9KT1VSTkVZX1BBVEgQCxIkCiBHQU1FUExBWV9PUEVSQVRJT05fVEVTVEVSX09XTkVSUxAMYgZwcm90bzM");
var ClientMessageSchema = /* @__PURE__ */ messageDesc(file_galaxy_v1_galaxy, 34);
var ServerMessageSchema = /* @__PURE__ */ messageDesc(file_galaxy_v1_galaxy, 35);

// js/contracts/hull-appearance.ts
var HULL_ASSET_KEYS = Object.freeze([
  "aster-vale/interceptor",
  "aster-vale/fighter",
  "aster-vale/bomber",
  "aster-vale/frigate",
  "aster-vale/battleship",
  "aster-vale/colossus"
]);
var MAX_FLEET_MEMBERS = 1e6;
var LEGACY_HULL_APPEARANCE = Object.freeze({ totalShips: 0, hullCounts: Object.freeze([0, 0, 0, 0, 0, 0]), placeholder: true });

// js/network/fleet-appearance.ts
function validateFleetAppearance(value) {
  validateCount(value.totalShips);
  if (value.hullCounts.length !== 6) throw new Error("Invalid fleet appearance hulls");
  let represented = 0;
  for (const count of value.hullCounts) {
    if (!Number.isInteger(count) || count < 0 || count > MAX_FLEET_MEMBERS) throw new Error("Invalid fleet appearance count");
    represented += count;
  }
  if (represented > value.totalShips) throw new Error("Invalid fleet appearance total");
}
function validateCount(count) {
  if (!Number.isInteger(count) || count < 1 || count > MAX_FLEET_MEMBERS) throw new Error("Invalid fleet appearance count");
}

// js/contracts/opaque-id.ts
var hex = Array.from({ length: 256 }, (_, value) => value.toString(16).padStart(2, "0"));
function opaqueIdAt(bytes, offset = 0) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + 16 > bytes.length) throw new Error("Invalid identity column");
  let result = "";
  let nonzero = 0;
  for (let i = offset; i < offset + 16; i++) {
    const value = bytes[i];
    result += hex[value];
    nonzero |= value;
  }
  if (!nonzero) throw new Error("Zero identity is reserved");
  return result;
}

// js/network/fleet-composition.ts
var u32 = (n) => Number.isInteger(n) && n >= 0 && n <= 4294967295;
var identity = (id2) => id2?.length === 16 && id2.some((n) => n !== 0);
function designValid(d) {
  if (!d || !identity(d.designId) || !u32(d.version) || d.version < 1 || !Number.isInteger(d.role) || d.role < 1 || d.role > 6) return false;
  return hullValid(d) && [d.hullPoints, d.shieldPoints, d.attackPoints, d.cargoUnits].every(u32) && d.hullPoints > 0;
}
function hullValid(d) {
  const h = d.hull;
  return !!h && identity(h.hullId) && u32(h.version) && h.version > 0 && /^[a-z][a-z0-9/_-]{0,63}$/.test(h.assetKey) && h.assetKey.split("/").every(Boolean);
}
function damageValid(damage, design) {
  return typeof damage === "bigint" && damage >= 0n && damage < BigInt(design.hullPoints) + BigInt(design.shieldPoints);
}
function validateFleetComposition(value) {
  if (!value.groups.length || value.groups.length > 16) throw new Error("Invalid fleet groups");
  const seen = /* @__PURE__ */ new Set();
  let total = 0;
  for (const group of value.groups) {
    if (!designValid(group.design) || !u32(group.count) || group.count < 1) throw new Error("Invalid fleet design/count");
    if (!damageValid(group.damagePoints, group.design)) throw new Error("Invalid fleet damage");
    const key2 = `${opaqueIdAt(group.design.designId)}:${group.design.version}`;
    if (seen.has(key2)) throw new Error("Duplicate fleet design");
    seen.add(key2);
    total += group.count;
  }
  if (total > 1e6) throw new Error("Fleet member budget exceeded");
}

// js/network/validate-fields.ts
function check(condition, field) {
  if (!condition) throw new Error(`Invalid protocol ${field}`);
}
function present(value, field) {
  check(value !== void 0, field);
  return value;
}
function id(bytes) {
  check(bytes.byteLength === 16 && bytes.some((byte) => byte !== 0), "identity");
}
function token(bytes) {
  check(bytes.byteLength > 0 && bytes.byteLength <= 4096, "credential length");
}
function key(value) {
  const item = present(value, "command key");
  id(item.commandId);
  id(item.receiptHomeShardId);
  check(item.admissionGeneration > 0n, "admission generation");
}
function scope(value) {
  const item = present(value, "authority scope");
  id(item.worldId);
  id(item.shardId);
  id(item.systemId);
  check(item.ownerEpoch > 0n && item.recoveryGeneration > 0n, "authority generation");
}
function position(value) {
  const item = present(value, "local position");
  check(Number.isFinite(item.x) && Number.isFinite(item.y) && Number.isFinite(item.z), "local position");
}
function fleet(value) {
  check(!value.orbit?.length || value.orbit.length === 122 && (value.orbit[0] === 1 || value.orbit[0] === 2) && value.orbit[1] >= 1 && value.orbit[1] <= 15, "orbit record");
  id(value.fleetId);
  position(value.position);
  if (value.composition) validateFleetComposition(value.composition);
  if (value.appearance) validateFleetAppearance(value.appearance);
  if (!value.movement) return;
  if (value.movement.orderId.byteLength) id(value.movement.orderId);
  position(value.movement.from);
  position(value.movement.to);
  check((value.movement.via?.length ?? 0) <= 14, "movement path size");
  for (const point2 of value.movement.via ?? []) position(point2);
  check(value.movement.arrivalServerMs > value.movement.departureServerMs, "movement deadline");
}

// js/network/views/validate.ts
function counter(v, nonzero = true) {
  check(typeof v === "bigint" && v >= (nonzero ? 1n : 0n) && v <= 0xffffffffffffffffn, "view counter");
}
function ids(v, max) {
  check(v.length <= max, "view ID budget");
  const found = /* @__PURE__ */ new Set();
  for (const x of v) {
    id(x);
    const k = opaqueIdAt(x);
    check(!found.has(k), "duplicate view ID");
    found.add(k);
  }
}
function validateSelector(s, slot) {
  const k = s.kind;
  if (k.case === "owned") {
    check(slot === 2, "view slot");
    return;
  }
  if (k.case === "detail") {
    check(slot === 3, "view slot");
    id(k.value.systemId);
    return;
  }
  check(k.case === "overview" && slot === 1, "view selector");
  const v = k.value;
  ids(v.systemIds, 4096);
  ids(v.clusterIds, 256);
  check(Number(v.wholeKnownGalaxy) + Number(v.systemIds.length > 0) + Number(v.clusterIds.length > 0) === 1, "overview selector");
}
function validateViewRequest(v) {
  id(v.worldId);
  counter(v.requestGeneration);
  check(v.slot >= 1 && v.slot <= 3, "view slot");
  switch (v.operation.case) {
    case "replace":
      validateSelector(v.operation.value, v.slot);
      return;
    case "resume":
      counter(v.operation.value.baselineGeneration);
      id(v.operation.value.baselineId);
      counter(v.operation.value.visibilityEpoch);
      counter(v.operation.value.afterSequence, false);
      return;
    case "close":
      return;
    default:
      throw new Error("Missing view operation");
  }
}
function observation(v, world) {
  const o = present(v, "view observation");
  scope(o.scope);
  check(opaqueIdAt(o.scope.worldId) === opaqueIdAt(world), "view world");
  check(o.availability >= 1 && o.availability <= 4, "view availability");
  counter(o.revision, false);
  counter(o.committedServerMs, false);
  return o;
}
function point(p) {
  check(p && Number.isFinite(p.x) && Number.isFinite(p.z), "view point");
}
function overview(v, world) {
  ids(v.removedSystemIds, 256);
  ids(v.removedClusterIds, 256);
  for (const c of v.clusters) {
    id(c.clusterId);
    point(c.position);
    check(new TextEncoder().encode(c.name).length <= 64 && Number.isFinite(c.radius) && c.radius > 0, "view cluster");
  }
  for (const s of v.systems) {
    id(s.systemId);
    id(s.clusterId);
    point(s.position);
    check(new TextEncoder().encode(s.name).length <= 64, "view name");
  }
  for (const c of [...v.connections, ...v.removedConnections]) {
    id(c.systemA);
    id(c.systemB);
    check(opaqueIdAt(c.systemA) !== opaqueIdAt(c.systemB), "view edge");
  }
  for (const s of v.summaries) summary(s, world);
  check(v.clusters.length + v.systems.length + v.connections.length + v.summaries.length + v.removedSystemIds.length + v.removedClusterIds.length + v.removedConnections.length <= 256, "view rows");
}
function summary(s, world) {
  id(s.systemId);
  const o = observation(s.observation, world);
  check(opaqueIdAt(o.scope.systemId) === opaqueIdAt(s.systemId), "summary system");
  if (o.availability === 1) check(s.presentFleets !== void 0 && s.movingFleets !== void 0 && s.movingFleets <= s.presentFleets, "view counts");
  else check(s.presentFleets === void 0 && s.movingFleets === void 0, "hidden counts");
}
function owned(v, world) {
  ids(v.removedFleetIds, 256);
  ids(v.unavailableSourceIds, 4096);
  for (const f of v.upserts) {
    id(f.fleetId);
    observation(f.source, world);
    counter(f.fleetRevision, false);
    check(f.state >= 1 && f.state <= 3, "owned state");
    if (f.state === 3) {
      check(!f.systemId.length && f.arrivalServerMs !== void 0, "transit fields");
      id(f.destinationSystemId);
      id(f.departureSystemId);
      id(f.transferId);
    } else {
      id(f.systemId);
      check(!f.destinationSystemId.length && !f.departureSystemId.length && !f.transferId.length, "resident fields");
    }
  }
  check(v.upserts.length + v.removedFleetIds.length <= 256, "owned rows");
}
function validateRows(rows, slot, world) {
  check(rows.case === ["", "overview", "owned", "detail"][slot], "rows slot");
  if (rows.case === "overview") overview(rows.value, world);
  else if (rows.case === "owned") owned(rows.value, world);
  else if (rows.case === "detail") {
    observation(rows.value.observation, world);
    ids(rows.value.removedFleetIds, 256);
    for (const f of rows.value.upserts) fleet(f);
    check(rows.value.upserts.length + rows.value.removedFleetIds.length <= 256, "detail rows");
  }
}
function validateViewEvent(v) {
  id(v.worldId);
  counter(v.requestGeneration);
  counter(v.visibilityEpoch);
  check(v.slot >= 1 && v.slot <= 3, "view slot");
  const r = v.result;
  switch (r.case) {
    case "begin":
      check(v.slot === 1 ? r.value.topologyRevision > 0n : r.value.topologyRevision === 0n, "view topology revision");
      counter(r.value.baselineGeneration);
      id(r.value.baselineId);
      id(r.value.projectionOwnerId);
      counter(r.value.ownerEpoch);
      counter(r.value.recoveryGeneration);
      validateSelector(present(r.value.selector, "view selector"), v.slot);
      return;
    case "chunk":
      counter(r.value.baselineGeneration);
      id(r.value.baselineId);
      check(r.value.chunkIndex < 128, "view chunk");
      validateRows(r.value.rows, v.slot, v.worldId);
      return;
    case "ready":
      readyFields(r.value);
      return;
    case "delta":
      counter(r.value.baselineGeneration);
      id(r.value.baselineId);
      counter(r.value.baseSequence, false);
      counter(r.value.sequence);
      check(r.value.sequence === r.value.baseSequence + 1n, "view sequence");
      validateRows(r.value.rows, v.slot, v.worldId);
      return;
    case "invalidated":
      invalidatedFields(r.value);
      return;
    case "rejected":
      rejectedFields(r.value);
      return;
    case "closed":
      return;
    default:
      throw new Error("Missing view result");
  }
}
function readyFields(v) {
  counter(v.baselineGeneration);
  id(v.baselineId);
  check(v.chunkCount <= 128 && v.sequence === 0n, "view ready");
}
function rejectedFields(v) {
  check(v.reason >= 1 && v.reason <= 5 && v.retryAfterMs <= 3e4, "view rejection");
}
function invalidatedFields(v) {
  check(v.reason >= 1 && v.reason <= 4, "view invalidation");
  if (v.reason !== 1) counter(v.baselineGeneration);
}

// js/network/validate-client.ts
function hello(value) {
  check(value.minimumProtocolVersion > 0 && value.minimumProtocolVersion <= 1 && value.maximumProtocolVersion >= 1, "protocol version range");
  check(value.supportedRuleVersions.length <= 16 && value.supportedRuleVersions.includes(1), "rule versions");
  check(value.requiredCapabilities.length <= 16, "capabilities length");
  for (const capability of value.requiredCapabilities) check([1, 4, 5, 7, 11, 12, 13, 14, 15].includes(capability), "required capability");
  token(value.sessionCredential);
}
function move(value) {
  key(value.key);
  scope(value.scope);
  id(value.fleetId);
  position(value.target);
  token(value.admissionToken);
  if (value.expectedSystemRevision !== void 0) {
    check(value.expectedSystemRevision >= 0n && value.expectedSystemRevision <= 0xffffffffffffffffn, "expected revision");
  }
  if (value.orbitBody !== void 0) check(Number.isInteger(value.orbitBody) && value.orbitBody >= 1 && value.orbitBody <= 15 && value.expectedFleetRevision !== void 0, "orbit body/revision");
  if (value.expectedFleetRevision !== void 0) {
    check(value.expectedSystemRevision === void 0, "mutually exclusive move revisions");
    check(value.expectedFleetRevision > 0n && value.expectedFleetRevision <= 0xffffffffffffffffn, "expected fleet revision");
  }
}
function transfer(value) {
  key(value.key);
  scope(value.scope);
  id(value.fleetId);
  id(value.destinationSystemId);
  position(value.destinationPosition);
  token(value.admissionToken);
  if (value.expectedSystemRevision !== void 0) {
    check(value.expectedSystemRevision >= 0n && value.expectedSystemRevision <= 0xffffffffffffffffn, "expected revision");
  }
}
function validateClientMessage(message) {
  const body = message.body;
  if (body.case === "hello") {
    check(message.protocolVersion === 0 && message.connectionGeneration === 0n, "hello envelope");
    hello(body.value);
    return;
  }
  check(message.protocolVersion === 1 && message.connectionGeneration > 0n, "session envelope");
  switch (body.case) {
    case "gameplayRequest":
      check(body.value.requestId > 0n && body.value.operation >= 1 && body.value.operation <= 12 && body.value.payload.length > 0 && body.value.payload.length <= 4096, "gameplay request");
      break;
    case "viewRequest":
      validateViewRequest(body.value);
      break;
    case "move":
      move(body.value);
      break;
    case "transfer":
      transfer(body.value);
      break;
    case "receiptQuery":
      id(body.value.worldId);
      key(body.value.key);
      break;
    case "renewAdmission":
      id(body.value.systemId);
      check(body.value.requestId > 0n, "renewal request identity");
      break;
    default:
      throw new Error("Client message has no supported operation");
  }
}

// js/network/validate-server.ts
function welcome(value, generation) {
  check(value.protocolVersion === 1 && value.ruleVersion === 1, "welcome version");
  check(value.connectionGeneration === generation, "welcome generation");
  id(value.playerId);
  id(value.worldId);
  check(value.capabilities.length <= 16, "welcome limits");
  for (const capability of value.capabilities) check(capability > 0, "capability");
}
function admissionGrant(grant) {
  id(grant.receiptHomeShardId);
  check(grant.generation > 0n && grant.notAfterServerMs > 0n, "admission grant");
  token(grant.token);
  const policy = grant.travelPolicy;
  if (policy) {
    check(policy.jumpMs > 0n && policy.jumpMs <= 86400000n, "travel jump");
    check(policy.cooldownMs <= 2592000000n, "travel cooldown");
    check(policy.configurationRevision > 0n && policy.modifierRevision > 0n, "travel revisions");
  }
}
function admissionRenewed(value) {
  if (value.movementContext) {
    const c = value.movementContext;
    check(!!value.scope && !!value.grant && c.version === 3 && c.catalogId.length > 0 && c.catalogId.length <= 64, "movement context identity");
    check([c.speedPerSecond, c.clearance, c.extent, c.sunClearance].every(Number.isFinite) && c.speedPerSecond > 0 && c.clearance >= 0 && c.extent > 0 && c.sunClearance >= 0 && c.sunClearance <= 1, "movement context policy");
  }
  if (value.scope) {
    scope(value.scope);
    check(value.scope.shardId.every((b, i) => b === value.receiptHomeShardId[i]), "renewal scope home");
  }
  if (value.receiptHomeShardId.length === 0) check(!value.scope && !value.grant, "unresolved renewal home");
  else id(value.receiptHomeShardId);
  check(value.requestId > 0n && value.serverTimeMs > 0n && value.retryAfterMs <= 3e4, "renewal response");
  if (value.grant) {
    admissionGrant(value.grant);
    check(value.grant.notAfterServerMs > value.serverTimeMs, "renewed admission lifetime");
    check(value.grant.receiptHomeShardId.every((byte, index) => byte === value.receiptHomeShardId[index]), "renewed admission home");
  } else check(value.retryAfterMs > 0, "unavailable admission retry");
}
function receipt(value) {
  key(value.key);
  check(value.result.case !== void 0, "receipt outcome");
  if (value.result.case !== "accepted") check(value.result.value.reason > 0, "receipt reason");
}
function envelope(message) {
  if (message.protocolVersion === 0 && message.connectionGeneration === 0n && message.body.case === "failure") return;
  check(message.protocolVersion === 1 && message.connectionGeneration > 0n, "session envelope");
}
function validateServerMessage(message) {
  envelope(message);
  const body = message.body;
  switch (body.case) {
    case "viewPlacement": {
      const p = body.value;
      for (const v of [p.worldId, p.playerPartitionId, p.hostId, p.ownerId, p.playerId]) id(v);
      check(p.ownerEpoch > 0n && p.recoveryGeneration > 0n, "placement authority");
      placementUrl(p.websocketUrl, "wss:");
      if (p.webtransportUrl !== void 0) placementUrl(p.webtransportUrl, "https:");
      check(p.certificateSha256.length === 0 || p.certificateSha256.length === 32, "placement certificate");
      break;
    }
    case "gameplayReply":
      check(body.value.requestId > 0n && body.value.status >= 200 && body.value.status <= 599 && body.value.payload.length <= 8192, "gameplay reply");
      break;
    case "gameplayChanged":
      check(body.value.topics > 0 && (body.value.topics & ~63) === 0 && body.value.fleetIds.length <= 32, "gameplay topics");
      for (const v of body.value.fleetIds) id(v);
      break;
    case "viewEvent":
      validateViewEvent(body.value);
      break;
    case "welcome":
      welcome(body.value, message.connectionGeneration);
      break;
    case "receipt":
      receipt(body.value);
      break;
    case "admissionRenewed":
      admissionRenewed(body.value);
      break;
    case "failure":
      check(body.value.code > 0, "protocol failure");
      break;
    default:
      throw new Error("Server message has no supported operation");
  }
}
function placementUrl(value, protocol) {
  const url = new URL(value);
  const path = value.slice(value.indexOf("/", value.indexOf("://") + 3));
  check(value.length <= 2048 && url.protocol === protocol && path === url.pathname && path.length <= 136 && /^(\/[A-Za-z0-9_-]+)*\/session$/.test(path) && !url.username && !url.password && !url.search && !url.hash, "placement endpoint");
}

// js/network/limits.ts
var MAX_MESSAGE_BYTES = 256 * 1024;

// js/network/decode-budget.ts
var fields = /* @__PURE__ */ new WeakMap();
var MAX_FIELDS = 8192;
var MAX_MESSAGES = 2048;
var MAX_REPEATED = 256;
var MAX_DEPTH = 12;
var scalarWires = {
  [ScalarType.DOUBLE]: WireType.Bit64,
  [ScalarType.FIXED64]: WireType.Bit64,
  [ScalarType.SFIXED64]: WireType.Bit64,
  [ScalarType.FLOAT]: WireType.Bit32,
  [ScalarType.FIXED32]: WireType.Bit32,
  [ScalarType.SFIXED32]: WireType.Bit32,
  [ScalarType.STRING]: WireType.LengthDelimited,
  [ScalarType.BYTES]: WireType.LengthDelimited
};
function descriptorFields(schema) {
  let found = fields.get(schema);
  if (!found) {
    found = new Map(schema.fields.map((field) => [field.number, field]));
    fields.set(schema, found);
  }
  return found;
}
function checkDecodeBudget(schema, bytes) {
  const budget = { fields: MAX_FIELDS, messages: MAX_MESSAGES, bytes: bytes.length, viewRows: 0, repeated: /* @__PURE__ */ new Map() };
  scan(new BinaryReader(bytes), schema, bytes.length, 0, budget);
  if (bytes.length > MAX_MESSAGE_BYTES) throw new Error("Protocol message size exceeded");
}
function scan(reader, schema, end, depth, budget) {
  budget = messageBudget(schema, budget);
  if (depth > MAX_DEPTH || --budget.messages < 0) throw new Error("Protocol message expansion budget exceeded");
  enclosingBudget(schema.typeName, budget.bytes);
  const known = descriptorFields(schema);
  while (reader.pos < end) {
    if (--budget.fields < 0) throw new Error("Protocol field budget exceeded");
    const [number, wire] = reader.tag();
    const field = known.get(number);
    if (field) countField(field, wire, budget);
    scanValue(reader, field, wire, end, depth, budget);
  }
  if (reader.pos !== end) throw new Error("Protocol nested message crosses its boundary");
}
function messageBudget(schema, budget) {
  if (schema.typeName === "galaxy.v1.ViewEvent" || schema.typeName === "galaxy.v1.ViewRequest") return budget.views ?? (budget.views = { fields: 12 * 1024, messages: MAX_MESSAGES, bytes: budget.bytes, viewRows: 0, repeated: /* @__PURE__ */ new Map() });
  return budget;
}
function enclosingBudget(name, bytes) {
  if (["galaxy.v1.ViewRequest", "galaxy.v1.ViewEvent"].includes(name) && bytes > 128 * 1024) throw new Error("View enclosing byte budget exceeded");
}
function countField(field, wire, budget) {
  validateWire(field, wire);
  if (field.fieldKind === "list" && !(wire === WireType.LengthDelimited && packed(field))) countRepeated(field, budget);
}
function countRepeated(field, budget) {
  const count = (budget.repeated.get(field) ?? 0) + 1;
  const limit = repeatedLimit(field, budget);
  if (count > limit) throw new Error("Protocol repeated field expansion budget exceeded");
  budget.repeated.set(field, count);
}
function repeatedLimit(field, budget) {
  if (["galaxy.v1.OverviewRows", "galaxy.v1.OwnedRows", "galaxy.v1.DetailRows"].includes(field.parent.typeName)) {
    if (field.parent.typeName === "galaxy.v1.OwnedRows" && field.number === 3) return 4096;
    if (++budget.viewRows > 256) throw new Error("View row allocation budget exceeded");
    return 256;
  }
  if (field.parent.typeName === "galaxy.v1.OverviewSelector") return field.number === 2 ? 4096 : 256;
  switch (field.parent.typeName) {
    case "galaxy.v1.DiagnosticBatch":
      return 16;
    // Its only list is diagnostic spans.
    default:
      return MAX_REPEATED;
  }
}
function scanValue(reader, field, wire, end, depth, budget) {
  if (wire === WireType.StartGroup || wire === WireType.EndGroup) {
    throw new Error("Group encoding is outside this proto3 protocol");
  }
  if (wire !== WireType.LengthDelimited) {
    reader.skip(wire);
    return;
  }
  const length = reader.uint32();
  const next = reader.pos + length;
  if (next > end) throw new Error("Truncated protocol field");
  if (field?.message) {
    scan(reader, field.message, next, depth + 1, budget);
    return;
  }
  if (field && packed(field)) {
    scanPacked(reader, field, next, length, budget);
    return;
  }
  reader.pos = next;
}
function scanPacked(reader, field, end, length, budget) {
  chargePacked(field, length, budget);
  const wire = scalarWire(field);
  while (reader.pos < end) reader.skip(wire);
  if (reader.pos !== end) throw new Error("Protocol packed scalar crosses its boundary");
}
function scalarWire(field) {
  if (field.message || field.fieldKind === "map") return WireType.LengthDelimited;
  return field.scalar === void 0 ? WireType.Varint : scalarWires[field.scalar] ?? WireType.Varint;
}
function packed(field) {
  return field.fieldKind === "list" && scalarWire(field) !== WireType.LengthDelimited;
}
function validateWire(field, wire) {
  if (wire !== scalarWire(field) && !(wire === WireType.LengthDelimited && packed(field))) {
    throw new Error("Protocol field has incompatible wire type");
  }
}
function chargePacked(field, length, budget) {
  const count = (budget.repeated.get(field) ?? 0) + length;
  if (count > MAX_REPEATED) throw new Error("Protocol packed field expansion budget exceeded");
  budget.repeated.set(field, count);
}

// js/network/codec.ts
function bounded(bytes) {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_MESSAGE_BYTES) {
    throw new RangeError(`Protocol message length must be 1..${MAX_MESSAGE_BYTES}`);
  }
  return bytes;
}
function encodeClientMessage(message) {
  validateClientMessage(message);
  const bytes = bounded(toBinary(ClientMessageSchema, message));
  return bytes;
}
function decodeServerMessage(bytes) {
  bounded(bytes);
  checkDecodeBudget(ServerMessageSchema, bytes);
  const message = fromBinary(ServerMessageSchema, bytes);
  validateServerMessage(message);
  return message;
}
export {
  MAX_MESSAGE_BYTES,
  decodeServerMessage,
  encodeClientMessage
};
//# sourceMappingURL=codec.bundle.js.map
