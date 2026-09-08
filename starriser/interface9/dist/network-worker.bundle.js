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
function varint32write(value, bytes2) {
  if (value >>> 0 < 128) {
    bytes2.push(value);
    return;
  }
  if (value >= 0) {
    while (value > 127) {
      bytes2.push(value & 127 | 128);
      value = value >>> 7;
    }
    bytes2.push(value);
  } else {
    for (let i = 0; i < 9; i++) {
      bytes2.push(value & 127 | 128);
      value = value >> 7;
    }
    bytes2.push(1);
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
      decodeUtf8(bytes2, strict) {
        if (strict) {
          if (!textDecoderStrict) {
            textDecoderStrict = new globals.TextDecoder("utf-8", {
              fatal: true
            });
          }
          return textDecoderStrict.decode(bytes2);
        }
        return textDecoder.decode(bytes2);
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
    const bytes2 = encodeUtf8(text);
    dest.set(bytes2);
    return { written: bytes2.byteLength };
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
    const bytes2 = this.buffer;
    const view = this.viewCache;
    if (view.byteLength === bytes2.byteLength)
      return view;
    const newView = new DataView(bytes2.buffer);
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
    const bytes2 = this.bytes();
    const len = bytes2.length;
    if (len <= ASCII_MAX_LENGTH) {
      const codes = new Array(len);
      for (let i = 0; i < len; i++) {
        const byte = bytes2[i];
        if (byte > 127) {
          return this.decodeUtf8(bytes2, strict);
        }
        codes[i] = byte;
      }
      return String.fromCharCode.apply(String, codes);
    }
    return this.decodeUtf8(bytes2, strict);
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
  const bytes2 = new Uint8Array(size);
  let written = -1;
  if (nativeSetFromBase64) {
    try {
      const result = nativeSetFromBase64.call(bytes2, base64Str);
      if (result.read == len) {
        written = result.written;
      }
    } catch (_a) {
    }
  }
  if (written < 0) {
    written = setFromBase64(bytes2, base64Str);
  }
  return written == size ? bytes2 : bytes2.subarray(0, written);
}
function setFromBase64(bytes2, base64Str) {
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
        bytes2[bytePos++] = p << 2 | (b & 48) >> 4;
        p = b;
        groupPos = 2;
        break;
      case 2:
        bytes2[bytePos++] = (p & 15) << 4 | (b & 60) >> 2;
        p = b;
        groupPos = 3;
        break;
      case 3:
        bytes2[bytePos++] = (p & 3) << 6 | b;
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
function fromBinary(schema, bytes2, options) {
  const message = create(schema);
  compiledReader(schema).read(message, new BinaryReader(bytes2), makeReadContext(options), bytes2.byteLength);
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
      const bytes2 = [];
      varint32write(val, bytes2);
      const unknownFields = (_a2 = message.$unknown) !== null && _a2 !== void 0 ? _a2 : [];
      unknownFields.push({
        no: fieldNo,
        wireType,
        data: new Uint8Array(bytes2)
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
    const unknown2 = message.$unknown;
    if (unknown2 !== void 0 && opts.writeUnknownFields) {
      for (let i = 0; i < unknown2.length; i++) {
        const { no, wireType, data } = unknown2[i];
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
var file_galaxy_v1_galaxy = /* @__PURE__ */ fileDesc("ChZnYWxheHkvdjEvZ2FsYXh5LnByb3RvEglnYWxheHkudjEieQoOQXV0aG9yaXR5U2NvcGUSEAoId29ybGRfaWQYASABKAwSEAoIc2hhcmRfaWQYAiABKAwSEQoJc3lzdGVtX2lkGAMgASgMEhMKC293bmVyX2Vwb2NoGAQgASgEEhsKE3JlY292ZXJ5X2dlbmVyYXRpb24YBSABKAQiXQoKQ29tbWFuZEtleRISCgpjb21tYW5kX2lkGAEgASgMEh0KFXJlY2VpcHRfaG9tZV9zaGFyZF9pZBgCIAEoDBIcChRhZG1pc3Npb25fZ2VuZXJhdGlvbhgDIAEoBCJvCg5BZG1pc3Npb25HcmFudBIdChVyZWNlaXB0X2hvbWVfc2hhcmRfaWQYASABKAwSEgoKZ2VuZXJhdGlvbhgCIAEoBBIbChNub3RfYWZ0ZXJfc2VydmVyX21zGAMgASgEEg0KBXRva2VuGAQgASgMIkMKDlJlbmV3QWRtaXNzaW9uEh0KFXJlY2VpcHRfaG9tZV9zaGFyZF9pZBgBIAEoDBISCgpyZXF1ZXN0X2lkGAIgASgEIp8BChBBZG1pc3Npb25SZW5ld2VkEh0KFXJlY2VpcHRfaG9tZV9zaGFyZF9pZBgBIAEoDBISCgpyZXF1ZXN0X2lkGAIgASgEEhYKDnNlcnZlcl90aW1lX21zGAMgASgEEigKBWdyYW50GAQgASgLMhkuZ2FsYXh5LnYxLkFkbWlzc2lvbkdyYW50EhYKDnJldHJ5X2FmdGVyX21zGAUgASgNIl4KDFRyYWNlQ29udGV4dBIQCgh0cmFjZV9pZBgBIAEoDBIPCgdzcGFuX2lkGAIgASgMEhYKDnBhcmVudF9zcGFuX2lkGAMgASgMEhMKC3RyYWNlX2ZsYWdzGAQgASgNItMBCg5EaWFnbm9zdGljU3BhbhINCgVzdGFnZRgBIAEoCRIoCgdjb250ZXh0GAIgASgLMhcuZ2FsYXh5LnYxLlRyYWNlQ29udGV4dBIQCghjbG9ja19pZBgDIAEoCRISCgpzdGFydGVkX3VzGAQgASgEEhMKC2R1cmF0aW9uX3VzGAUgASgEEisKBnN0YXR1cxgGIAEoDjIbLmdhbGF4eS52MS5EaWFnbm9zdGljU3RhdHVzEgwKBGNvZGUYByABKAkSEgoKY29tbWFuZF9pZBgIIAEoDCJMCg9EaWFnbm9zdGljQmF0Y2gSKAoFc3BhbnMYASADKAsyGS5nYWxheHkudjEuRGlhZ25vc3RpY1NwYW4SDwoHZHJvcHBlZBgCIAEoDSJPCg9Qcm9qZWN0aW9uVHJhY2USKAoHY29udGV4dBgBIAEoCzIXLmdhbGF4eS52MS5UcmFjZUNvbnRleHQSEgoKY29tbWFuZF9pZBgCIAEoDCLEAQoLQ2xpZW50SGVsbG8SIAoYbWluaW11bV9wcm90b2NvbF92ZXJzaW9uGAEgASgNEiAKGG1heGltdW1fcHJvdG9jb2xfdmVyc2lvbhgCIAEoDRIfChdzdXBwb3J0ZWRfcnVsZV92ZXJzaW9ucxgDIAMoDRI0ChVyZXF1aXJlZF9jYXBhYmlsaXRpZXMYBCADKA4yFS5nYWxheHkudjEuQ2FwYWJpbGl0eRIaChJzZXNzaW9uX2NyZWRlbnRpYWwYBSABKAwi9wEKDVNlcnZlcldlbGNvbWUSGAoQcHJvdG9jb2xfdmVyc2lvbhgBIAEoDRIUCgxydWxlX3ZlcnNpb24YAiABKA0SEQoJcGxheWVyX2lkGAMgASgMEh0KFWNvbm5lY3Rpb25fZ2VuZXJhdGlvbhgEIAEoBBIWCg5zZXJ2ZXJfdGltZV9tcxgFIAEoBBIrCgxjYXBhYmlsaXRpZXMYBiADKA4yFS5nYWxheHkudjEuQ2FwYWJpbGl0eRItCgphZG1pc3Npb25zGAcgAygLMhkuZ2FsYXh5LnYxLkFkbWlzc2lvbkdyYW50EhAKCHdvcmxkX2lkGAggASgMIiUKDUxvY2FsUG9zaXRpb24SCQoBeBgBIAEoARIJCgF6GAIgASgBIvMBCgtNb3ZlQ29tbWFuZBIiCgNrZXkYASABKAsyFS5nYWxheHkudjEuQ29tbWFuZEtleRIoCgVzY29wZRgCIAEoCzIZLmdhbGF4eS52MS5BdXRob3JpdHlTY29wZRIPCgdzaGlwX2lkGAMgASgMEigKBnRhcmdldBgEIAEoCzIYLmdhbGF4eS52MS5Mb2NhbFBvc2l0aW9uEiUKGGV4cGVjdGVkX3N5c3RlbV9yZXZpc2lvbhgFIAEoBEgAiAEBEhcKD2FkbWlzc2lvbl90b2tlbhgGIAEoDEIbChlfZXhwZWN0ZWRfc3lzdGVtX3JldmlzaW9uIqQCCg9UcmFuc2ZlckNvbW1hbmQSIgoDa2V5GAEgASgLMhUuZ2FsYXh5LnYxLkNvbW1hbmRLZXkSKAoFc2NvcGUYAiABKAsyGS5nYWxheHkudjEuQXV0aG9yaXR5U2NvcGUSDwoHc2hpcF9pZBgDIAEoDBIdChVkZXN0aW5hdGlvbl9zeXN0ZW1faWQYBCABKAwSNgoUZGVzdGluYXRpb25fcG9zaXRpb24YBSABKAsyGC5nYWxheHkudjEuTG9jYWxQb3NpdGlvbhIlChhleHBlY3RlZF9zeXN0ZW1fcmV2aXNpb24YBiABKARIAIgBARIXCg9hZG1pc3Npb25fdG9rZW4YByABKAxCGwoZX2V4cGVjdGVkX3N5c3RlbV9yZXZpc2lvbiJECgxSZWNlaXB0UXVlcnkSEAoId29ybGRfaWQYASABKAwSIgoDa2V5GAIgASgLMhUuZ2FsYXh5LnYxLkNvbW1hbmRLZXkiXQoMTW92ZUFjY2VwdGVkEhcKD3N5c3RlbV9yZXZpc2lvbhgBIAEoBBIVCg1zaGlwX3JldmlzaW9uGAIgASgEEh0KFWFjY2VwdGVkX2F0X3NlcnZlcl9tcxgDIAEoBCJBCg9Db21tYW5kUmVqZWN0ZWQSLgoGcmVhc29uGAEgASgOMh4uZ2FsYXh5LnYxLkNvbW1hbmRSZWplY3RSZWFzb24iQQoOQ29tbWFuZFVua25vd24SLwoGcmVhc29uGAEgASgOMh8uZ2FsYXh5LnYxLkNvbW1hbmRVbmtub3duUmVhc29uIsYBCgtNb3ZlUmVjZWlwdBIiCgNrZXkYASABKAsyFS5nYWxheHkudjEuQ29tbWFuZEtleRIrCghhY2NlcHRlZBgCIAEoCzIXLmdhbGF4eS52MS5Nb3ZlQWNjZXB0ZWRIABIuCghyZWplY3RlZBgDIAEoCzIaLmdhbGF4eS52MS5Db21tYW5kUmVqZWN0ZWRIABIsCgd1bmtub3duGAQgASgLMhkuZ2FsYXh5LnYxLkNvbW1hbmRVbmtub3duSABCCAoGcmVzdWx0Ik0KDFN0cmVhbUN1cnNvchIXCg9zdWJzY3JpcHRpb25faWQYASABKAwSEgoKZ2VuZXJhdGlvbhgCIAEoBBIQCghzZXF1ZW5jZRgDIAEoBCJ+Cg9TdWJzY3JpYmVTeXN0ZW0SEAoId29ybGRfaWQYASABKAwSEQoJc3lzdGVtX2lkGAIgASgMEhcKD3N1YnNjcmlwdGlvbl9pZBgDIAEoDBItCgxyZXN1bWVfYWZ0ZXIYBCABKAsyFy5nYWxheHkudjEuU3RyZWFtQ3Vyc29yIpgBChRQbGF5YmFja0Nsb2NrUmVxdWVzdBIoCgVzY29wZRgBIAEoCzIZLmdhbGF4eS52MS5BdXRob3JpdHlTY29wZRIpCghiYXNlbGluZRgCIAEoCzIXLmdhbGF4eS52MS5TdHJlYW1DdXJzb3ISFwoPc3lzdGVtX3JldmlzaW9uGAMgASgEEhIKCnJlcXVlc3RfaWQYBCABKAQixQEKF1BsYXliYWNrQ2xvY2tDb3JyZWN0aW9uEigKBXNjb3BlGAEgASgLMhkuZ2FsYXh5LnYxLkF1dGhvcml0eVNjb3BlEikKCGJhc2VsaW5lGAIgASgLMhcuZ2FsYXh5LnYxLlN0cmVhbUN1cnNvchIXCg9zeXN0ZW1fcmV2aXNpb24YAyABKAQSEgoKcmVxdWVzdF9pZBgEIAEoBBIQCghzZXF1ZW5jZRgFIAEoBBIWCg5zZXJ2ZXJfdGltZV9tcxgGIAEoBCKiAQoIU2hpcE1vdmUSJgoEZnJvbRgBIAEoCzIYLmdhbGF4eS52MS5Mb2NhbFBvc2l0aW9uEiQKAnRvGAIgASgLMhguZ2FsYXh5LnYxLkxvY2FsUG9zaXRpb24SGwoTZGVwYXJ0dXJlX3NlcnZlcl9tcxgDIAEoBBIZChFhcnJpdmFsX3NlcnZlcl9tcxgEIAEoBBIQCghvcmRlcl9pZBgFIAEoDCK+AQoOU2hpcFByb2plY3Rpb24SDwoHc2hpcF9pZBgBIAEoDBIQCghyZXZpc2lvbhgCIAEoBBIqCghwb3NpdGlvbhgDIAEoCzIYLmdhbGF4eS52MS5Mb2NhbFBvc2l0aW9uEiUKCG1vdmVtZW50GAQgASgLMhMuZ2FsYXh5LnYxLlNoaXBNb3ZlEhQKDGNvbnRyb2xsYWJsZRgFIAEoCBIgChh0cmFuc2Zlcl9yZWFkeV9zZXJ2ZXJfbXMYBiABKAQiJgoOR2FsYXh5UG9zaXRpb24SCQoBeBgBIAEoARIJCgF6GAIgASgBInAKD1RvcG9sb2d5Q2x1c3RlchISCgpjbHVzdGVyX2lkGAEgASgMEgwKBG5hbWUYAiABKAkSKwoIcG9zaXRpb24YAyABKAsyGS5nYWxheHkudjEuR2FsYXh5UG9zaXRpb24SDgoGcmFkaXVzGAQgASgBInIKDlRvcG9sb2d5U3lzdGVtEhEKCXN5c3RlbV9pZBgBIAEoDBISCgpjbHVzdGVyX2lkGAIgASgMEgwKBG5hbWUYAyABKAkSKwoIcG9zaXRpb24YBCABKAsyGS5nYWxheHkudjEuR2FsYXh5UG9zaXRpb24iOAoSVG9wb2xvZ3lDb25uZWN0aW9uEhAKCHN5c3RlbV9hGAEgASgMEhAKCHN5c3RlbV9iGAIgASgMItwBCg1Xb3JsZFRvcG9sb2d5EhAKCHdvcmxkX2lkGAEgASgMEhAKCHJldmlzaW9uGAIgASgEEiwKCGNsdXN0ZXJzGAMgAygLMhouZ2FsYXh5LnYxLlRvcG9sb2d5Q2x1c3RlchIqCgdzeXN0ZW1zGAQgAygLMhkuZ2FsYXh5LnYxLlRvcG9sb2d5U3lzdGVtEjIKC2Nvbm5lY3Rpb25zGAUgAygLMh0uZ2FsYXh5LnYxLlRvcG9sb2d5Q29ubmVjdGlvbhIZChFob3N0ZWRfc3lzdGVtX2lkcxgGIAMoDCKqAQoSU3Vic2NyaWJlU3RyYXRlZ2ljEhAKCHdvcmxkX2lkGAEgASgMEhcKD3N1YnNjcmlwdGlvbl9pZBgCIAEoDBIbChNpbnRlcmVzdF9nZW5lcmF0aW9uGAMgASgEEhIKCnN5c3RlbV9pZHMYBCADKAwSOAoScmVxdWVzdGVkX2VuY29kaW5nGAUgASgOMhwuZ2FsYXh5LnYxLlN0cmF0ZWdpY0VuY29kaW5nIn8KFUNvbW1pdHRlZFN5c3RlbUNvdW50cxIXCg9zeXN0ZW1fcmV2aXNpb24YASABKAQSIAoYY29tbWl0dGVkX3NlcnZlcl90aW1lX21zGAIgASgEEhUKDXByZXNlbnRfc2hpcHMYAyABKA0SFAoMbW92aW5nX3NoaXBzGAQgASgNIqcBCg1TeXN0ZW1TdW1tYXJ5EigKBXNjb3BlGAEgASgLMhkuZ2FsYXh5LnYxLkF1dGhvcml0eVNjb3BlEjoKDGF2YWlsYWJpbGl0eRgCIAEoDjIkLmdhbGF4eS52MS5TeXN0ZW1TdW1tYXJ5QXZhaWxhYmlsaXR5EjAKBmNvdW50cxgDIAEoCzIgLmdhbGF4eS52MS5Db21taXR0ZWRTeXN0ZW1Db3VudHMiQAoTU3RyYXRlZ2ljU3lzdGVtVmlldxIpCgdzeXN0ZW1zGAEgAygLMhguZ2FsYXh5LnYxLlN5c3RlbVN1bW1hcnkiSgoUQ29tcGFjdFN0cmF0ZWdpY1ZpZXcSMgoGZ3JvdXBzGAEgAygLMiIuZ2FsYXh5LnYxLlN0cmF0ZWdpY0F1dGhvcml0eUdyb3VwIo8BChdTdHJhdGVnaWNBdXRob3JpdHlHcm91cBIQCghzaGFyZF9pZBgBIAEoDBITCgtvd25lcl9lcG9jaBgCIAEoBBIbChNyZWNvdmVyeV9nZW5lcmF0aW9uGAMgASgEEjAKB3N5c3RlbXMYBCADKAsyHy5nYWxheHkudjEuQ29tcGFjdFN5c3RlbVN1bW1hcnkilwEKFENvbXBhY3RTeXN0ZW1TdW1tYXJ5EhEKCXN5c3RlbV9pZBgBIAEoDBI6CgxhdmFpbGFiaWxpdHkYAiABKA4yJC5nYWxheHkudjEuU3lzdGVtU3VtbWFyeUF2YWlsYWJpbGl0eRIwCgZjb3VudHMYAyABKAsyIC5nYWxheHkudjEuQ29tbWl0dGVkU3lzdGVtQ291bnRzIkUKEVN0cmF0ZWdpY1JlamVjdGVkEjAKBnJlYXNvbhgBIAEoDjIgLmdhbGF4eS52MS5TdHJhdGVnaWNSZWplY3RSZWFzb24ikQIKEFN0cmF0ZWdpY1N5c3RlbXMSEAoId29ybGRfaWQYASABKAwSFwoPc3Vic2NyaXB0aW9uX2lkGAIgASgMEhsKE2ludGVyZXN0X2dlbmVyYXRpb24YAyABKAQSEAoIc2VxdWVuY2UYBCABKAQSLgoEdmlldxgFIAEoCzIeLmdhbGF4eS52MS5TdHJhdGVnaWNTeXN0ZW1WaWV3SAASMAoIcmVqZWN0ZWQYBiABKAsyHC5nYWxheHkudjEuU3RyYXRlZ2ljUmVqZWN0ZWRIABI3Cgxjb21wYWN0X3ZpZXcYByABKAsyHy5nYWxheHkudjEuQ29tcGFjdFN0cmF0ZWdpY1ZpZXdIAEIICgZyZXN1bHQioAIKE1N5c3RlbVNuYXBzaG90Q2h1bmsSKAoFc2NvcGUYASABKAsyGS5nYWxheHkudjEuQXV0aG9yaXR5U2NvcGUSJwoGY3Vyc29yGAIgASgLMhcuZ2FsYXh5LnYxLlN0cmVhbUN1cnNvchITCgtzbmFwc2hvdF9pZBgDIAEoDBITCgtjaHVua19pbmRleBgEIAEoDRITCgtjaHVua19jb3VudBgFIAEoDRIXCg9zeXN0ZW1fcmV2aXNpb24YBiABKAQSKAoFc2hpcHMYByADKAsyGS5nYWxheHkudjEuU2hpcFByb2plY3Rpb24SHgoRY29tbWl0dGVkX3RpbWVfbXMYCCABKARIAIgBAUIUChJfY29tbWl0dGVkX3RpbWVfbXMikwIKC1N5c3RlbURlbHRhEigKBXNjb3BlGAEgASgLMhkuZ2FsYXh5LnYxLkF1dGhvcml0eVNjb3BlEicKBmN1cnNvchgCIAEoCzIXLmdhbGF4eS52MS5TdHJlYW1DdXJzb3ISHAoUYmFzZV9zeXN0ZW1fcmV2aXNpb24YAyABKAQSFwoPc3lzdGVtX3JldmlzaW9uGAQgASgEEioKB3Vwc2VydHMYBSADKAsyGS5nYWxheHkudjEuU2hpcFByb2plY3Rpb24SGAoQcmVtb3ZlZF9zaGlwX2lkcxgGIAMoDBIeChFjb21taXR0ZWRfdGltZV9tcxgHIAEoBEgAiAEBQhQKEl9jb21taXR0ZWRfdGltZV9tcyI9Cg9Qcm90b2NvbEZhaWx1cmUSKgoEY29kZRgBIAEoDjIcLmdhbGF4eS52MS5Qcm90b2NvbEVycm9yQ29kZSKTBAoNQ2xpZW50TWVzc2FnZRIYChBwcm90b2NvbF92ZXJzaW9uGAEgASgNEh0KFWNvbm5lY3Rpb25fZ2VuZXJhdGlvbhgCIAEoBBIuCg10cmFjZV9jb250ZXh0GAMgASgLMhcuZ2FsYXh5LnYxLlRyYWNlQ29udGV4dBInCgVoZWxsbxgKIAEoCzIWLmdhbGF4eS52MS5DbGllbnRIZWxsb0gAEiYKBG1vdmUYCyABKAsyFi5nYWxheHkudjEuTW92ZUNvbW1hbmRIABIwCg1yZWNlaXB0X3F1ZXJ5GAwgASgLMhcuZ2FsYXh5LnYxLlJlY2VpcHRRdWVyeUgAEi8KCXN1YnNjcmliZRgNIAEoCzIaLmdhbGF4eS52MS5TdWJzY3JpYmVTeXN0ZW1IABIuCgh0cmFuc2ZlchgOIAEoCzIaLmdhbGF4eS52MS5UcmFuc2ZlckNvbW1hbmRIABI0Cg9yZW5ld19hZG1pc3Npb24YDyABKAsyGS5nYWxheHkudjEuUmVuZXdBZG1pc3Npb25IABI8ChNzdWJzY3JpYmVfc3RyYXRlZ2ljGBAgASgLMh0uZ2FsYXh5LnYxLlN1YnNjcmliZVN0cmF0ZWdpY0gAEjkKDnBsYXliYWNrX2Nsb2NrGBEgASgLMh8uZ2FsYXh5LnYxLlBsYXliYWNrQ2xvY2tSZXF1ZXN0SABCBgoEYm9keSLzBAoNU2VydmVyTWVzc2FnZRIYChBwcm90b2NvbF92ZXJzaW9uGAEgASgNEh0KFWNvbm5lY3Rpb25fZ2VuZXJhdGlvbhgCIAEoBBIvCgtkaWFnbm9zdGljcxgDIAEoCzIaLmdhbGF4eS52MS5EaWFnbm9zdGljQmF0Y2gSNAoQcHJvamVjdGlvbl90cmFjZRgEIAEoCzIaLmdhbGF4eS52MS5Qcm9qZWN0aW9uVHJhY2USKwoHd2VsY29tZRgKIAEoCzIYLmdhbGF4eS52MS5TZXJ2ZXJXZWxjb21lSAASKQoHcmVjZWlwdBgLIAEoCzIWLmdhbGF4eS52MS5Nb3ZlUmVjZWlwdEgAEjIKCHNuYXBzaG90GAwgASgLMh4uZ2FsYXh5LnYxLlN5c3RlbVNuYXBzaG90Q2h1bmtIABInCgVkZWx0YRgNIAEoCzIWLmdhbGF4eS52MS5TeXN0ZW1EZWx0YUgAEi0KB2ZhaWx1cmUYDiABKAsyGi5nYWxheHkudjEuUHJvdG9jb2xGYWlsdXJlSAASLAoIdG9wb2xvZ3kYDyABKAsyGC5nYWxheHkudjEuV29ybGRUb3BvbG9neUgAEjgKEWFkbWlzc2lvbl9yZW5ld2VkGBAgASgLMhsuZ2FsYXh5LnYxLkFkbWlzc2lvblJlbmV3ZWRIABIwCglzdHJhdGVnaWMYESABKAsyGy5nYWxheHkudjEuU3RyYXRlZ2ljU3lzdGVtc0gAEjwKDnBsYXliYWNrX2Nsb2NrGBIgASgLMiIuZ2FsYXh5LnYxLlBsYXliYWNrQ2xvY2tDb3JyZWN0aW9uSABCBgoEYm9keSJxChFUcmFuc2ZlclNoaXBTdGF0ZRIXCg9vd25lcl9wbGF5ZXJfaWQYASABKAwSLQoKcHJvamVjdGlvbhgCIAEoCzIZLmdhbGF4eS52MS5TaGlwUHJvamVjdGlvbhIUCgxydWxlX3ZlcnNpb24YAyABKA0i4QMKDFNoaXBUcmFuc2ZlchITCgt0cmFuc2Zlcl9pZBgBIAEoDBIaChJpbnRlbnRfZmluZ2VycHJpbnQYAiABKAwSNgoTc291cmNlX2F0X2RlcGFydHVyZRgDIAEoCzIZLmdhbGF4eS52MS5BdXRob3JpdHlTY29wZRIcChRkZXN0aW5hdGlvbl9zaGFyZF9pZBgEIAEoDBIdChVkZXN0aW5hdGlvbl9zeXN0ZW1faWQYBSABKAwSKgoEc2hpcBgGIAEoCzIcLmdhbGF4eS52MS5UcmFuc2ZlclNoaXBTdGF0ZRIyChNvcmlnaW5hdGluZ19jb21tYW5kGAcgASgLMhUuZ2FsYXh5LnYxLkNvbW1hbmRLZXkSGwoTZGVwYXJ0dXJlX3NlcnZlcl9tcxgIIAEoBBIZChFhcnJpdmFsX3NlcnZlcl9tcxgJIAEoBBI2ChRkZXN0aW5hdGlvbl9wb3NpdGlvbhgKIAEoCzIYLmdhbGF4eS52MS5Mb2NhbFBvc2l0aW9uEhcKD3NvdXJjZV9yZXZpc2lvbhgLIAEoBBIlChhleHBlY3RlZF9zeXN0ZW1fcmV2aXNpb24YDCABKARIAIgBAUIbChlfZXhwZWN0ZWRfc3lzdGVtX3JldmlzaW9uIk4KEFRyYW5zZmVySW1wb3J0ZWQSIwobZGVzdGluYXRpb25fc3lzdGVtX3JldmlzaW9uGAEgASgEEhUKDXNoaXBfcmV2aXNpb24YAiABKAQiQwoQVHJhbnNmZXJSZWplY3RlZBIvCgZyZWFzb24YASABKA4yHy5nYWxheHkudjEuVHJhbnNmZXJSZWplY3RSZWFzb24irAIKD1RyYW5zZmVyUmVjZWlwdBITCgt0cmFuc2Zlcl9pZBgBIAEoDBIaChJpbnRlbnRfZmluZ2VycHJpbnQYAiABKAwSLwoIaW1wb3J0ZWQYAyABKAsyGy5nYWxheHkudjEuVHJhbnNmZXJJbXBvcnRlZEgAEi8KCHJlamVjdGVkGAQgASgLMhsuZ2FsYXh5LnYxLlRyYW5zZmVyUmVqZWN0ZWRIABIiCgNrZXkYBSABKAsyFS5nYWxheHkudjEuQ29tbWFuZEtleRI6ChdkZXN0aW5hdGlvbl9hdF9kZWNpc2lvbhgGIAEoCzIZLmdhbGF4eS52MS5BdXRob3JpdHlTY29wZRIcChRkZWNpZGVkX2F0X3NlcnZlcl9tcxgHIAEoBEIICgZyZXN1bHQiZwoNVHJhbnNmZXJRdWVyeRITCgt0cmFuc2Zlcl9pZBgBIAEoDBIiCgNrZXkYAiABKAsyFS5nYWxheHkudjEuQ29tbWFuZEtleRIdChVkZXN0aW5hdGlvbl9zeXN0ZW1faWQYAyABKAwiqgEKC0hvbWVSZXF1ZXN0EhEKCXBsYXllcl9pZBgBIAEoDBImCgRtb3ZlGAIgASgLMhYuZ2FsYXh5LnYxLk1vdmVDb21tYW5kSAASLgoIdHJhbnNmZXIYAyABKAsyGi5nYWxheHkudjEuVHJhbnNmZXJDb21tYW5kSAASKAoFcXVlcnkYBCABKAsyFy5nYWxheHkudjEuUmVjZWlwdFF1ZXJ5SABCBgoEYm9keSI8ChVSZXRpcmVtZW50U3lzdGVtRmxvb3ISEQoJc3lzdGVtX2lkGAEgASgMEhAKCHJldmlzaW9uGAIgASgEIrQCChdUcmFuc2ZlclJldGlyZW1lbnRQcm9vZhI0ChFzb3VyY2VfYXRfcHJlcGFyZRgBIAEoCzIZLmdhbGF4eS52MS5BdXRob3JpdHlTY29wZRIcChRkZXN0aW5hdGlvbl9zaGFyZF9pZBgCIAEoDBIYChBwcmV2aW91c190aHJvdWdoGAMgASgEEg8KB3Rocm91Z2gYBCABKAQSFwoPcHJldmlvdXNfZGlnZXN0GAUgASgMEg4KBmRpZ2VzdBgGIAEoDBIPCgdyZWNvcmRzGAcgASgNEiAKGHNvdXJjZV9yZXF1aXJlZF9yZXZpc2lvbhgIIAEoBBI+ChRkZXN0aW5hdGlvbl9yZXF1aXJlZBgJIAMoCzIgLmdhbGF4eS52MS5SZXRpcmVtZW50U3lzdGVtRmxvb3IioAQKC1BlZXJNZXNzYWdlEhgKEHByb3RvY29sX3ZlcnNpb24YASABKA0SKQoGc2VuZGVyGAIgASgLMhkuZ2FsYXh5LnYxLkF1dGhvcml0eVNjb3BlEi4KDXRyYWNlX2NvbnRleHQYAyABKAsyFy5nYWxheHkudjEuVHJhY2VDb250ZXh0Ei8KC2RpYWdub3N0aWNzGAQgASgLMhouZ2FsYXh5LnYxLkRpYWdub3N0aWNCYXRjaBIrCgh0cmFuc2ZlchgKIAEoCzIXLmdhbGF4eS52MS5TaGlwVHJhbnNmZXJIABItCgdyZWNlaXB0GAsgASgLMhouZ2FsYXh5LnYxLlRyYW5zZmVyUmVjZWlwdEgAEikKBXF1ZXJ5GAwgASgLMhguZ2FsYXh5LnYxLlRyYW5zZmVyUXVlcnlIABIuCgxob21lX3JlcXVlc3QYDSABKAsyFi5nYWxheHkudjEuSG9tZVJlcXVlc3RIABIuCgxob21lX3JlY2VpcHQYDiABKAsyFi5nYWxheHkudjEuTW92ZVJlY2VpcHRIABI+ChByZXRpcmVtZW50X29mZmVyGA8gASgLMiIuZ2FsYXh5LnYxLlRyYW5zZmVyUmV0aXJlbWVudFByb29mSAASPAoOcmV0aXJlbWVudF9hY2sYECABKAsyIi5nYWxheHkudjEuVHJhbnNmZXJSZXRpcmVtZW50UHJvb2ZIAEIGCgRib2R5KpQDCgpDYXBhYmlsaXR5EhoKFkNBUEFCSUxJVFlfVU5TUEVDSUZJRUQQABIjCh9DQVBBQklMSVRZX0lOVFJBX1NZU1RFTV9NT1ZFX1YxEAESHwobQ0FQQUJJTElUWV9TWVNURU1fU1RSRUFNX1YxEAISIAocQ0FQQUJJTElUWV9XT1JMRF9UT1BPTE9HWV9WMRADEiEKHUNBUEFCSUxJVFlfT1dORURfUlVMRV9TRUVEX1YxEAQSJwojQ0FQQUJJTElUWV9DUk9TU19TWVNURU1fVFJBTlNGRVJfVjEQBRIdChlDQVBBQklMSVRZX0RJQUdOT1NUSUNTX1YxEAYSIwofQ0FQQUJJTElUWV9BRE1JU1NJT05fUkVORVdBTF9WMRAHEiMKH0NBUEFCSUxJVFlfU1RSQVRFR0lDX1NZU1RFTVNfVjEQCBIrCidDQVBBQklMSVRZX1NUUkFURUdJQ19TWVNURU1TX0NPTVBBQ1RfVjEQCRIgChxDQVBBQklMSVRZX1BMQVlCQUNLX0NMT0NLX1YxEAoqbAoQRGlhZ25vc3RpY1N0YXR1cxIhCh1ESUFHTk9TVElDX1NUQVRVU19VTlNQRUNJRklFRBAAEhgKFERJQUdOT1NUSUNfU1RBVFVTX09LEAESGwoXRElBR05PU1RJQ19TVEFUVVNfRVJST1IQAirZAgoTQ29tbWFuZFJlamVjdFJlYXNvbhIlCiFDT01NQU5EX1JFSkVDVF9SRUFTT05fVU5TUEVDSUZJRUQQABImCiJDT01NQU5EX1JFSkVDVF9SRUFTT05fVU5BVVRIT1JJWkVEEAESKAokQ09NTUFORF9SRUpFQ1RfUkVBU09OX0lOVkFMSURfVEFSR0VUEAISKAokQ09NTUFORF9SRUpFQ1RfUkVBU09OX1NUQUxFX1JFVklTSU9OEAMSJQohQ09NTUFORF9SRUpFQ1RfUkVBU09OX1dST05HX09XTkVSEAQSKwonQ09NTUFORF9SRUpFQ1RfUkVBU09OX0lERU5USVRZX0NPTkZMSUNUEAUSKwonQ09NTUFORF9SRUpFQ1RfUkVBU09OX0FETUlTU0lPTl9FWFBJUkVEEAYSHgoaQ09NTUFORF9SRUpFQ1RfUkVBU09OX0JVU1kQByq2AQoUQ29tbWFuZFVua25vd25SZWFzb24SJgoiQ09NTUFORF9VTktOT1dOX1JFQVNPTl9VTlNQRUNJRklFRBAAEiQKIENPTU1BTkRfVU5LTk9XTl9SRUFTT05fTk9UX0ZPVU5EEAESIgoeQ09NTUFORF9VTktOT1dOX1JFQVNPTl9FWFBJUkVEEAISLAooQ09NTUFORF9VTktOT1dOX1JFQVNPTl9SRUNPVkVSWV9SRVFVSVJFRBADKloKEVN0cmF0ZWdpY0VuY29kaW5nEiIKHlNUUkFURUdJQ19FTkNPRElOR19VTlNQRUNJRklFRBAAEiEKHVNUUkFURUdJQ19FTkNPRElOR19DT01QQUNUX1YxEAEqoAEKGVN5c3RlbVN1bW1hcnlBdmFpbGFiaWxpdHkSKwonU1lTVEVNX1NVTU1BUllfQVZBSUxBQklMSVRZX1VOU1BFQ0lGSUVEEAASKQolU1lTVEVNX1NVTU1BUllfQVZBSUxBQklMSVRZX0FWQUlMQUJMRRABEisKJ1NZU1RFTV9TVU1NQVJZX0FWQUlMQUJJTElUWV9VTkFWQUlMQUJMRRACKu0BChVTdHJhdGVnaWNSZWplY3RSZWFzb24SJwojU1RSQVRFR0lDX1JFSkVDVF9SRUFTT05fVU5TUEVDSUZJRUQQABInCiNTVFJBVEVHSUNfUkVKRUNUX1JFQVNPTl9XUk9OR19XT1JMRBABEigKJFNUUkFURUdJQ19SRUpFQ1RfUkVBU09OX1VOQVVUSE9SSVpFRBACEiYKIlNUUkFURUdJQ19SRUpFQ1RfUkVBU09OX05PVF9IT1NURUQQAxIwCixTVFJBVEVHSUNfUkVKRUNUX1JFQVNPTl9VTlNVUFBPUlRFRF9FTkNPRElORxAEKqwCChFQcm90b2NvbEVycm9yQ29kZRIjCh9QUk9UT0NPTF9FUlJPUl9DT0RFX1VOU1BFQ0lGSUVEEAASKwonUFJPVE9DT0xfRVJST1JfQ09ERV9VTlNVUFBPUlRFRF9WRVJTSU9OEAESKAokUFJPVE9DT0xfRVJST1JfQ09ERV9VTlNVUFBPUlRFRF9SVUxFEAISLgoqUFJPVE9DT0xfRVJST1JfQ09ERV9VTlNVUFBPUlRFRF9DQVBBQklMSVRZEAMSIQodUFJPVE9DT0xfRVJST1JfQ09ERV9NQUxGT1JNRUQQBBIkCiBQUk9UT0NPTF9FUlJPUl9DT0RFX1VOQVVUSE9SSVpFRBAFEiIKHlBST1RPQ09MX0VSUk9SX0NPREVfT1ZFUkxPQURFRBAGKsEBChRUcmFuc2ZlclJlamVjdFJlYXNvbhImCiJUUkFOU0ZFUl9SRUpFQ1RfUkVBU09OX1VOU1BFQ0lGSUVEEAASLgoqVFJBTlNGRVJfUkVKRUNUX1JFQVNPTl9JTlZBTElEX0RFU1RJTkFUSU9OEAESLAooVFJBTlNGRVJfUkVKRUNUX1JFQVNPTl9JREVOVElUWV9DT05GTElDVBACEiMKH1RSQU5TRkVSX1JFSkVDVF9SRUFTT05fQ0FQQUNJVFkQA2IGcHJvdG8z");
var MoveCommandSchema = /* @__PURE__ */ messageDesc(file_galaxy_v1_galaxy, 12);
var TransferCommandSchema = /* @__PURE__ */ messageDesc(file_galaxy_v1_galaxy, 13);
var MoveReceiptSchema = /* @__PURE__ */ messageDesc(file_galaxy_v1_galaxy, 18);
var PlaybackClockRequestSchema = /* @__PURE__ */ messageDesc(file_galaxy_v1_galaxy, 21);
var ClientMessageSchema = /* @__PURE__ */ messageDesc(file_galaxy_v1_galaxy, 42);
var ServerMessageSchema = /* @__PURE__ */ messageDesc(file_galaxy_v1_galaxy, 43);
var Capability = {
  /**
   * @generated from enum value: CAPABILITY_UNSPECIFIED = 0;
   */
  UNSPECIFIED: 0,
  /**
   * @generated from enum value: CAPABILITY_INTRA_SYSTEM_MOVE_V1 = 1;
   */
  INTRA_SYSTEM_MOVE_V1: 1,
  /**
   * @generated from enum value: CAPABILITY_SYSTEM_STREAM_V1 = 2;
   */
  SYSTEM_STREAM_V1: 2,
  /**
   * @generated from enum value: CAPABILITY_WORLD_TOPOLOGY_V1 = 3;
   */
  WORLD_TOPOLOGY_V1: 3,
  /**
   * Observer-owned rule seeds include real order identity and committed time.
   *
   * @generated from enum value: CAPABILITY_OWNED_RULE_SEED_V1 = 4;
   */
  OWNED_RULE_SEED_V1: 4,
  /**
   * @generated from enum value: CAPABILITY_CROSS_SYSTEM_TRANSFER_V1 = 5;
   */
  CROSS_SYSTEM_TRANSFER_V1: 5,
  /**
   * @generated from enum value: CAPABILITY_DIAGNOSTICS_V1 = 6;
   */
  DIAGNOSTICS_V1: 6,
  /**
   * @generated from enum value: CAPABILITY_ADMISSION_RENEWAL_V1 = 7;
   */
  ADMISSION_RENEWAL_V1: 7,
  /**
   * @generated from enum value: CAPABILITY_STRATEGIC_SYSTEMS_V1 = 8;
   */
  STRATEGIC_SYSTEMS_V1: 8,
  /**
   * @generated from enum value: CAPABILITY_STRATEGIC_SYSTEMS_COMPACT_V1 = 9;
   */
  STRATEGIC_SYSTEMS_COMPACT_V1: 9,
  /**
   * @generated from enum value: CAPABILITY_PLAYBACK_CLOCK_V1 = 10;
   */
  PLAYBACK_CLOCK_V1: 10
};
var CommandUnknownReason = {
  /**
   * @generated from enum value: COMMAND_UNKNOWN_REASON_UNSPECIFIED = 0;
   */
  UNSPECIFIED: 0,
  /**
   * @generated from enum value: COMMAND_UNKNOWN_REASON_NOT_FOUND = 1;
   */
  NOT_FOUND: 1,
  /**
   * @generated from enum value: COMMAND_UNKNOWN_REASON_EXPIRED = 2;
   */
  EXPIRED: 2,
  /**
   * @generated from enum value: COMMAND_UNKNOWN_REASON_RECOVERY_REQUIRED = 3;
   */
  RECOVERY_REQUIRED: 3
};
var StrategicEncoding = {
  /**
   * Omitted/default requests retain the legacy complete-view representation.
   *
   * @generated from enum value: STRATEGIC_ENCODING_UNSPECIFIED = 0;
   */
  UNSPECIFIED: 0,
  /**
   * @generated from enum value: STRATEGIC_ENCODING_COMPACT_V1 = 1;
   */
  COMPACT_V1: 1
};

// js/contracts/opaque-id.ts
var hex = Array.from({ length: 256 }, (_, value) => value.toString(16).padStart(2, "0"));
function isOpaqueId(value) {
  return /^[0-9a-f]{32}$/.test(value) && value !== "00000000000000000000000000000000";
}
function opaqueIdAt(bytes2, offset = 0) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + 16 > bytes2.length) throw new Error("Invalid identity column");
  let result = "";
  let nonzero = 0;
  for (let i = offset; i < offset + 16; i++) {
    const value = bytes2[i];
    result += hex[value];
    nonzero |= value;
  }
  if (!nonzero) throw new Error("Zero identity is reserved");
  return result;
}
function opaqueIdBytes(value) {
  if (!isOpaqueId(value)) throw new Error("Invalid opaque identity");
  const result = new Uint8Array(16);
  for (let i = 0; i < 16; i++) result[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return result;
}

// js/contracts/server-clock.ts
function validateServerClock(anchor) {
  if (typeof anchor.serverMs !== "bigint" || anchor.serverMs < 0n || anchor.serverMs > 0xffffffffffffffffn || ![anchor.monotonicMs, anchor.timeOriginMs, anchor.roundTripMs].every(Number.isFinite) || anchor.monotonicMs < 0 || anchor.roundTripMs < 0) throw new Error("Invalid server clock observation");
}

// js/render/remote/contracts.ts
var MAX_BATCH_ENTITIES = 256;
var MAX_STREAM_BYTES = 1024 * 1024;
var MAX_STREAM_BATCHES = 4;
var MAX_SNAPSHOT_ENTITIES = 16384;
var MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;
function projectionBuffers(batch) {
  const count = batch.ids.byteLength / 16;
  const removed = batch.removedIds.byteLength / 16;
  if (batch.layoutVersion !== 1 || !Number.isInteger(count) || !Number.isInteger(removed) || count + removed > MAX_BATCH_ENTITIES) throw new Error("Invalid projection batch size/layout");
  const views = [batch.ids, batch.revisions, batch.positions, batch.targets, batch.times, batch.moving, batch.removedIds];
  const lengths = [count * 16, count * 8, count * 16, count * 16, count * 16, count, removed * 16];
  const constructors = [Uint8Array, BigUint64Array, Float64Array, Float64Array, BigUint64Array, Uint8Array, Uint8Array];
  const buffers = /* @__PURE__ */ new Set();
  for (let i = 0; i < views.length; i++) {
    const view = views[i];
    if (!(view instanceof constructors[i]) || view.byteLength !== lengths[i] || !(view.buffer instanceof ArrayBuffer)) throw new Error("Invalid projection column");
    buffers.add(view.buffer);
  }
  return [...buffers];
}
function bufferBytes(buffers) {
  let bytes2 = 0;
  for (const buffer of buffers) bytes2 += buffer.byteLength;
  return bytes2;
}

// js/render/remote/projection-state.ts
function copyWatermark(value) {
  return { ...value, scope: { ...value.scope } };
}
function watermark(batch) {
  return {
    scope: { ...batch.scope },
    subscriptionId: batch.subscriptionId,
    streamGeneration: batch.streamGeneration,
    sequence: batch.sequence,
    systemRevision: batch.systemRevision
  };
}
function sameScope(a, b) {
  return a.worldId === b.worldId && a.shardId === b.shardId && a.systemId === b.systemId && a.ownerEpoch === b.ownerEpoch && a.recoveryGeneration === b.recoveryGeneration;
}

// js/render/remote/playback-correction.ts
function matchesPlaybackBaseline(a, b) {
  return !!b && sameScope(a.scope, b.scope) && a.subscriptionId === b.subscriptionId && a.streamGeneration === b.streamGeneration && a.sequence === b.sequence && a.systemRevision === b.systemRevision;
}
function validatePlaybackCorrection(value) {
  const b = value.baseline, s = b.scope;
  if (![s.worldId, s.shardId, s.systemId, b.subscriptionId].every(isOpaqueId)) throw new Error("Invalid playback identity");
  for (const n of [s.ownerEpoch, s.recoveryGeneration, b.streamGeneration, b.systemRevision, value.sequence]) {
    if (typeof n !== "bigint" || n <= 0n || n > 0xffffffffffffffffn) throw new Error("Invalid playback generation");
  }
  if (typeof b.sequence !== "bigint" || b.sequence < 0n || b.sequence > 0xffffffffffffffffn) throw new Error("Invalid playback baseline");
  validateServerClock(value.clock);
}

// js/network/playback-corrections.ts
function createPlaybackCorrections(options) {
  let pending;
  let timer, serial = 0n, sequence = 0n, last = -Infinity, closed = false;
  function clear() {
    clearTimeout(timer);
    timer = void 0;
    pending = void 0;
  }
  return {
    refresh() {
      const baseline = options.baseline(), now = options.now();
      if (closed || pending || !baseline || !Number.isFinite(now) || now - last < 5e3 || serial === 0xffffffffffffffffn) return;
      const id2 = ++serial;
      last = now;
      pending = { id: id2, sentAt: now, baseline };
      const expire = () => {
        if (pending?.id === id2) clear();
      };
      timer = setTimeout(expire, 2e3);
      void options.send(makeRequest(baseline, id2)).catch(expire);
    },
    receive(value) {
      const request = pending;
      if (closed || !request || request.id !== value.requestId || value.sequence <= sequence) return;
      const at = options.now(), elapsed = at - request.sentAt;
      if (!(elapsed >= 0 && elapsed < 2e3)) {
        clear();
        return;
      }
      const scope2 = value.scope, cursor2 = value.baseline;
      const baseline = {
        scope: {
          worldId: opaqueIdAt(scope2.worldId),
          shardId: opaqueIdAt(scope2.shardId),
          systemId: opaqueIdAt(scope2.systemId),
          ownerEpoch: scope2.ownerEpoch,
          recoveryGeneration: scope2.recoveryGeneration
        },
        subscriptionId: opaqueIdAt(cursor2.subscriptionId),
        streamGeneration: cursor2.generation,
        sequence: cursor2.sequence,
        systemRevision: value.systemRevision
      };
      if (!matchesPlaybackBaseline(baseline, request.baseline) || !matchesPlaybackBaseline(baseline, options.baseline())) return;
      clear();
      sequence = value.sequence;
      options.apply({ baseline, sequence, clock: {
        serverMs: value.serverTimeMs,
        monotonicMs: at,
        timeOriginMs: options.timeOriginMs,
        roundTripMs: elapsed
      } });
    },
    inspect: () => ({ pending: !!pending, sequence }),
    dispose() {
      closed = true;
      clear();
    }
  };
}
function makeRequest(b, requestId) {
  return create(PlaybackClockRequestSchema, {
    scope: {
      worldId: opaqueIdBytes(b.scope.worldId),
      shardId: opaqueIdBytes(b.scope.shardId),
      systemId: opaqueIdBytes(b.scope.systemId),
      ownerEpoch: b.scope.ownerEpoch,
      recoveryGeneration: b.scope.recoveryGeneration
    },
    baseline: { subscriptionId: opaqueIdBytes(b.subscriptionId), generation: b.streamGeneration, sequence: b.sequence },
    systemRevision: b.systemRevision,
    requestId
  });
}

// js/render/remote/correction-sender.ts
function createCorrectionSender(port, generation) {
  let pending, active = 0, serial = 0, closed = false;
  function flush() {
    if (closed || active || !pending) return;
    if (serial === Number.MAX_SAFE_INTEGER) {
      pending = void 0;
      return;
    }
    const correction = pending;
    pending = void 0;
    active = ++serial;
    port.postMessage({ type: "playbackCorrection", connectionGeneration: generation, ticket: active, correction });
  }
  function receive({ data }) {
    if (data?.type !== "playbackConsumed" || data.connectionGeneration !== generation || !active || data.ticket !== active) return;
    active = 0;
    flush();
  }
  port.addEventListener("message", receive);
  return {
    send(value) {
      if (closed) return;
      validatePlaybackCorrection(value);
      pending = value;
      flush();
    },
    inspect: () => ({ active: Number(!!active), pending: Number(!!pending) }),
    dispose() {
      closed = true;
      pending = void 0;
      active = 0;
      port.removeEventListener("message", receive);
    }
  };
}

// js/network/limits.ts
var MAX_MESSAGE_BYTES = 256 * 1024;
var MAX_TOPOLOGY_BYTES = 2 * 1024 * 1024;
var MAX_TOPOLOGY_CLUSTERS = 256;
var MAX_TOPOLOGY_SYSTEMS = 4096;
var MAX_TOPOLOGY_CONNECTIONS = 16384;

// js/network/framing.ts
function frameMessage(payload) {
  if (payload.byteLength < 1 || payload.byteLength > MAX_MESSAGE_BYTES) throw new RangeError("Invalid network frame length");
  const frame = new Uint8Array(payload.byteLength + 4);
  new DataView(frame.buffer).setUint32(0, payload.byteLength, true);
  frame.set(payload, 4);
  return frame;
}
function unframeMessage(frame) {
  if (frame.byteLength < 5 || frame.byteLength > MAX_TOPOLOGY_BYTES + 4) throw new RangeError("Invalid network frame length");
  const size = new DataView(frame).getUint32(0, true);
  if (size !== frame.byteLength - 4) throw new Error("WebSocket message must contain exactly one complete frame");
  return new Uint8Array(frame, 4);
}
function boundedChunk(value, maxBytes) {
  if (value.byteLength === 0 || value.byteLength > maxBytes || value.buffer.byteLength > maxBytes) throw new Error("Transport read chunk budget exceeded");
  return value;
}
function createFrameReader(reader, maxChunkBytes) {
  let chunk = new Uint8Array(0);
  let offset = 0;
  let ended = false;
  async function exact(size, allowEof) {
    const target = new Uint8Array(size);
    let written = 0;
    while (written < size) {
      if (offset === chunk.byteLength) {
        const result = await reader.read();
        if (result.done) {
          ended = true;
          break;
        }
        chunk = boundedChunk(result.value, maxChunkBytes);
        offset = 0;
      }
      const count = Math.min(size - written, chunk.byteLength - offset);
      target.set(chunk.subarray(offset, offset + count), written);
      offset += count;
      written += count;
    }
    if (written === size) return target;
    if (allowEof && written === 0) return null;
    throw new Error("Truncated reliable network frame");
  }
  return {
    async receive() {
      if (ended) return null;
      const header = await exact(4, true);
      if (!header) return null;
      const size = new DataView(header.buffer, header.byteOffset, 4).getUint32(0, true);
      if (size < 1 || size > MAX_TOPOLOGY_BYTES) throw new RangeError("Invalid network frame length");
      return exact(size, false);
    }
  };
}

// js/network/validate-fields.ts
function check(condition, field) {
  if (!condition) throw new Error(`Invalid protocol ${field}`);
}
function present(value, field) {
  check(value !== void 0, field);
  return value;
}
function id(bytes2) {
  check(bytes2.byteLength === 16 && bytes2.some((byte) => byte !== 0), "identity");
}
function token(bytes2) {
  check(bytes2.byteLength > 0 && bytes2.byteLength <= 4096, "credential length");
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
  check(Number.isFinite(item.x) && Number.isFinite(item.z), "local position");
}
function cursor(value) {
  const item = present(value, "stream cursor");
  id(item.subscriptionId);
  check(item.generation > 0n, "stream generation");
}
function ship(value) {
  id(value.shipId);
  position(value.position);
  if (!value.movement) return;
  if (value.movement.orderId.byteLength) id(value.movement.orderId);
  position(value.movement.from);
  position(value.movement.to);
  check(value.movement.arrivalServerMs > value.movement.departureServerMs, "movement deadline");
}

// js/network/validate-strategic.ts
function u64(value, positive) {
  check(value >= (positive ? 1n : 0n) && value <= 0xffffffffffffffffn, "strategic version/time");
}
function unique(ids) {
  check(ids.length <= 32, "strategic system limit");
  const seen = /* @__PURE__ */ new Set();
  for (const bytes2 of ids) {
    id(bytes2);
    const key2 = bytes2.join(",");
    check(!seen.has(key2), "duplicate strategic system");
    seen.add(key2);
  }
}
function validateSubscribeStrategic(value) {
  id(value.worldId);
  id(value.subscriptionId);
  u64(value.interestGeneration, true);
  check(Number.isInteger(value.requestedEncoding) && value.requestedEncoding >= 0 && value.requestedEncoding <= 2147483647, "strategic encoding");
  unique(value.systemIds);
}
function row(value, world) {
  scope(value.scope);
  const authority = present(value.scope, "summary authority");
  check(authority.worldId.every((byte, index) => byte === world[index]), "summary world");
  u64(authority.ownerEpoch, true);
  u64(authority.recoveryGeneration, true);
  counts(value.availability, value.counts);
}
function counts(availability, value) {
  if (availability === 2) {
    check(value === void 0, "unavailable counts");
    return;
  }
  check(availability === 1, "summary availability");
  const item = present(value, "available counts");
  u64(item.systemRevision, true);
  u64(item.committedServerTimeMs, false);
  check(Number.isInteger(item.presentShips) && Number.isInteger(item.movingShips), "summary integer counts");
  check(item.movingShips >= 0 && item.movingShips <= item.presentShips && item.presentShips <= 16384, "summary counts");
}
function compact(view) {
  check(view.groups.length <= 32, "strategic group limit");
  const seen = /* @__PURE__ */ new Set();
  for (const group of view.groups) {
    id(group.shardId);
    u64(group.ownerEpoch, true);
    u64(group.recoveryGeneration, true);
    check(group.systems.length > 0 && group.systems.length <= 32, "strategic group rows");
    for (const item of group.systems) {
      id(item.systemId);
      const key2 = item.systemId.join(",");
      check(!seen.has(key2), "duplicate strategic system");
      seen.add(key2);
      check(seen.size <= 32, "strategic system limit");
      counts(item.availability, item.counts);
    }
  }
}
function validateStrategicSystems(value) {
  id(value.worldId);
  id(value.subscriptionId);
  u64(value.interestGeneration, true);
  u64(value.sequence, true);
  if (value.result.case === "rejected") {
    const reason = value.result.value.reason;
    check(Number.isInteger(reason) && reason > 0 && reason <= 2147483647, "strategic rejection");
    return;
  }
  if (value.result.case === "compactView") {
    compact(value.result.value);
    return;
  }
  check(value.result.case === "view", "strategic result");
  const rows = value.result.value.systems;
  unique(rows.map((item) => present(item.scope, "summary authority").systemId));
  for (const item of rows) row(item, value.worldId);
}

// js/network/validate-client.ts
function hello(value) {
  check(value.minimumProtocolVersion > 0 && value.minimumProtocolVersion <= 1 && value.maximumProtocolVersion >= 1, "protocol version range");
  check(value.supportedRuleVersions.length <= 16 && value.supportedRuleVersions.includes(1), "rule versions");
  check(value.requiredCapabilities.length <= 16, "capabilities length");
  for (const capability of value.requiredCapabilities) check(capability >= 1 && capability <= 10, "required capability");
  token(value.sessionCredential);
}
function move(value) {
  key(value.key);
  scope(value.scope);
  id(value.shipId);
  position(value.target);
  token(value.admissionToken);
  if (value.expectedSystemRevision !== void 0) {
    check(value.expectedSystemRevision >= 0n && value.expectedSystemRevision <= 0xffffffffffffffffn, "expected revision");
  }
}
function subscribe(value) {
  id(value.worldId);
  id(value.systemId);
  id(value.subscriptionId);
  if (!value.resumeAfter) return;
  cursor(value.resumeAfter);
  check(value.subscriptionId.every((byte, index) => value.resumeAfter?.subscriptionId[index] === byte), "resume subscription");
}
function transfer(value) {
  key(value.key);
  scope(value.scope);
  id(value.shipId);
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
      id(body.value.receiptHomeShardId);
      check(body.value.requestId > 0n, "renewal request identity");
      break;
    case "playbackClock":
      scope(body.value.scope);
      cursor(body.value.baseline);
      check(body.value.requestId > 0n && body.value.systemRevision > 0n, "playback request");
      break;
    case "subscribe":
      subscribe(body.value);
      break;
    case "subscribeStrategic":
      validateSubscribeStrategic(body.value);
      break;
    default:
      throw new Error("Client message has no supported operation");
  }
}

// js/network/topology.ts
var utf8 = new TextEncoder();
function identifier(value) {
  id(value);
  return opaqueIdAt(value);
}
function point(value) {
  const p = present(value, "strategic position");
  check(Number.isFinite(p.x) && Number.isFinite(p.z), "strategic position");
}
function unique2(set, value) {
  const key2 = identifier(value);
  check(!set.has(key2), "duplicate topology identity");
  set.add(key2);
  return key2;
}
function validateTopology(value) {
  id(value.worldId);
  check(value.revision > 0n, "topology revision");
  check(value.clusters.length <= MAX_TOPOLOGY_CLUSTERS && value.systems.length <= MAX_TOPOLOGY_SYSTEMS && value.connections.length <= MAX_TOPOLOGY_CONNECTIONS, "topology budget");
  const clusters = /* @__PURE__ */ new Set();
  const systems = /* @__PURE__ */ new Set();
  const edges = /* @__PURE__ */ new Set();
  for (const cluster of value.clusters) {
    unique2(clusters, cluster.clusterId);
    point(cluster.position);
    check(utf8.encode(cluster.name).length <= 64 && Number.isFinite(cluster.radius) && cluster.radius > 0, "cluster metadata");
  }
  for (const system of value.systems) {
    unique2(systems, system.systemId);
    point(system.position);
    check(clusters.has(identifier(system.clusterId)), "missing topology cluster");
    check(utf8.encode(system.name).length <= 64, "system name");
  }
  for (const edge of value.connections) validateEdge(edge.systemA, edge.systemB, systems, edges);
  const hosted = /* @__PURE__ */ new Set();
  check(value.hostedSystemIds.length <= MAX_TOPOLOGY_SYSTEMS, "hosted system budget");
  for (const system of value.hostedSystemIds) check(systems.has(unique2(hosted, system)), "hosted system outside visible topology");
}
function validateEdge(first, second, systems, edges) {
  const a = identifier(first);
  const b = identifier(second);
  check(a !== b && systems.has(a) && systems.has(b), "invalid topology edge");
  const key2 = a < b ? `${a}:${b}` : `${b}:${a}`;
  check(!edges.has(key2), "duplicate topology edge");
  edges.add(key2);
}
function topologyView(value) {
  return {
    worldId: opaqueIdAt(value.worldId),
    revision: value.revision,
    hostedSystemIds: value.hostedSystemIds.map(identifier),
    clusters: value.clusters.map((c) => ({ id: opaqueIdAt(c.clusterId), name: c.name, x: c.position.x, z: c.position.z, radius: c.radius })),
    systems: value.systems.map((s) => ({ id: opaqueIdAt(s.systemId), clusterId: opaqueIdAt(s.clusterId), name: s.name, x: s.position.x, z: s.position.z })),
    connections: value.connections.map((c) => ({ a: opaqueIdAt(c.systemA), b: opaqueIdAt(c.systemB) }))
  };
}

// js/network/validate-server.ts
function welcome(value, generation) {
  check(value.protocolVersion === 1 && value.ruleVersion === 1, "welcome version");
  check(value.connectionGeneration === generation, "welcome generation");
  id(value.playerId);
  id(value.worldId);
  check(value.capabilities.length <= 16 && value.admissions.length <= 16, "welcome limits");
  for (const capability of value.capabilities) check(capability > 0, "capability");
  for (const grant of value.admissions) admissionGrant(grant);
}
function admissionGrant(grant) {
  id(grant.receiptHomeShardId);
  check(grant.generation > 0n && grant.notAfterServerMs > 0n, "admission grant");
  token(grant.token);
}
function admissionRenewed(value) {
  id(value.receiptHomeShardId);
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
function snapshot(value) {
  scope(value.scope);
  cursor(value.cursor);
  id(value.snapshotId);
  check(value.chunkCount > 0 && value.chunkCount <= 4096, "snapshot chunks");
  check(value.chunkIndex < value.chunkCount, "snapshot index");
  check(value.ships.length <= 256, "snapshot ships");
  for (const item of value.ships) ship(item);
}
function delta(value) {
  scope(value.scope);
  cursor(value.cursor);
  check(value.systemRevision > value.baseSystemRevision, "delta revision");
  check(value.upserts.length + value.removedShipIds.length <= 256, "delta changes");
  for (const item of value.upserts) ship(item);
  for (const removed of value.removedShipIds) id(removed);
}
function envelope(message) {
  if (message.protocolVersion === 0 && message.connectionGeneration === 0n && message.body.case === "failure") return;
  check(message.protocolVersion === 1 && message.connectionGeneration > 0n, "session envelope");
}
function validateServerMessage(message) {
  envelope(message);
  const body = message.body;
  switch (body.case) {
    case "welcome":
      welcome(body.value, message.connectionGeneration);
      break;
    case "receipt":
      receipt(body.value);
      break;
    case "admissionRenewed":
      admissionRenewed(body.value);
      break;
    case "snapshot":
      snapshot(body.value);
      break;
    case "delta":
      delta(body.value);
      break;
    case "topology":
      validateTopology(body.value);
      break;
    case "strategic":
      validateStrategicSystems(body.value);
      break;
    case "playbackClock":
      scope(body.value.scope);
      cursor(body.value.baseline);
      check(body.value.requestId > 0n && body.value.systemRevision > 0n && body.value.sequence > 0n && body.value.serverTimeMs > 0n, "playback correction");
      break;
    case "failure":
      check(body.value.code > 0, "protocol failure");
      break;
    default:
      throw new Error("Server message has no supported operation");
  }
}

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
function checkDecodeBudget(schema, bytes2) {
  const budget = { fields: MAX_FIELDS, messages: MAX_MESSAGES, bytes: bytes2.length, strategicRows: 0, repeated: /* @__PURE__ */ new Map() };
  scan(new BinaryReader(bytes2), schema, bytes2.length, 0, budget);
  if (bytes2.length > MAX_MESSAGE_BYTES && !budget.topology) throw new Error("Protocol ordinary message size exceeded");
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
    serverBodyBudget(schema, number, budget.bytes);
    if (field) countField(field, wire, budget);
    scanValue(reader, field, wire, end, depth, budget);
  }
  if (reader.pos !== end) throw new Error("Protocol nested message crosses its boundary");
}
function messageBudget(schema, budget) {
  if (schema.typeName !== "galaxy.v1.WorldTopology") return budget;
  return budget.topology ?? (budget.topology = {
    fields: 128 * 1024,
    messages: 32 * 1024,
    bytes: budget.bytes,
    strategicRows: 0,
    repeated: /* @__PURE__ */ new Map()
  });
}
function serverBodyBudget(schema, number, bytes2) {
  if (schema.typeName !== "galaxy.v1.ServerMessage" || number === 15) return;
  if (number >= 10 && number <= 18 && bytes2 > MAX_MESSAGE_BYTES) throw new Error("Protocol ordinary server message size exceeded");
}
function enclosingBudget(name, bytes2) {
  if ((name === "galaxy.v1.SubscribeStrategic" || name === "galaxy.v1.StrategicSystems") && bytes2 > 8192) {
    throw new Error("Protocol strategic enclosing message budget exceeded");
  }
  if ((name === "galaxy.v1.PlaybackClockCorrection" || name === "galaxy.v1.PlaybackClockRequest") && bytes2 + 4 > 1200) {
    throw new Error("Playback correction exceeds 1200 framed bytes");
  }
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
function strategicRowLimit(budget) {
  if (++budget.strategicRows > 32) throw new Error("Protocol strategic row expansion budget exceeded");
  return 32;
}
function repeatedLimit(field, budget) {
  if (field.parent.typeName === "galaxy.v1.WorldTopology") return topologyLimit(field.number);
  switch (field.parent.typeName) {
    case "galaxy.v1.DiagnosticBatch":
      return 16;
    // Its only list is diagnostic spans.
    case "galaxy.v1.SubscribeStrategic":
      return 32;
    // Its only list is system IDs.
    case "galaxy.v1.StrategicSystemView":
      return strategicRowLimit(budget);
    case "galaxy.v1.CompactStrategicView":
      return 32;
    // Its only list is authority groups.
    case "galaxy.v1.StrategicAuthorityGroup":
      return strategicRowLimit(budget);
    default:
      return MAX_REPEATED;
  }
}
function topologyLimit(number) {
  if (number === 3) return MAX_TOPOLOGY_CLUSTERS;
  if (number === 5) return MAX_TOPOLOGY_CONNECTIONS;
  return MAX_TOPOLOGY_SYSTEMS;
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
function bounded(bytes2) {
  if (bytes2.byteLength === 0 || bytes2.byteLength > MAX_MESSAGE_BYTES) {
    throw new RangeError(`Protocol message length must be 1..${MAX_MESSAGE_BYTES}`);
  }
  return bytes2;
}
function encodeClientMessage(message) {
  validateClientMessage(message);
  const bytes2 = bounded(toBinary(ClientMessageSchema, message));
  if (message.body.case === "subscribeStrategic" && bytes2.byteLength > 8192) throw new RangeError("Strategic message exceeds 8 KiB");
  if (message.body.case === "playbackClock" && bytes2.byteLength + 4 > 1200) throw new RangeError("Playback request exceeds 1200 framed bytes");
  return bytes2;
}
function decodeServerMessage(bytes2) {
  if (bytes2.byteLength === 0 || bytes2.byteLength > MAX_TOPOLOGY_BYTES) throw new RangeError("Protocol server message length exceeded");
  checkDecodeBudget(ServerMessageSchema, bytes2);
  const message = fromBinary(ServerMessageSchema, bytes2);
  if (message.body.case !== "topology") bounded(bytes2);
  validateServerMessage(message);
  return message;
}

// js/render/remote/transfer-port.ts
function validStreamOptions(generation, maxBytes, maxBatches) {
  for (const value of [generation, maxBytes, maxBatches]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError("Stream budgets and generation must be positive safe integers");
  }
}

// js/render/remote/transfer-sender.ts
function validReturnedBuffers(value, bytes2) {
  if (!Array.isArray(value) || value.length > 7) return false;
  if (new Set(value).size !== value.length || !value.every((buffer) => buffer instanceof ArrayBuffer)) return false;
  return bufferBytes(value) === bytes2;
}
function createProjectionSender(port, options) {
  const maxBytes = options.maxBytes ?? MAX_STREAM_BYTES;
  const maxBatches = options.maxBatches ?? MAX_STREAM_BATCHES;
  validStreamOptions(options.generation, maxBytes, maxBatches);
  const pending = /* @__PURE__ */ new Map();
  let inFlightBytes = 0;
  let ticket = 0;
  let closed = false;
  function dispose() {
    if (closed) return;
    closed = true;
    port.removeEventListener("message", onMessage);
    port.removeEventListener("messageerror", onMessageError);
    port.close();
    pending.clear();
    inFlightBytes = 0;
  }
  function fail(error) {
    if (closed) return;
    dispose();
    options.onError(error instanceof Error ? error : new Error(String(error)));
  }
  function onMessageError() {
    fail(new Error("Projection credit could not be deserialized"));
  }
  function onMessage(event2) {
    const message = event2.data;
    if (closed || message?.type !== "released" || message.connectionGeneration !== options.generation) return;
    const bytes2 = pending.get(message.ticket);
    if (bytes2 === void 0) return;
    const buffers = message.buffers;
    if (!validReturnedBuffers(buffers, bytes2)) {
      fail(new Error("Invalid returned projection buffers"));
      return;
    }
    pending.delete(message.ticket);
    inFlightBytes -= bytes2;
    try {
      options.onReturned?.(buffers);
    } catch (error) {
      fail(error);
    }
  }
  port.addEventListener("message", onMessage);
  port.addEventListener("messageerror", onMessageError);
  port.start();
  return {
    /** False means backpressured: caller still owns every input buffer. */
    send(batch) {
      if (closed) throw new Error("Projection stream is closed");
      const buffers = projectionBuffers(batch);
      const bytes2 = bufferBytes(buffers);
      if (bytes2 > maxBytes) throw new RangeError("Projection batch exceeds stream byte budget");
      if (pending.size >= maxBatches || inFlightBytes + bytes2 > maxBytes) return false;
      if (ticket === Number.MAX_SAFE_INTEGER) throw new Error("Projection stream ticket space exhausted");
      const packet = { type: "projection", connectionGeneration: options.generation, ticket: ++ticket, batch };
      pending.set(ticket, bytes2);
      inFlightBytes += bytes2;
      try {
        port.postMessage(packet, buffers);
      } catch (error) {
        fail(error);
        throw error;
      }
      return true;
    },
    inspect: () => ({ closed, inFlightBytes, inFlightBatches: pending.size }),
    dispose
  };
}

// js/network/session-contracts.ts
var SESSION_LIMITS = {
  readBytes: MAX_TOPOLOGY_BYTES + 1024 * 1024,
  readFrames: 16,
  sendBytes: 1024 * 1024,
  sendFrames: 32,
  pendingProjectionBytes: 1024 * 1024,
  pendingProjectionBatches: 64,
  pendingCommands: 128,
  handshakeMs: 5e3,
  receiptMs: 1e4,
  snapshotMs: 5e3
};

// js/network/projection-output.ts
function createProjectionOutput(port, generation, onError, onIdle) {
  let queue = [];
  let head = 0;
  let bytes2 = 0;
  let disposed = false;
  const sender = createProjectionSender(port, { generation, onError, onReturned: flush });
  function flush() {
    while (!disposed && head < queue.length) {
      const batch = queue[head];
      const size = bufferBytes(projectionBuffers(batch));
      if (!sender.send(batch)) return;
      bytes2 -= size;
      queue[head++] = void 0;
      if (head >= SESSION_LIMITS.pendingProjectionBatches) {
        queue = queue.slice(head);
        head = 0;
      }
    }
    if (head === queue.length) {
      queue = [];
      head = 0;
    }
    if (!disposed && head === queue.length && sender.inspect().inFlightBatches === 0) onIdle?.();
  }
  return {
    enqueue(batch) {
      if (disposed) throw new Error("Projection output disposed");
      const size = bufferBytes(projectionBuffers(batch));
      if (bytes2 + size > SESSION_LIMITS.pendingProjectionBytes || queue.length - head >= SESSION_LIMITS.pendingProjectionBatches) throw new Error("Render consumer is too slow; projection queue budget exceeded");
      queue.push(batch);
      bytes2 += size;
      flush();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      queue = [];
      head = 0;
      bytes2 = 0;
      sender.dispose();
    },
    inspect: () => ({ ...sender.inspect(), queuedBatches: queue.length - head, queuedBytes: bytes2 })
  };
}

// js/network/system-stream.ts
function scopeKey(scope2) {
  return [opaqueIdAt(scope2.worldId), opaqueIdAt(scope2.shardId), opaqueIdAt(scope2.systemId), scope2.ownerEpoch, scope2.recoveryGeneration].join(":");
}
function createSystemStream(subscription, requestSnapshot) {
  let baseline;
  let snapshot2;
  let resyncPending = false;
  function scoped(scope2, cursor2) {
    if (opaqueIdAt(cursor2.subscriptionId) !== subscription.subscriptionId) return false;
    if (opaqueIdAt(scope2.worldId) !== subscription.worldId || opaqueIdAt(scope2.systemId) !== subscription.systemId) throw new Error("Server projection is outside the subscribed system");
    return true;
  }
  function resync(cursor2) {
    if (resyncPending) return;
    resyncPending = true;
    requestSnapshot(cursor2);
  }
  function begin(chunk) {
    if (chunk.chunkCount > 64) throw new Error("Snapshot chunk budget exceeded");
    return {
      scope: scopeKey(chunk.scope),
      generation: chunk.cursor.generation,
      sequence: chunk.cursor.sequence,
      revision: chunk.systemRevision,
      id: opaqueIdAt(chunk.snapshotId),
      count: chunk.chunkCount,
      next: 0,
      bytes: 0,
      entities: 0,
      ids: /* @__PURE__ */ new Set()
    };
  }
  function checkSnapshot(chunk, current, encodedBytes) {
    if (scopeKey(chunk.scope) !== current.scope || chunk.cursor.sequence !== current.sequence || chunk.systemRevision !== current.revision || opaqueIdAt(chunk.snapshotId) !== current.id || chunk.chunkCount !== current.count) throw new Error("Snapshot metadata changed between chunks");
    current.bytes += encodedBytes;
    current.entities += chunk.ships.length;
    if (current.bytes > MAX_SNAPSHOT_BYTES || current.entities > MAX_SNAPSHOT_ENTITIES) throw new Error("Snapshot aggregate budget exceeded");
    for (const ship2 of chunk.ships) {
      const id2 = opaqueIdAt(ship2.shipId);
      if (current.ids.has(id2)) throw new Error("Duplicate ship in snapshot");
      current.ids.add(id2);
    }
  }
  function snapshotFor(chunk) {
    const generation = chunk.cursor.generation;
    const latest = snapshot2 ?? baseline;
    if (latest && generation < latest.generation) return void 0;
    if (!snapshot2 && baseline && generation === baseline.generation) return void 0;
    if (snapshot2 && generation === snapshot2.generation) return snapshot2;
    if (chunk.chunkIndex !== 0) {
      resync();
      return void 0;
    }
    snapshot2 = begin(chunk);
    return snapshot2;
  }
  function deltaBaseline(delta2) {
    const latest = snapshot2 ?? baseline;
    if (latest && delta2.cursor.generation < latest.generation) return void 0;
    if (snapshot2 || !baseline) {
      resync();
      return void 0;
    }
    if (delta2.cursor.generation !== baseline.generation || scopeKey(delta2.scope) !== baseline.scope) {
      resync();
      return void 0;
    }
    return baseline;
  }
  return {
    snapshot(chunk, encodedBytes) {
      const cursor2 = chunk.cursor;
      if (!scoped(chunk.scope, cursor2)) return false;
      const current = snapshotFor(chunk);
      if (!current || chunk.chunkIndex < current.next) return false;
      if (chunk.chunkIndex !== current.next) {
        resync();
        return false;
      }
      checkSnapshot(chunk, current, encodedBytes);
      current.next++;
      if (current.next === current.count) {
        baseline = { scope: current.scope, generation: current.generation, sequence: current.sequence, revision: current.revision };
        snapshot2 = void 0;
        resyncPending = false;
      }
      return true;
    },
    delta(delta2) {
      const cursor2 = delta2.cursor;
      if (!scoped(delta2.scope, cursor2)) return false;
      const current = deltaBaseline(delta2);
      if (!current || cursor2.sequence <= current.sequence) return false;
      if (cursor2.sequence !== current.sequence + 1n || delta2.baseSystemRevision !== current.revision) {
        resync({ ...cursor2, sequence: current.sequence });
        return false;
      }
      baseline = { scope: current.scope, generation: cursor2.generation, sequence: cursor2.sequence, revision: delta2.systemRevision };
      resyncPending = false;
      return true;
    },
    inspect: () => ({ baseline, snapshotPending: !!snapshot2, resyncPending })
  };
}

// js/network/projection-pack.ts
function allocate(count, removed) {
  const buffer = new ArrayBuffer(count * 73 + removed.length * 16);
  return {
    ids: new Uint8Array(buffer, 0, count * 16),
    revisions: new BigUint64Array(buffer, count * 16, count),
    positions: new Float64Array(buffer, count * 24, count * 2),
    targets: new Float64Array(buffer, count * 40, count * 2),
    times: new BigUint64Array(buffer, count * 56, count * 2),
    moving: new Uint8Array(buffer, count * 72, count),
    removedIds: new Uint8Array(buffer, count * 73, removed.length * 16)
  };
}
function packRows(ships, removed) {
  const columns = allocate(ships.length, removed);
  for (let i = 0; i < ships.length; i++) {
    const ship2 = ships[i];
    const from = ship2.movement?.from ?? ship2.position;
    const target = ship2.movement?.to ?? ship2.position;
    columns.ids.set(ship2.shipId, i * 16);
    columns.revisions[i] = ship2.revision;
    columns.positions.set([from.x, from.z], i * 2);
    columns.targets.set([target.x, target.z], i * 2);
    if (ship2.movement) {
      columns.times[i * 2] = ship2.movement.departureServerMs;
      columns.times[i * 2 + 1] = ship2.movement.arrivalServerMs;
      columns.moving[i] = 1;
    }
  }
  for (let i = 0; i < removed.length; i++) columns.removedIds.set(removed[i], i * 16);
  return columns;
}
function metadata(scope2, cursor2) {
  return {
    layoutVersion: 1,
    scope: { worldId: opaqueIdAt(scope2.worldId), shardId: opaqueIdAt(scope2.shardId), systemId: opaqueIdAt(scope2.systemId), ownerEpoch: scope2.ownerEpoch, recoveryGeneration: scope2.recoveryGeneration },
    subscriptionId: opaqueIdAt(cursor2.subscriptionId),
    streamGeneration: cursor2.generation,
    sequence: cursor2.sequence
  };
}
function packSnapshot(chunk) {
  return {
    ...metadata(chunk.scope, chunk.cursor),
    ...packRows(chunk.ships, []),
    baseSystemRevision: chunk.systemRevision,
    systemRevision: chunk.systemRevision,
    snapshot: { id: opaqueIdAt(chunk.snapshotId), index: chunk.chunkIndex, count: chunk.chunkCount }
  };
}
function packDelta(delta2) {
  return {
    ...metadata(delta2.scope, delta2.cursor),
    ...packRows(delta2.upserts, delta2.removedShipIds),
    baseSystemRevision: delta2.baseSystemRevision,
    systemRevision: delta2.systemRevision
  };
}

// js/network/command-tracker.ts
function commandIdentity(key2) {
  return `${opaqueIdAt(key2.receiptHomeShardId)}:${key2.admissionGeneration}:${opaqueIdAt(key2.commandId)}`;
}
function createCommandTracker(emit) {
  const pending = /* @__PURE__ */ new Map();
  function unknown2(identity) {
    const item = pending.get(identity);
    if (!item) return;
    pending.delete(identity);
    clearTimeout(item.timer);
    emit({ type: "unknown", requestId: item.requestId, key: item.key });
  }
  return {
    async beforeSend(requestId, command) {
      if (!requestId || requestId.length > 128) throw new Error("Invalid command request ID");
      const key2 = command.key;
      const identity = commandIdentity(key2);
      if (pending.has(identity)) throw new Error("Command is already pending; query its original receipt home");
      if (pending.size >= SESSION_LIMITS.pendingCommands) throw new Error("Pending command budget exceeded");
      const timer = setTimeout(() => unknown2(identity), SESSION_LIMITS.receiptMs);
      const item = { requestId, key: key2, timer };
      pending.set(identity, item);
      await emit({ type: "pending", requestId, command: structuredClone(command) });
      if (pending.get(identity) !== item) throw new Error("Command preparation expired before submission");
    },
    receipt(receipt2) {
      const identity = commandIdentity(receipt2.key);
      const item = pending.get(identity);
      if (item) {
        clearTimeout(item.timer);
        pending.delete(identity);
      }
      emit({ type: "receipt", receipt: receipt2 });
    },
    dispose() {
      for (const identity of pending.keys()) unknown2(identity);
    },
    inspect: () => pending.size
  };
}

// js/network/session-clock.ts
function createSessionClock(now, timeOriginMs) {
  let anchor;
  return {
    sample(serverMs, sentAt) {
      const monotonicMs = now();
      anchor = { serverMs, monotonicMs, timeOriginMs, roundTripMs: Math.max(0, monotonicMs - sentAt) };
      return anchor;
    },
    serverNow() {
      if (!anchor) throw new Error("Server clock is not initialized");
      const elapsed = Math.max(0, now() - anchor.monotonicMs);
      if (!Number.isSafeInteger(Math.floor(elapsed))) throw new Error("Server clock observation is outside its safe interval");
      return anchor.serverMs + BigInt(Math.floor(elapsed));
    },
    anchor() {
      if (!anchor) throw new Error("Server clock is not initialized");
      return anchor;
    }
  };
}

// js/network/messages.ts
function hello2(credential, options = {}) {
  if (credential.byteLength !== 32) throw new Error("Provisioned session credential must contain 32 bytes");
  return create(ClientMessageSchema, { body: { case: "hello", value: {
    minimumProtocolVersion: 1,
    maximumProtocolVersion: 1,
    supportedRuleVersions: [1],
    requiredCapabilities: [
      1,
      2,
      ...options.discovery ? [3] : [],
      ...options.ownedProjection ? [4] : [],
      ...options.transfers ? [5] : [],
      ...options.diagnostics ? [6] : [],
      ...options.renewAdmissions ? [7] : [],
      ...options.strategic ? [8] : []
    ],
    sessionCredential: credential
  } } });
}
function clientMessage(generation, body) {
  return create(ClientMessageSchema, { protocolVersion: 1, connectionGeneration: generation, body });
}
function subscribeMessage(generation, subscription, resumeAfter) {
  return create(ClientMessageSchema, { protocolVersion: 1, connectionGeneration: generation, body: { case: "subscribe", value: {
    worldId: opaqueIdBytes(subscription.worldId),
    systemId: opaqueIdBytes(subscription.systemId),
    subscriptionId: opaqueIdBytes(subscription.subscriptionId),
    resumeAfter
  } } });
}
function moveCommand(control, scope2, admissions, serverNow) {
  const grant = admission(scope2, admissions, serverNow);
  return create(MoveCommandSchema, {
    key: { commandId: opaqueIdBytes(control.commandId), receiptHomeShardId: grant.receiptHomeShardId, admissionGeneration: grant.generation },
    scope: scope2,
    shipId: opaqueIdBytes(control.shipId),
    target: control.target,
    expectedSystemRevision: control.expectedSystemRevision,
    admissionToken: grant.token
  });
}
function transferCommand(control, scope2, admissions, serverNow) {
  const grant = admission(scope2, admissions, serverNow);
  return create(TransferCommandSchema, {
    key: { commandId: opaqueIdBytes(control.commandId), receiptHomeShardId: grant.receiptHomeShardId, admissionGeneration: grant.generation },
    scope: scope2,
    shipId: opaqueIdBytes(control.shipId),
    destinationSystemId: opaqueIdBytes(control.destinationSystemId),
    destinationPosition: control.target,
    expectedSystemRevision: control.expectedSystemRevision,
    admissionToken: grant.token
  });
}
function admission(scope2, admissions, serverNow) {
  const grant = admissions.find((item) => opaqueIdAt(item.receiptHomeShardId) === opaqueIdAt(scope2.shardId) && item.notAfterServerMs >= serverNow);
  if (!grant) throw new Error("No current command admission grant for this receipt home");
  return grant;
}

// js/network/frame-inbox.ts
function createFrameInbox(maxBytes, maxFrames) {
  let frames = [];
  let head = 0;
  let bytes2 = 0;
  let closed = false;
  let failure;
  let waiter;
  return {
    push(frame) {
      if (closed) return;
      if (waiter) {
        const pending = waiter;
        waiter = void 0;
        pending.resolve(frame);
        return;
      }
      if (bytes2 + frame.byteLength > maxBytes || frames.length - head >= maxFrames) throw new Error("Network receive queue budget exceeded");
      frames.push(frame);
      bytes2 += frame.byteLength;
    },
    receive() {
      if (waiter) return Promise.reject(new Error("Concurrent transport receive is unsupported"));
      if (failure) return Promise.reject(failure);
      if (closed) return Promise.resolve(null);
      if (head < frames.length) {
        const frame = frames[head];
        frames[head++] = void 0;
        bytes2 -= frame.byteLength;
        if (head >= maxFrames || head === frames.length) {
          frames = frames.slice(head);
          head = 0;
        }
        return Promise.resolve(frame);
      }
      return new Promise((resolve, reject) => {
        waiter = { resolve, reject };
      });
    },
    close(error) {
      if (closed) return;
      closed = true;
      failure = error;
      frames = [];
      head = 0;
      bytes2 = 0;
      if (error) waiter?.reject(error);
      else waiter?.resolve(null);
      waiter = void 0;
    }
  };
}

// js/network/websocket-transport.ts
async function connectWebSocket(url, signal) {
  if (signal.aborted) throw new Error("Network connection aborted");
  const socket = new WebSocket(url);
  socket.binaryType = "arraybuffer";
  const inbox = createFrameInbox(SESSION_LIMITS.readBytes, SESSION_LIMITS.readFrames);
  let stopped = false;
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  function stop(error = new Error("WebSocket session closed")) {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    inbox.close(error);
    rejectReady(error);
    socket.close();
  }
  function onAbort() {
    stop(new Error("Network connection aborted"));
  }
  const timer = setTimeout(() => stop(new Error("WebSocket establishment timed out")), SESSION_LIMITS.handshakeMs);
  signal.addEventListener("abort", onAbort, { once: true });
  socket.onopen = () => {
    clearTimeout(timer);
    resolveReady();
  };
  socket.onerror = () => stop(new Error("WebSocket transport failed"));
  socket.onclose = () => stop();
  socket.onmessage = ({ data }) => {
    try {
      if (!(data instanceof ArrayBuffer)) throw new Error("Network WebSocket requires binary frames");
      inbox.push(unframeMessage(data));
    } catch (error) {
      stop(error instanceof Error ? error : new Error(String(error)));
    }
  };
  await ready;
  if (signal.aborted || stopped) throw new Error("Network connection aborted");
  return {
    kind: "websocket",
    receive: inbox.receive,
    async send(payload) {
      if (stopped || socket.readyState !== WebSocket.OPEN) throw new Error("WebSocket is closed");
      const frame = frameMessage(payload);
      if (socket.bufferedAmount + frame.byteLength > SESSION_LIMITS.sendBytes) throw new Error("WebSocket send budget exceeded");
      socket.send(frame);
    },
    close: () => stop()
  };
}

// js/network/webtransport-transport.ts
async function connectWebTransport(endpoints, signal) {
  if (signal.aborted) throw new Error("Network connection aborted");
  const serverCertificateHashes = endpoints.certificateHashes?.map((hash) => ({ algorithm: hash.algorithm, value: new Uint8Array(hash.value) }));
  const session = new WebTransport(endpoints.webTransportUrl, { serverCertificateHashes });
  let reader;
  let datagrams;
  let writer;
  let stopped = false;
  let rejectAbort;
  const aborted = new Promise((_, reject) => {
    rejectAbort = reject;
  });
  void aborted.catch(() => {
  });
  function close() {
    if (stopped) return;
    stopped = true;
    signal.removeEventListener("abort", onAbort);
    rejectAbort(new Error("WebTransport connection aborted"));
    if (datagrams) void datagrams.cancel().catch(() => {
    }).finally(() => datagrams?.releaseLock());
    if (reader) void reader.cancel().catch(() => {
    }).finally(() => reader?.releaseLock());
    if (writer) void writer.abort().catch(() => {
    }).finally(() => writer?.releaseLock());
    session.close();
  }
  function onAbort() {
    close();
  }
  signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(close, SESSION_LIMITS.handshakeMs);
  void session.closed.then(close, close);
  try {
    await Promise.race([session.ready, aborted]);
    const opening = session.createBidirectionalStream().then((stream2) => {
      if (stopped) discardStream(stream2);
      return stream2;
    });
    const stream = await Promise.race([opening, aborted]);
    if (stopped || signal.aborted) {
      discardStream(stream);
      throw new Error("WebTransport connection aborted");
    }
    reader = stream.readable.getReader();
    writer = stream.writable.getWriter();
    session.datagrams.incomingHighWaterMark = 1;
    session.datagrams.incomingMaxAge = 2e3;
    datagrams = session.datagrams.readable.getReader();
    return {
      ...createConnectedTransport(reader, writer, close, () => stopped),
      async receiveDatagram() {
        const item = await datagrams.read();
        return item.done ? null : item.value;
      }
    };
  } catch (error) {
    close();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
function discardStream(stream) {
  void stream.readable.cancel().catch(() => {
  });
  void stream.writable.abort().catch(() => {
  });
}
function createConnectedTransport(reader, writer, close, stopped) {
  const framing = createFrameReader(reader, SESSION_LIMITS.readBytes);
  let queuedBytes = 0;
  let queuedFrames = 0;
  let tail = Promise.resolve();
  return {
    kind: "webtransport",
    receive: framing.receive,
    close,
    send(payload) {
      if (stopped()) return Promise.reject(new Error("WebTransport is closed"));
      const frame = frameMessage(payload);
      if (queuedBytes + frame.byteLength > SESSION_LIMITS.sendBytes || queuedFrames >= SESSION_LIMITS.sendFrames) return Promise.reject(new Error("WebTransport send budget exceeded"));
      queuedBytes += frame.byteLength;
      queuedFrames++;
      const sending = tail.then(async () => {
        if (stopped()) throw new Error("WebTransport is closed");
        await writer.ready;
        await writer.write(frame);
      }).finally(() => {
        queuedBytes -= frame.byteLength;
        queuedFrames--;
      });
      tail = sending.catch(() => {
        close();
      });
      return sending;
    }
  };
}

// js/network/transport.ts
function validateEndpoints(endpoints) {
  const ws = new URL(endpoints.webSocketUrl);
  if (ws.protocol !== "wss:" && !(ws.protocol === "ws:" && loopback(ws))) throw new Error("WebSocket requires WSS outside loopback");
  if (!endpoints.webTransportUrl) return;
  const wt = new URL(endpoints.webTransportUrl);
  if (wt.protocol !== "https:") throw new Error("WebTransport requires HTTPS");
  if (endpoints.certificateHashes?.length && !loopback(wt)) throw new Error("Explicit certificate hashes are limited to loopback fixtures");
  validatePins(endpoints);
}
function loopback(url) {
  return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}
function validatePins(endpoints) {
  const pins = endpoints.certificateHashes ?? [];
  if (pins.length > 2) throw new Error("Certificate pin budget exceeded");
  for (const pin of pins) {
    if (pin.algorithm !== "sha-256" || pin.value.byteLength !== 32) throw new Error("Certificate pins must be 32-byte SHA-256 hashes");
  }
}
var connectTransport = async (endpoints, signal) => {
  validateEndpoints(endpoints);
  if (endpoints.webTransportUrl && typeof WebTransport !== "undefined") {
    try {
      return await connectWebTransport(endpoints, signal);
    } catch (error) {
      if (signal.aborted) throw error;
    }
  }
  return connectWebSocket(endpoints.webSocketUrl, signal);
};

// js/features/fleets/domain/contracts.ts
var MAX_RULE_SEED_SHIPS = 256;

// js/network/owned-projection.ts
function row2(ship2) {
  const move2 = ship2.movement;
  const base = { id: opaqueIdAt(ship2.shipId), revision: ship2.revision, x: ship2.position.x, z: ship2.position.z };
  if (!move2) return { ...base, targetX: base.x, targetZ: base.z, moving: false, departureMs: 0n, arrivalMs: 0n, transferReadyMs: ship2.transferReadyServerMs };
  const orderId = opaqueIdAt(move2.orderId);
  opaqueIdBytes(orderId);
  return {
    ...base,
    targetX: move2.to.x,
    targetZ: move2.to.z,
    moving: true,
    orderId,
    departureMs: move2.departureServerMs,
    arrivalMs: move2.arrivalServerMs,
    transferReadyMs: ship2.transferReadyServerMs
  };
}
function change(rows, ships, removed) {
  for (const id2 of removed) rows.delete(opaqueIdAt(id2));
  for (const ship2 of ships) {
    if (ship2.controllable) rows.set(opaqueIdAt(ship2.shipId), row2(ship2));
    else rows.delete(opaqueIdAt(ship2.shipId));
    if (rows.size > MAX_SNAPSHOT_ENTITIES) throw new Error("Owned projection entity budget exceeded");
  }
}
function requireTime(value) {
  if (value === void 0) throw new Error("Owned rule seed needs authoritative committed time");
  return value;
}
function sameWatermark(a, b) {
  return sameScope(a.scope, b.scope) && a.subscriptionId === b.subscriptionId && a.streamGeneration === b.streamGeneration && a.sequence === b.sequence && a.systemRevision === b.systemRevision;
}
function createOwnedProjection(connectionGeneration, playerId) {
  let current;
  let staged;
  return {
    snapshot(value, watermark2) {
      const time = requireTime(value.committedTimeMs);
      if (value.chunkIndex === 0) staged = { rows: /* @__PURE__ */ new Map(), watermark: copyWatermark(watermark2), committedTimeMs: time };
      if (!staged || staged.committedTimeMs !== time) throw new Error("Owned snapshot metadata changed");
      change(staged.rows, value.ships, []);
      if (value.chunkIndex + 1 === value.chunkCount) {
        current = staged;
        staged = void 0;
      }
    },
    delta(value, watermark2) {
      const time = requireTime(value.committedTimeMs);
      if (!current || staged || time < current.committedTimeMs) throw new Error("Owned delta has no valid current baseline");
      change(current.rows, value.upserts, value.removedShipIds);
      current.watermark = copyWatermark(watermark2);
      current.committedTimeMs = time;
    },
    page(query, serverNowMs) {
      if (!current || staged) throw new Error("Owned ships need a complete current snapshot");
      const required = query.required;
      if (required && (required.connectionGeneration !== connectionGeneration || !sameWatermark(required.watermark, current.watermark))) {
        throw new Error("Owned ship page belongs to a different projection revision");
      }
      const { rows, nextOffset } = select(current.rows, query);
      const seed = pack(rows, current, connectionGeneration, playerId);
      return {
        seed,
        ships: rows.map(({ id: id2, revision, x, z, targetX, targetZ, moving }) => ({ id: id2, revision, x, z, targetX, targetZ, moving })),
        nextOffset,
        total: current.rows.size,
        serverNowMs
      };
    },
    dispose() {
      current = void 0;
      staged = void 0;
    },
    inspect: () => ({ currentRows: current?.rows.size ?? 0, stagedRows: staged?.rows.size ?? 0 })
  };
}
function select(all, query) {
  if (query.shipId) {
    const ship2 = all.get(query.shipId);
    if (!ship2) throw new Error("Ship is outside the owned projection");
    return { rows: [ship2], nextOffset: null };
  }
  const offset = query.offset ?? 0;
  const limit = query.limit ?? 64;
  pageBounds(offset, limit, all.size);
  if (offset > 0 && !query.required) throw new Error("Later owned pages require the original revision");
  const rows = pageRows(all, offset, limit);
  const next = offset + rows.length;
  return { rows, nextOffset: next < all.size ? next : null };
}
function pageRows(all, offset, limit) {
  const rows = [];
  let index = 0;
  for (const ship2 of all.values()) {
    if (index++ < offset) continue;
    rows.push(ship2);
    if (rows.length === limit) break;
  }
  return rows;
}
function pageBounds(offset, limit, total) {
  if (!Number.isInteger(offset) || offset < 0 || offset > total || !Number.isInteger(limit) || limit < 1 || limit > MAX_RULE_SEED_SHIPS) {
    throw new Error("Owned ship page budget exceeded");
  }
}
function pack(rows, state, generation, playerId) {
  const n = rows.length;
  const bytes2 = new ArrayBuffer(n * 112);
  const identities = new Uint8Array(bytes2, 0, n * 48);
  const revisions = new BigUint64Array(bytes2, n * 48, n);
  const positions = new Float64Array(bytes2, n * 56, n * 4);
  const times = new BigUint64Array(bytes2, n * 88, n * 3);
  const owner = opaqueIdBytes(playerId);
  rows.forEach((ship2, i) => {
    identities.set(opaqueIdBytes(ship2.id), i * 48);
    identities.set(owner, i * 48 + 16);
    if (ship2.orderId) identities.set(opaqueIdBytes(ship2.orderId), i * 48 + 32);
    revisions[i] = ship2.revision;
    positions.set([ship2.x, ship2.z, ship2.moving ? ship2.targetX : 0, ship2.moving ? ship2.targetZ : 0], i * 4);
    times.set([ship2.departureMs, ship2.arrivalMs, ship2.transferReadyMs], i * 3);
  });
  return {
    token: { connectionGeneration: generation, watermark: copyWatermark(state.watermark) },
    playerId,
    ruleVersion: 1,
    committedTimeMs: state.committedTimeMs,
    identities,
    revisions,
    positions,
    times
  };
}

// js/worker/bus/service-validation.ts
function contextCopy(value) {
  if (!value) return;
  if (!/^(?!0{32}$)[0-9a-f]{32}$/.test(value.traceId) || !validSpan(value.spanId)) throw new Error("Invalid trace context");
  if (value.parentSpanId !== void 0 && !validSpan(value.parentSpanId)) throw new Error("Invalid parent span");
  if (value.traceFlags !== void 0 && (!Number.isInteger(value.traceFlags) || value.traceFlags < 0 || value.traceFlags > 255)) throw new Error("Invalid trace flags");
  return { traceId: value.traceId, spanId: value.spanId, parentSpanId: value.parentSpanId, traceFlags: value.traceFlags };
}
function validSpan(value) {
  return /^(?!0{16}$)[0-9a-f]{16}$/.test(value);
}

// js/debug/bus/context.ts
function randomHex(bytes2) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes2)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function childContext(parent) {
  return { traceId: parent.traceId, spanId: randomHex(8), parentSpanId: parent.spanId, traceFlags: parent.traceFlags };
}

// js/debug/game-stages.ts
var GAME_STAGES = [
  { id: "ui.intent", service: "online-ui", source: "js/main/online-entry.ts" },
  { id: "network.command", service: "network", source: "js/network/session.ts" },
  { id: "gateway.command", service: "gateway", source: "crates/server/src/session/mod.rs" },
  { id: "system.command", service: "system", source: "crates/server/src/system/actor.rs" },
  { id: "storage.queue", service: "storage", source: "crates/server/src/executor/worker.rs" },
  { id: "storage.commit", service: "storage", source: "crates/server/src/executor/decisions.rs" },
  { id: "peer.forward", service: "placement", source: "crates/server/src/placement/peer/home.rs" },
  { id: "network.projection", service: "network", source: "js/network/session.ts" },
  { id: "render.apply", service: "render", source: "js/render/remote/runtime-projection.ts" }
];

// js/debug/worker-traces.ts
var STAGES = new Set(GAME_STAGES.map((stage) => stage.id));
var MAX_SPANS = 256;
var ID = /^(?!0{32}$)[0-9a-f]{32}$/;
var CODES = /* @__PURE__ */ new Set([
  "accepted",
  "committed",
  "queued",
  "rejected",
  "unauthorized",
  "invalid_target",
  "stale_revision",
  "wrong_owner",
  "identity_conflict",
  "admission_expired",
  "busy",
  "not_found",
  "expired",
  "recovery_required",
  "storage_error",
  "unavailable",
  "peer_error",
  "canceled",
  "unknown",
  "submission_failed",
  "projection_apply",
  "projection_pack"
]);
function validTiming(span) {
  return [span.startedMs, span.durationMs, span.startedMs + span.durationMs].every((value) => Number.isFinite(value) && value >= 0);
}
var emptyTraces = () => ({ kind: "diagnostics", clocks: [], spans: [], dropped: 0 });
function projectionTrace(value) {
  try {
    const context = contextCopy(value?.context);
    if (!context || !(context.traceFlags & 1) || !ID.test(value.commandId)) return;
    return { context, commandId: value.commandId };
  } catch {
    return;
  }
}
function workerClock(owner) {
  return { id: `${owner}:${crypto.randomUUID()}`, originUnixMs: performance.timeOrigin, uncertaintyMs: 1 };
}
function createWorkerTraces(clock, now = () => performance.now()) {
  const clocks = /* @__PURE__ */ new Map([[clock.id, { ...clock }]]);
  let ring = [], cursor2 = 0, dropped = 0;
  function record(span) {
    try {
      const trace = projectionTrace({ context: span.context, commandId: span.commandId });
      if (!trace || !STAGES.has(span.stage) || !clocks.has(span.clockId)) throw new Error("Invalid trace identity");
      if (!validTiming(span)) throw new Error("Invalid local duration");
      if (!["ok", "error", "unknown"].includes(span.status) || span.code !== void 0 && !CODES.has(span.code)) throw new Error("Invalid trace status");
      const copy = {
        stage: span.stage,
        context: trace.context,
        commandId: trace.commandId,
        clockId: span.clockId,
        startedMs: span.startedMs,
        durationMs: span.durationMs,
        status: span.status,
        code: span.code
      };
      if (ring.length === MAX_SPANS) dropped++;
      ring[cursor2++ % MAX_SPANS] = copy;
    } catch {
      dropped++;
    }
  }
  function begin(stage, parent) {
    try {
      const trace = projectionTrace(parent);
      if (!trace) return;
      const context = childContext(trace.context), startedMs = now();
      let ended = false;
      return {
        context,
        commandId: trace.commandId,
        finish(status, code) {
          if (ended) return;
          ended = true;
          try {
            record({
              stage,
              context,
              commandId: trace.commandId,
              clockId: clock.id,
              startedMs,
              durationMs: now() - startedMs,
              status,
              code
            });
          } catch {
            dropped++;
          }
        }
      };
    } catch {
      dropped++;
      return;
    }
  }
  return {
    begin,
    record,
    nativeClock(id2) {
      if (!/^native:[a-zA-Z0-9_-]{1,64}$/.test(id2) || !clocks.has(id2) && clocks.size >= 32) {
        dropped++;
        return false;
      }
      clocks.set(id2, { id: id2 });
      return true;
    },
    drop(count = 1) {
      if (Number.isSafeInteger(count) && count > 0) dropped += count;
    },
    take() {
      const spans = cursor2 < MAX_SPANS ? ring : ring.slice(cursor2 % MAX_SPANS).concat(ring.slice(0, cursor2 % MAX_SPANS));
      const value = { kind: "diagnostics", clocks: Array.from(clocks.values(), (value2) => ({ ...value2 })), spans, dropped };
      ring = [];
      cursor2 = 0;
      dropped = 0;
      return value;
    }
  };
}

// js/network/diagnostics.ts
var hex2 = (bytes2) => Array.from(bytes2, (byte) => byte.toString(16).padStart(2, "0")).join("");
var bytes = (value) => Uint8Array.from(value.match(/../g), (part) => Number.parseInt(part, 16));
function wireTrace(context) {
  try {
    const value = contextCopy(context);
    if (!value || !(value.traceFlags & 1)) return;
    return {
      $typeName: "galaxy.v1.TraceContext",
      traceId: bytes(value.traceId),
      spanId: bytes(value.spanId),
      parentSpanId: value.parentSpanId ? bytes(value.parentSpanId) : new Uint8Array(),
      traceFlags: value.traceFlags
    };
  } catch {
    return;
  }
}
function localContext(value) {
  if (!value || value.traceId.length !== 16 || value.spanId.length !== 8 || ![0, 8].includes(value.parentSpanId.length)) return;
  return contextCopy({
    traceId: hex2(value.traceId),
    spanId: hex2(value.spanId),
    parentSpanId: value.parentSpanId.length ? hex2(value.parentSpanId) : void 0,
    traceFlags: value.traceFlags
  });
}
function localProjectionTrace(value) {
  try {
    if (value?.commandId.byteLength !== 16) return;
    const context = localContext(value?.context);
    return context && projectionTrace({ context, commandId: opaqueIdAt(value.commandId) });
  } catch {
    return;
  }
}
function collectNativeTraces(traces, batch) {
  if (!batch) return;
  if (batch.spans.length > 16) {
    traces.drop();
    return;
  }
  traces.drop(batch.dropped);
  for (const value of batch.spans) collectSpan(traces, value);
}
function collectSpan(traces, value) {
  try {
    if (value.commandId.byteLength !== 16) {
      traces.drop();
      return;
    }
    const context = localContext(value.context);
    if (!context || value.startedUs > BigInt(Number.MAX_SAFE_INTEGER) || value.durationUs > BigInt(Number.MAX_SAFE_INTEGER) || !traces.nativeClock(value.clockId)) {
      traces.drop();
      return;
    }
    const status = value.status === 1 ? "ok" : value.status === 2 ? "error" : "unknown";
    traces.record({
      stage: value.stage,
      context,
      clockId: value.clockId,
      startedMs: Number(value.startedUs) / 1e3,
      durationMs: Number(value.durationUs) / 1e3,
      status,
      code: value.code || void 0,
      commandId: opaqueIdAt(value.commandId)
    });
  } catch {
    traces.drop();
  }
}

// js/debug/projection-progress.ts
function progressCursor(value) {
  if (!value) return;
  return {
    ...value.scope,
    subscriptionId: value.subscriptionId,
    ownerEpoch: String(value.scope.ownerEpoch),
    recoveryGeneration: String(value.scope.recoveryGeneration),
    streamGeneration: String(value.streamGeneration),
    sequence: String(value.sequence),
    systemRevision: String(value.systemRevision)
  };
}

// js/network/admission-renewal.ts
var EARLY_MS = 5 * 6e4;
var RETRY_MS = 3e4;
var RESPONSE_MS = 5e3;
function copyGrant(value) {
  return {
    $typeName: "galaxy.v1.AdmissionGrant",
    receiptHomeShardId: value.receiptHomeShardId.slice(),
    generation: value.generation,
    notAfterServerMs: value.notAfterServerMs,
    token: value.token.slice()
  };
}
function createAdmissionRenewal(options) {
  const homes = /* @__PURE__ */ new Map();
  let pending, timer;
  let nextId = 0n, closed = false;
  function home(id2) {
    let value = homes.get(id2);
    if (!value) {
      if (homes.size >= 16) throw new Error("Admission home capacity exceeded");
      value = { id: id2, retryAt: 0 };
      homes.set(id2, value);
    }
    return value;
  }
  for (const grant of options.grants) home(opaqueIdAt(grant.receiptHomeShardId)).grant = copyGrant(grant);
  function usable(value) {
    return !!value.grant && value.grant.notAfterServerMs >= options.serverNow();
  }
  function dueAt(value) {
    const remaining = value.grant ? value.grant.notAfterServerMs - options.serverNow() : 0n;
    const delay = Number(remaining > BigInt(EARLY_MS) ? remaining - BigInt(EARLY_MS) : 0n);
    return Math.max(value.retryAt, options.now() + Math.min(delay, 2147483647));
  }
  function arm() {
    clearTimeout(timer);
    timer = void 0;
    if (closed || pending || !homes.size) return;
    let selected, due = Infinity;
    for (const value of homes.values()) {
      const at = dueAt(value);
      if (at < due) {
        selected = value;
        due = at;
      }
    }
    timer = setTimeout(() => {
      timer = void 0;
      void refresh(selected);
    }, Math.max(0, due - options.now()));
  }
  function complete(attempt, retryMs) {
    if (pending !== attempt) return;
    clearTimeout(attempt.timer);
    pending = void 0;
    attempt.home.retryAt = options.now() + retryMs;
    attempt.finish();
    arm();
  }
  function refresh(value) {
    if (closed) return Promise.resolve();
    if (pending) return pending.promise;
    if (value.retryAt > options.now()) {
      arm();
      return Promise.resolve();
    }
    if (nextId === 0xffffffffffffffffn) {
      dispose();
      return Promise.resolve();
    }
    clearTimeout(timer);
    timer = void 0;
    let finish;
    const promise = new Promise((resolve) => {
      finish = resolve;
    });
    const attempt = {
      home: value,
      id: ++nextId,
      sentAt: options.now(),
      promise,
      finish,
      timer: setTimeout(() => complete(attempt, RETRY_MS), RESPONSE_MS)
    };
    pending = attempt;
    void options.send(value.id, attempt.id).catch(() => complete(attempt, RETRY_MS));
    return promise;
  }
  function receive(value) {
    const attempt = pending;
    if (!attempt || value.requestId !== attempt.id || opaqueIdAt(value.receiptHomeShardId) !== attempt.home.id) return false;
    options.sample(value.serverTimeMs, attempt.sentAt);
    retainGrant(attempt.home, value.grant);
    const retry = value.retryAfterMs || (usable(attempt.home) && dueAt(attempt.home) > options.now() ? 0 : RETRY_MS);
    complete(attempt, retry);
    return true;
  }
  function retainGrant(value, grant) {
    if (!grant || grant.notAfterServerMs < options.serverNow()) return;
    if (value.grant && grant.notAfterServerMs < value.grant.notAfterServerMs) return;
    value.grant = copyGrant(grant);
    options.accept(value.grant);
  }
  async function ensure(id2) {
    if (closed) throw new Error("Admission renewal disposed");
    const value = home(id2);
    if (usable(value)) return;
    if (pending && pending.home !== value) await pending.promise;
    if (!closed && !usable(value)) await refresh(value);
    if (closed) throw new Error("Admission renewal disposed");
    if (!usable(value)) throw new Error("Command admission temporarily unavailable; try again shortly");
  }
  function expired(key2) {
    const value = homes.get(opaqueIdAt(key2.receiptHomeShardId));
    if (!value?.grant || value.grant.generation !== key2.admissionGeneration) return;
    value.grant = void 0;
    arm();
  }
  function dispose() {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    if (pending) {
      clearTimeout(pending.timer);
      pending.finish();
      pending = void 0;
    }
    homes.clear();
  }
  arm();
  return { ensure, receive, expired, dispose };
}

// js/network/strategic-contracts.ts
var STRATEGIC_PAGE_SIZE = 32;
function compareStrategic(a, b) {
  if (a.connectionGeneration !== b.connectionGeneration) return Math.sign(a.connectionGeneration - b.connectionGeneration);
  if (a.interestGeneration !== b.interestGeneration) return a.interestGeneration < b.interestGeneration ? -1 : 1;
  return a.sequence === b.sequence ? 0 : a.sequence < b.sequence ? -1 : 1;
}
function strategicDisposed(error) {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return error.code === "DISPOSED" || error.code === "CANCELED";
}

// js/network/strategic-rows.ts
function counts2(value) {
  return value && {
    systemRevision: value.systemRevision,
    committedServerTimeMs: value.committedServerTimeMs,
    presentShips: value.presentShips,
    movingShips: value.movingShips
  };
}
function legacyRow(value) {
  const scope2 = value.scope;
  return { scope: {
    worldId: opaqueIdAt(scope2.worldId),
    shardId: opaqueIdAt(scope2.shardId),
    systemId: opaqueIdAt(scope2.systemId),
    ownerEpoch: scope2.ownerEpoch,
    recoveryGeneration: scope2.recoveryGeneration
  }, counts: counts2(value.counts) };
}
function compactRows(view, worldId) {
  const result = [];
  for (const group of view.groups) {
    const shardId = opaqueIdAt(group.shardId);
    for (const value of group.systems) {
      result.push({ scope: {
        worldId,
        shardId,
        systemId: opaqueIdAt(value.systemId),
        ownerEpoch: group.ownerEpoch,
        recoveryGeneration: group.recoveryGeneration
      }, counts: counts2(value.counts) });
    }
  }
  return result;
}
function normalizeStrategicRows(message) {
  if (message.result.case === "view") return message.result.value.systems.map(legacyRow);
  if (message.result.case === "compactView") return compactRows(message.result.value, opaqueIdAt(message.worldId));
  return [];
}

// js/network/strategic-cache.ts
function canonical(ids) {
  if (ids.length > STRATEGIC_PAGE_SIZE) throw new Error("Strategic interest exceeds 32 systems");
  const result = ids.map((value) => opaqueIdAt(opaqueIdBytes(value))).sort();
  if (new Set(result).size !== result.length) throw new Error("Duplicate strategic system");
  return result;
}
function createStrategicCache(connectionGeneration, subscriptionId, changed) {
  let worldId = "";
  let ids = [];
  let closed = false;
  let requestedEncoding = 0;
  let value = { connectionGeneration, interestGeneration: 0n, sequence: 0n, status: "unavailable", systems: [] };
  function frontier() {
    return { connectionGeneration, interestGeneration: value.interestGeneration, sequence: value.sequence };
  }
  function initialize(id2, encoding = 0) {
    if (closed || worldId) throw new Error("Strategic connection was already initialized or closed");
    if (encoding !== 0 && encoding !== 1) throw new Error("Unsupported strategic encoding");
    worldId = opaqueIdAt(opaqueIdBytes(id2));
    requestedEncoding = encoding;
  }
  function replace(interest) {
    if (closed || !worldId || interest.connectionGeneration !== connectionGeneration) throw new Error("Strategic connection is unavailable");
    if (interest.interestGeneration <= 0n || interest.interestGeneration > 0xffffffffffffffffn) throw new Error("Invalid strategic generation");
    const next = canonical(interest.systemIds);
    if (interest.interestGeneration < value.interestGeneration) throw new Error("Obsolete strategic interest");
    if (interest.interestGeneration === value.interestGeneration && next.join() !== ids.join()) throw new Error("Strategic generation changed its systems");
    if (interest.interestGeneration > value.interestGeneration) {
      ids = next;
      value = { connectionGeneration, interestGeneration: interest.interestGeneration, sequence: 0n, status: "pending", systems: [] };
      changed(frontier());
    }
    return {
      worldId: opaqueIdBytes(worldId),
      subscriptionId: opaqueIdBytes(subscriptionId),
      interestGeneration: value.interestGeneration,
      systemIds: ids.map(opaqueIdBytes),
      requestedEncoding
    };
  }
  function receive(message) {
    if (closed || opaqueIdAt(message.worldId) !== worldId || opaqueIdAt(message.subscriptionId) !== subscriptionId) return;
    if (message.interestGeneration !== value.interestGeneration || message.sequence <= value.sequence) return;
    const systems = members(message);
    value = {
      ...frontier(),
      sequence: message.sequence,
      status: message.result.case === "rejected" ? "rejected" : "view",
      systems,
      rejectionReason: message.result.case === "rejected" ? message.result.value.reason : void 0
    };
    changed(frontier());
  }
  function members(message) {
    if (message.result.case === "rejected") return [];
    const expected = requestedEncoding === 1 ? "compactView" : "view";
    if (message.result.case !== expected) throw new Error("Strategic result changed requested encoding");
    const systems = normalizeStrategicRows(message);
    const actual = systems.map((item) => item.scope.systemId).sort();
    if (actual.join() !== ids.join() || systems.some((item) => item.scope.worldId !== worldId)) throw new Error("Strategic result changed requested membership");
    return systems;
  }
  return {
    replace,
    receive,
    initialize,
    snapshot() {
      if (closed) throw new Error("Strategic connection is unavailable");
      return structuredClone(value);
    },
    dispose() {
      closed = true;
      ids = [];
      value = { ...frontier(), status: "unavailable", systems: [] };
    }
  };
}

// js/network/session.ts
function requireCapabilities(value, bootstrap) {
  const required = [
    [true, 1, "Required negotiated"],
    [true, 2, "Required negotiated"],
    [!!bootstrap.discovery, 3, "Topology discovery"],
    [!!bootstrap.ownedProjection, 4, "Owned rule seed"],
    [!!bootstrap.transfers, 5, "Cross-system transfer"],
    [!!bootstrap.diagnostics, 6, "Diagnostics"],
    [!!bootstrap.renewAdmissions, 7, "Admission renewal"],
    [!!bootstrap.strategic, 8, "Strategic summaries"]
  ];
  for (const [enabled, capability, label] of required) {
    if (enabled && !value.capabilities.includes(capability)) throw new Error(`${label} capability is missing`);
  }
}
function createNetworkSession(options) {
  const { bootstrap, emit } = options;
  const controller = new AbortController();
  const now = options.now ?? (() => performance.now());
  const clock = createSessionClock(now, options.timeOriginMs ?? performance.timeOrigin);
  const commands = createCommandTracker(emit);
  const traces = bootstrap.diagnostics ? createWorkerTraces(workerClock("network"), now) : void 0;
  let transport;
  let welcome2;
  let scope2;
  let owned;
  let received;
  let renewal;
  let closed = false;
  let sentAt = 0;
  let handshakeTimer;
  let snapshotTimer;
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  void ready.catch(() => {
  });
  let corrections;
  const correctionOutput = createCorrectionSender(bootstrap.renderPort, bootstrap.generation);
  const output = createProjectionOutput(bootstrap.renderPort, bootstrap.generation, fail, () => corrections?.refresh());
  let subscription = bootstrap.subscription;
  let stream = subscription && createSystemStream(subscription, requestSnapshot);
  const strategic = bootstrap.strategic && createStrategicCache(
    bootstrap.generation,
    crypto.randomUUID().replace(/-/g, ""),
    (frontier) => {
      emit({ type: "strategic", frontier });
    }
  );
  function dispose(error = new Error("Network session disposed")) {
    if (closed) return;
    closed = true;
    clearTimeout(handshakeTimer);
    clearTimeout(snapshotTimer);
    corrections?.dispose();
    correctionOutput.dispose();
    controller.abort();
    renewal?.dispose();
    transport?.close();
    output.dispose();
    commands.dispose();
    owned?.dispose();
    if (strategic) strategic.dispose();
    rejectReady(error);
    emit({ type: "state", generation: bootstrap.generation, state: "closed" });
  }
  function fail(reason) {
    if (closed) return;
    const error = reason instanceof Error ? reason : new Error(String(reason));
    emit({ type: "error", message: error.message });
    dispose(error);
  }
  function snapshotDeadline() {
    if (snapshotTimer) return;
    snapshotTimer = setTimeout(() => fail(new Error("Snapshot/replay deadline exceeded")), SESSION_LIMITS.snapshotMs);
  }
  function requestSnapshot(resume) {
    if (!welcome2 || !subscription || closed) return;
    snapshotDeadline();
    emit({ type: "resync", reason: resume ? "stream gap: requested bounded replay" : "baseline changed: requested replacement snapshot" });
    void send(subscribeMessage(welcome2.connectionGeneration, subscription, resume)).catch(fail);
  }
  async function send(message) {
    if (closed || !transport) throw new Error("Network session is closed");
    await transport.send(encodeClientMessage(message));
  }
  function enableCorrections(value) {
    if (bootstrap.playbackCorrections && value.capabilities.includes(Capability.PLAYBACK_CLOCK_V1)) {
      corrections = createPlaybackCorrections({
        now,
        timeOriginMs: options.timeOriginMs ?? performance.timeOrigin,
        baseline: () => {
          const state = stream?.inspect();
          return state?.snapshotPending || state?.resyncPending ? void 0 : received;
        },
        send: (request) => send(clientMessage(value.connectionGeneration, { case: "playbackClock", value: request })),
        apply: correctionOutput.send
      });
    }
  }
  async function acceptWelcome(value) {
    if (welcome2) throw new Error("Repeated welcome on an active connection");
    if (subscription && opaqueIdAt(value.worldId) !== subscription.worldId) throw new Error("Welcome belongs to a different world");
    requireCapabilities(value, bootstrap);
    welcome2 = value;
    enableCorrections(value);
    if (strategic) strategic.initialize(
      opaqueIdAt(value.worldId),
      value.capabilities.includes(Capability.STRATEGIC_SYSTEMS_COMPACT_V1) ? StrategicEncoding.COMPACT_V1 : StrategicEncoding.UNSPECIFIED
    );
    if (bootstrap.ownedProjection) owned = createOwnedProjection(bootstrap.generation, opaqueIdAt(value.playerId));
    clearTimeout(handshakeTimer);
    emit({
      type: "welcome",
      generation: bootstrap.generation,
      playerId: opaqueIdAt(value.playerId),
      worldId: opaqueIdAt(value.worldId),
      connectionGeneration: value.connectionGeneration,
      clock: clock.sample(value.serverTimeMs, sentAt)
    });
    if (bootstrap.renewAdmissions) renewal = createAdmissionRenewal({
      grants: value.admissions,
      now,
      serverNow: clock.serverNow,
      sample: clock.sample,
      send: (home, requestId) => send(clientMessage(value.connectionGeneration, {
        case: "renewAdmission",
        value: { $typeName: "galaxy.v1.RenewAdmission", receiptHomeShardId: opaqueIdBytes(home), requestId }
      })),
      accept(grant) {
        const index = value.admissions.findIndex((item) => opaqueIdAt(item.receiptHomeShardId) === opaqueIdAt(grant.receiptHomeShardId));
        if (index < 0) value.admissions.push(grant);
        else value.admissions[index] = grant;
      }
    });
    if (bootstrap.discovery) {
      snapshotDeadline();
      return;
    }
    await beginSubscription();
  }
  async function beginSubscription() {
    await send(subscribeMessage(welcome2.connectionGeneration, subscription));
    if (closed) return;
    snapshotDeadline();
    resolveReady();
    emit({ type: "state", generation: bootstrap.generation, state: "ready", transport: transport.kind });
  }
  async function acceptTopology(value) {
    if (!bootstrap.discovery || subscription) throw new Error("Unexpected topology replacement");
    const topology = topologyView(value);
    if (topology.worldId !== opaqueIdAt(welcome2.worldId)) throw new Error("Topology belongs to a different world");
    const available = bootstrap.transfers || bootstrap.strategic ? topology.hostedSystemIds : topology.systems.map((system) => system.id);
    const systemId = bootstrap.discovery.preferredSystemId ?? available[0];
    if (!topology.systems.some((system) => system.id === systemId)) throw new Error("No permitted requested system in topology");
    if (!available.includes(systemId)) throw new Error("Requested system is served by another host");
    subscription = { worldId: topology.worldId, systemId, subscriptionId: bootstrap.discovery.subscriptionId };
    stream = createSystemStream(subscription, requestSnapshot);
    emit({ type: "topology", generation: bootstrap.generation, topology, subscription });
    await beginSubscription();
  }
  function projection(message, bytes2) {
    const parent = traces && localProjectionTrace(message.projectionTrace);
    const trace = traces?.begin("network.projection", parent);
    try {
      const batch = packProjection(message.body, bytes2);
      if (!batch) return;
      output.enqueue({ ...batch, clock: clock.anchor(), trace: trace && { context: trace.context, commandId: trace.commandId } });
      trace?.finish("ok");
      projectionReceived(batch);
    } catch (error) {
      trace?.finish("error", "projection_pack");
      throw error;
    }
  }
  function packProjection(body, bytes2) {
    if (!stream) throw new Error("Projection arrived before topology discovery");
    let batch;
    if (body.case === "snapshot") {
      if (!stream.snapshot(body.value, bytes2)) return;
      scope2 = body.value.scope;
      batch = packSnapshot(body.value);
      owned?.snapshot(body.value, watermark(batch));
    } else if (body.case === "delta") {
      if (!stream.delta(body.value)) return;
      batch = packDelta(body.value);
      owned?.delta(body.value, watermark(batch));
    } else {
      throw new Error("Unexpected projection body");
    }
    return batch;
  }
  function projectionReceived(batch) {
    const state = stream.inspect();
    received = watermark(batch);
    if (!state.snapshotPending && !state.resyncPending) {
      clearTimeout(snapshotTimer);
      snapshotTimer = void 0;
    }
    emit({
      type: "received",
      streamGeneration: batch.streamGeneration,
      sequence: batch.sequence,
      systemRevision: batch.systemRevision,
      snapshotComplete: !state.snapshotPending,
      watermark: received
    });
  }
  async function receive(message, bytes2) {
    if (welcome2 && message.connectionGeneration !== welcome2.connectionGeneration) return;
    if (message.body.case === "welcome") {
      await acceptWelcome(message.body.value);
      return;
    }
    if (message.body.case === "failure") throw new Error(`Server protocol failure (${message.body.value.code})`);
    if (!welcome2) throw new Error("Session data arrived before welcome");
    return receiveActive(message, bytes2);
  }
  function receiveActive(message, bytes2) {
    if (message.body.case === "playbackClock") {
      corrections?.receive(message.body.value);
      return;
    }
    if (message.body.case === "admissionRenewed") {
      acceptRenewal(message.body.value);
      return;
    }
    if (message.body.case === "strategic") {
      if (!strategic) throw new Error("Strategic summaries were not negotiated");
      strategic.receive(message.body.value);
      return;
    }
    if (traces) collectNativeTraces(traces, message.diagnostics);
    if (message.body.case === "topology") return acceptTopology(message.body.value);
    if (message.body.case === "receipt") acceptReceipt(message.body.value);
    else projection(message, bytes2);
  }
  function acceptReceipt(value) {
    if (value.result.case === "unknown" && value.result.value.reason === CommandUnknownReason.EXPIRED) renewal?.expired(value.key);
    commands.receipt(value);
  }
  function acceptRenewal(value) {
    if (!renewal) throw new Error("Admission renewal was not negotiated");
    renewal.receive(value);
  }
  function acceptDatagram(frame) {
    if (!corrections || frame.byteLength > 1200) return;
    try {
      const bytes2 = unframeMessage(frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength));
      const message = decodeServerMessage(bytes2);
      if (message.connectionGeneration === welcome2?.connectionGeneration && message.body.case === "playbackClock") corrections.receive(message.body.value);
    } catch {
    }
  }
  async function datagramLoop() {
    try {
      while (!closed) {
        const frame = await transport.receiveDatagram();
        if (closed || !frame) return;
        acceptDatagram(frame);
      }
    } catch {
    }
  }
  async function readLoop() {
    while (!closed) {
      const bytes2 = await transport.receive();
      if (closed) return;
      if (!bytes2) throw new Error("Network transport ended");
      await receive(decodeServerMessage(bytes2), bytes2.byteLength);
    }
  }
  async function start() {
    const greeting = hello2(bootstrap.credential, { ...bootstrap, discovery: !!bootstrap.discovery });
    validateSubscription();
    emit({ type: "state", generation: bootstrap.generation, state: "connecting" });
    const opened = await (options.transportFactory ?? connectTransport)(bootstrap.endpoints, controller.signal);
    if (closed) {
      opened.close();
      return;
    }
    transport = opened;
    sentAt = now();
    handshakeTimer = setTimeout(() => fail(new Error("Session welcome timed out")), SESSION_LIMITS.handshakeMs);
    await send(greeting);
    if (transport.receiveDatagram) void datagramLoop();
    await readLoop();
  }
  function validateSubscription() {
    if (bootstrap.strategic && !bootstrap.discovery) throw new Error("Strategic summaries require topology discovery");
    if (subscription) {
      opaqueIdBytes(subscription.worldId);
      opaqueIdBytes(subscription.systemId);
      opaqueIdBytes(subscription.subscriptionId);
    } else if (bootstrap.discovery) {
      opaqueIdBytes(bootstrap.discovery.subscriptionId);
      if (bootstrap.discovery.preferredSystemId) opaqueIdBytes(bootstrap.discovery.preferredSystemId);
    } else throw new Error("Explicit subscription or discovery is required");
  }
  async function control(message) {
    if (message.type === "disconnect" || message.type === "dispose") {
      dispose();
      return;
    }
    if (closed || !welcome2) throw new Error("Network session is not ready");
    if (message.type === "refreshPlayback") {
      corrections?.refresh();
      return;
    }
    if (message.type === "strategicInterest") {
      await replaceStrategic(message.interest);
      return;
    }
    if (message.type === "queryReceipt") {
      await queryReceipt(message);
      return;
    }
    await freshCommand(message);
  }
  async function freshCommand(message) {
    if (renewal && scope2 && message.type !== "retry") await renewal.ensure(opaqueIdAt(scope2.shardId));
    await submitCommand(message, prepareCommand(message));
  }
  async function submitCommand(message, command) {
    const trace = traces?.begin("network.command", message.context && { context: message.context, commandId: opaqueIdAt(command.key.commandId) });
    const envelope2 = commandEnvelope(command);
    envelope2.traceContext = wireTrace(trace?.context);
    const bytes2 = encodeClientMessage(envelope2);
    try {
      await commands.beforeSend(message.requestId, command);
      if (closed) throw new Error("Network session closed before submission");
      await transport.send(bytes2);
      trace?.finish("ok");
    } catch (error) {
      trace?.finish("error", "submission_failed");
      fail(error);
      throw error;
    }
  }
  async function queryReceipt(message) {
    const trace = traces?.begin("network.command", message.context && { context: message.context, commandId: opaqueIdAt(message.key.commandId) });
    const envelope2 = clientMessage(welcome2.connectionGeneration, { case: "receiptQuery", value: {
      $typeName: "galaxy.v1.ReceiptQuery",
      worldId: welcome2.worldId,
      key: message.key
    } });
    envelope2.traceContext = wireTrace(trace?.context);
    try {
      await send(envelope2);
      trace?.finish("ok");
    } catch (error) {
      trace?.finish("error", "submission_failed");
      throw error;
    }
  }
  function commandEnvelope(command) {
    const body = command.$typeName === "galaxy.v1.TransferCommand" ? { case: "transfer", value: command } : { case: "move", value: command };
    if (body.case === "transfer" && !bootstrap.transfers) throw new Error("Cross-system transfers were not negotiated");
    return clientMessage(welcome2.connectionGeneration, body);
  }
  function prepareCommand(message) {
    if (message.type === "retry") {
      const command = message.command.$typeName === "galaxy.v1.TransferCommand" ? create(TransferCommandSchema, message.command) : create(MoveCommandSchema, message.command);
      if (opaqueIdAt(command.scope.worldId) !== opaqueIdAt(welcome2.worldId)) throw new Error("Retry belongs to a different world");
      return command;
    }
    if (!scope2 || !stream || stream.inspect().snapshotPending) throw new Error("Move needs a complete system snapshot");
    return message.type === "transfer" ? transferCommand(message, scope2, welcome2.admissions, clock.serverNow()) : moveCommand(message, scope2, welcome2.admissions, clock.serverNow());
  }
  void start().catch(fail);
  function takeDiagnostics() {
    const queue = output.inspect();
    return { ...traces?.take() ?? emptyTraces(), progress: {
      owner: "network",
      connectionGeneration: bootstrap.generation,
      received: progressCursor(received),
      queuedBytes: queue.queuedBytes,
      queuedBatches: queue.queuedBatches,
      inFlightBytes: queue.inFlightBytes,
      inFlightBatches: queue.inFlightBatches
    } };
  }
  async function replaceStrategic(interest) {
    if (closed || !welcome2 || !strategic) throw new Error("Strategic summaries are not available");
    const value = strategic.replace(interest);
    await send(clientMessage(welcome2.connectionGeneration, { case: "subscribeStrategic", value: { $typeName: "galaxy.v1.SubscribeStrategic", ...value } }));
  }
  return {
    ready,
    control,
    dispose: () => dispose(),
    takeDiagnostics,
    replaceStrategic,
    strategicSnapshot() {
      if (!strategic) throw new Error("Strategic summaries were not negotiated");
      return strategic.snapshot();
    },
    ownedShips(query) {
      if (closed || !owned) throw new Error("Owned projection is not available");
      return owned.page(query, clock.serverNow());
    },
    inspect: () => ({
      closed,
      connectionGeneration: welcome2?.connectionGeneration,
      pendingCommands: commands.inspect(),
      projection: output.inspect(),
      stream: stream?.inspect(),
      owned: owned?.inspect()
    })
  };
}

// js/worker/protocol/services.ts
function descriptor(kind, id2, options) {
  const capacity = options.capacity ?? 128;
  const summary = options.summary ?? "none";
  validateDescriptor(id2, capacity, summary);
  return {
    id: id2,
    kind,
    priority: options.priority ?? 1,
    capacity,
    summary,
    ordered: options.ordered,
    bytes: options.bytes
  };
}
function validateDescriptor(id2, capacity, summary) {
  if (!id2 || id2.length > 128) throw new Error("Service contract requires a bounded ID");
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 1024) throw new Error("Invalid service capacity");
  if (summary.length > 128) throw new Error("Service summary policy must be bounded");
}
var defineCommand = (id2, options = {}) => descriptor("command", id2, options);
var defineQuery = (id2, options = {}) => descriptor("query", id2, options);
var defineEvent = (id2, options = {}) => descriptor("event", id2, options);
var defineStream = (id2) => descriptor("stream", id2, {});
var ShipOrders = {
  move: defineCommand("shipOrders.move", { ordered: "shipOrders", capacity: 128 }),
  transfer: defineCommand("shipOrders.transfer", { ordered: "shipOrders", capacity: 128 }),
  retry: defineCommand("shipOrders.retry", { ordered: "shipOrders", capacity: 128 }),
  receipt: defineQuery("shipOrders.receipt")
};
var ShipProjection = { batches: defineStream("shipProjection.batches") };
var FleetServices = {
  generate: defineCommand("fleets.generate", { ordered: "fleets" }),
  generateBulk: defineCommand("fleets.generateBulk", { ordered: "fleets" }),
  spawned: defineEvent("fleets.spawned", { ordered: "fleets" }),
  batch: defineEvent("fleets.batch", { ordered: "fleets" }),
  state: defineEvent("fleets.state", { ordered: "fleets" }),
  removed: defineEvent("fleets.removed", { ordered: "fleets" })
};

// js/network/service-contracts.ts
var event = (kind) => defineEvent(`network.${kind}`, { capacity: 128, ordered: "networkEvents" });
var NetworkEvents = {
  state: event("state"),
  welcome: event("welcome"),
  topology: event("topology"),
  receipt: event("receipt"),
  unknown: event("unknown"),
  received: event("received"),
  resync: event("resync"),
  error: event("error")
};
var OwnedShips = defineQuery("shipOrders.ownedShips", { capacity: 4 });
var NetworkPlayback = { refresh: defineCommand("network.playback.refresh", { capacity: 1 }) };
var NetworkDiagnostics = defineQuery("network.diagnostics", { capacity: 1 });
var RememberIntent = defineCommand("shipOrders.rememberIntent", { capacity: 128, ordered: "networkIntents" });

// js/network/service-requests.ts
function unknown(key2) {
  return create(MoveReceiptSchema, { key: key2, result: { case: "unknown", value: { reason: 3 } } });
}
function createServiceRequests(control) {
  const pending = /* @__PURE__ */ new Map();
  const keys = /* @__PURE__ */ new Map();
  let next = 0;
  let closed = false;
  function complete(requestId, value, error) {
    const item = pending.get(requestId);
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(requestId);
    if (item.identity && keys.get(item.identity) === requestId) keys.delete(item.identity);
    if (error) item.reject(error);
    else item.resolve(value);
  }
  function claim(requestId, key2) {
    const item = pending.get(requestId);
    if (!item) throw new Error("Receipt operation is no longer pending");
    const identity = commandIdentity(key2);
    const owner = keys.get(identity);
    if (owner && owner !== requestId) throw new Error("An operation for this command is already pending");
    if (item.identity && item.identity !== identity) throw new Error("Receipt operation changed its command key");
    keys.set(identity, requestId);
    item.key = key2;
    item.identity = identity;
  }
  function unresolved(requestId) {
    const item = pending.get(requestId);
    if (!item) return;
    if (item.key) complete(requestId, unknown(item.key));
    else complete(requestId, void 0, new Error("Session ended before command preparation"));
  }
  function observe(event2) {
    if (event2.type === "pending") {
      claim(event2.requestId, event2.command.key);
      return pending.get(event2.requestId)?.context;
    }
    if (event2.type === "unknown") {
      const context = pending.get(event2.requestId)?.context;
      unresolved(event2.requestId);
      return context;
    }
    if (event2.type === "state" && event2.state === "closed") {
      for (const id2 of pending.keys()) unresolved(id2);
    }
    if (event2.type === "receipt") return receipt2(event2.receipt);
  }
  function receipt2(value) {
    const id2 = keys.get(commandIdentity(value.key));
    if (!id2) return;
    const item = pending.get(id2);
    if (item.submitted) complete(id2, value);
    else item.receipt ?? (item.receipt = value);
    return item.context;
  }
  return {
    submit(factory, key2, context) {
      if (closed) return Promise.reject(new Error("Network receipt service is closed"));
      if (pending.size >= 128) return Promise.reject(new Error("Network service receipt capacity exceeded"));
      const requestId = `service-${++next}`;
      const result = new Promise((resolve, reject) => {
        pending.set(requestId, { key: key2, context, submitted: false, resolve, reject, timer: setTimeout(() => unresolved(requestId), 1e4) });
      });
      try {
        if (key2) claim(requestId, key2);
      } catch (error) {
        complete(requestId, void 0, error);
        return result;
      }
      void Promise.resolve().then(async () => {
        if (!pending.has(requestId)) return;
        await control({ ...factory(requestId), context });
        const item = pending.get(requestId);
        if (!item) return;
        item.submitted = true;
        if (item.receipt) complete(requestId, item.receipt);
      }).catch((error) => complete(requestId, void 0, error instanceof Error ? error : new Error(String(error))));
      return result;
    },
    observe,
    dispose() {
      closed = true;
      for (const id2 of pending.keys()) unresolved(id2);
    }
  };
}

// js/network/strategic-services.ts
var StrategicServices = {
  replace: defineCommand("strategic.replace", { capacity: 2, ordered: "strategicInterest" }),
  query: defineQuery("strategic.cached", { capacity: 2 }),
  refresh: defineCommand("strategic.refresh", { capacity: 2 })
};

// js/network/strategic-notifier.ts
function createStrategicNotifier(send) {
  const lifetime = new AbortController();
  let latest;
  let running = false;
  let delay = 500;
  let timer;
  function failed(error) {
    if (strategicDisposed(error)) lifetime.abort();
    if (lifetime.signal.aborted) return;
    timer = setTimeout(() => {
      timer = void 0;
      void pump();
    }, delay);
    delay = Math.min(5e3, delay * 2);
  }
  async function pump() {
    if (running || !latest || lifetime.signal.aborted) return;
    const sent = latest;
    running = true;
    try {
      await send(sent, lifetime.signal);
      if (latest === sent) latest = void 0;
      delay = 500;
    } catch (error) {
      failed(error);
    } finally {
      running = false;
    }
    if (!timer && latest && !lifetime.signal.aborted) void pump();
  }
  return {
    notify(value) {
      if (lifetime.signal.aborted || latest && compareStrategic(value, latest) < 0) return;
      latest = { ...value };
      if (!timer) void pump();
    },
    dispose() {
      lifetime.abort();
      clearTimeout(timer);
      latest = void 0;
    }
  };
}

// js/network/strategic-service-host.ts
function createStrategicService(bus, scope2, session) {
  const binding = bus.bind({ service: "strategic", instance: "network", scope: scope2, source: "js/network/strategic-service-host.ts" }, {
    provides: { replace: StrategicServices.replace, query: StrategicServices.query },
    consumes: { refresh: StrategicServices.refresh }
  });
  binding.provides.replace.handle((value) => session().replaceStrategic(value));
  binding.provides.query.handle(() => session().strategicSnapshot());
  let readiness;
  function ready() {
    return readiness ?? (readiness = binding.ready().catch((error) => {
      readiness = void 0;
      throw error;
    }));
  }
  void ready().catch(() => {
  });
  const notifier = createStrategicNotifier(async (value, signal) => {
    await ready();
    await binding.consumes.refresh.request(value, { signal, timeoutMs: 3e3 });
  });
  return { notify: notifier.notify, dispose() {
    notifier.dispose();
    return binding.dispose();
  } };
}

// js/network/service-host.ts
function createNetworkService(bus, scope2, session) {
  const binding = bus.bind({ service: "network", instance: "network", scope: scope2, source: "js/network/service-host.ts" }, {
    consumes: { rememberIntent: RememberIntent },
    provides: {
      ...NetworkEvents,
      move: ShipOrders.move,
      transfer: ShipOrders.transfer,
      retry: ShipOrders.retry,
      queryReceipt: ShipOrders.receipt,
      ownedShips: OwnedShips,
      diagnostics: NetworkDiagnostics,
      refreshPlayback: NetworkPlayback.refresh,
      projection: ShipProjection.batches
    }
  });
  let strategic;
  try {
    strategic = createStrategicService(bus, scope2, session);
  } catch {
  }
  const requests = createServiceRequests((value) => session().control(value));
  binding.provides.move.handle((input, context) => requests.submit((requestId) => ({ type: "move", requestId, ...input }), void 0, context.causal));
  binding.provides.transfer.handle((input, context) => requests.submit((requestId) => ({ type: "transfer", requestId, ...input }), void 0, context.causal));
  binding.provides.retry.handle((command, context) => requests.submit((requestId) => ({ type: "retry", requestId, command }), command.key, context.causal));
  binding.provides.queryReceipt.handle((key2, context) => requests.submit((requestId) => ({ type: "queryReceipt", requestId, key: key2 }), key2, context.causal));
  binding.provides.ownedShips.handle((query) => session().ownedShips(query));
  binding.provides.refreshPlayback.handle(() => session().control({ type: "refreshPlayback" }));
  binding.provides.diagnostics.handle(() => session().takeDiagnostics());
  return {
    ready: () => binding.ready(),
    emit(event2) {
      if (event2.type === "strategic") {
        strategic?.notify(event2.frontier);
        return;
      }
      const context = requests.observe(event2);
      if (event2.type === "pending") return binding.consumes.rememberIntent.request(event2, { context });
      binding.provides[event2.type].publish(event2, { context });
    },
    connectStream(generation) {
      return binding.provides.projection.connect({
        id: `ship-projection-${generation}`,
        generation,
        source: "network",
        target: "render",
        maxBytes: 1024 * 1024,
        maxBuffers: 4
      });
    },
    async dispose() {
      requests.dispose();
      await Promise.allSettled([strategic?.dispose(), binding.dispose()]);
    }
  };
}

// js/network/worker-host.ts
function createNetworkWorker(bus) {
  const worker = self;
  let session;
  let service;
  let generation = 0;
  let prepared = false;
  let failed = false;
  let disconnectStream;
  const previousError = bus?._options.onError;
  function lifecycle(value) {
    worker.postMessage(value);
  }
  function fatal(error) {
    if (failed) return;
    failed = true;
    session?.dispose();
    disconnectStream?.();
    if (service) void service.dispose().catch(() => {
    });
    lifecycle({ type: "networkFatal", generation, message: error instanceof Error ? error.message : String(error) });
  }
  function emit(event2) {
    if (failed) return;
    if (service) {
      try {
        return service.emit(event2);
      } catch (error) {
        fatal(error);
        if (event2.type === "pending") return Promise.reject(error);
        return;
      }
    }
    worker.postMessage(event2);
  }
  const busError = (error) => fatal(new Error(error.message));
  if (bus) bus._options.onError = busError;
  async function prepare(value) {
    if (!bus || service || !Number.isSafeInteger(value.generation) || value.generation < 1) throw new Error("Invalid network service bootstrap");
    generation = value.generation;
    service = createNetworkService(bus, value.scope, () => {
      if (!session) throw new Error("Network session is not connected");
      return session;
    });
    await service.ready();
    if (failed) return;
    prepared = true;
    lifecycle({ type: "servicesReady", generation });
  }
  function connect(data) {
    if (bus && (!prepared || data.generation !== generation)) {
      data.renderPort.close();
      throw new Error("Network service bootstrap is not ready");
    }
    session?.dispose();
    disconnectStream?.();
    generation = data.generation;
    try {
      session = createNetworkSession({ bootstrap: data, emit });
      disconnectStream = service?.connectStream(generation);
    } catch (error) {
      data.renderPort.close();
      throw error;
    }
  }
  function destroy() {
    session?.dispose();
    session = void 0;
    disconnectStream?.();
    if (service) void service.dispose().catch(() => {
    });
    if (bus?._options.onError === busError) bus._options.onError = previousError;
    worker.onmessage = null;
    worker.onmessageerror = null;
  }
  function receive(data) {
    if (data.type === "prepareServices") {
      void prepare(data).catch(fatal);
      return;
    }
    if (data.type === "connect") {
      connect(data);
      return;
    }
    if (data.type === "dispose") {
      destroy();
      worker.close();
      return;
    }
    if (!session) throw new Error("Network worker has no active session");
    const active = session;
    void active.control(data).catch((error) => {
      if (session === active) emit({ type: "error", message: String(error), requestId: "requestId" in data ? data.requestId : void 0 });
    });
  }
  worker.onmessage = ({ data }) => {
    if (data?.b === true || failed) return;
    try {
      receive(data);
    } catch (error) {
      if (bus) fatal(error);
      else emit({ type: "error", message: String(error) });
    }
  };
  worker.onmessageerror = () => {
    destroy();
    worker.close();
  };
  return { destroy };
}

// js/network/worker-entry.ts
createNetworkWorker();
//# sourceMappingURL=network-worker.bundle.js.map
