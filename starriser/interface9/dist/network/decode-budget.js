import { ScalarType } from "@bufbuild/protobuf";
import { BinaryReader, WireType } from "@bufbuild/protobuf/wire";
import { MAX_MESSAGE_BYTES } from './limits.js';
const fields = new WeakMap();
const MAX_FIELDS = 8192;
const MAX_MESSAGES = 2048;
const MAX_REPEATED = 256;
const MAX_DEPTH = 12;
const scalarWires = {
    [ScalarType.DOUBLE]: WireType.Bit64, [ScalarType.FIXED64]: WireType.Bit64, [ScalarType.SFIXED64]: WireType.Bit64,
    [ScalarType.FLOAT]: WireType.Bit32, [ScalarType.FIXED32]: WireType.Bit32, [ScalarType.SFIXED32]: WireType.Bit32,
    [ScalarType.STRING]: WireType.LengthDelimited, [ScalarType.BYTES]: WireType.LengthDelimited,
};
function descriptorFields(schema) {
    let found = fields.get(schema);
    if (!found) {
        found = new Map(schema.fields.map(field => [field.number, field]));
        fields.set(schema, found);
    }
    return found;
}
/** Inspect wire structure before allocating generated message objects. Unknown
 * length-delimited fields remain opaque. No payload cloning or JSON conversion. */
export function checkDecodeBudget(schema, bytes) {
    const budget = { fields: MAX_FIELDS, messages: MAX_MESSAGES, bytes: bytes.length, viewRows: 0, repeated: new Map() };
    scan(new BinaryReader(bytes), schema, bytes.length, 0, budget);
    if (bytes.length > MAX_MESSAGE_BYTES)
        throw new Error('Protocol message size exceeded');
}
function scan(reader, schema, end, depth, budget) {
    budget = messageBudget(schema, budget);
    if (depth > MAX_DEPTH || --budget.messages < 0)
        throw new Error("Protocol message expansion budget exceeded");
    enclosingBudget(schema.typeName, budget.bytes);
    const known = descriptorFields(schema);
    while (reader.pos < end) {
        if (--budget.fields < 0)
            throw new Error("Protocol field budget exceeded");
        const [number, wire] = reader.tag();
        const field = known.get(number);
        if (field)
            countField(field, wire, budget);
        scanValue(reader, field, wire, end, depth, budget);
    }
    if (reader.pos !== end)
        throw new Error("Protocol nested message crosses its boundary");
}
function messageBudget(schema, budget) {
    if (schema.typeName === 'galaxy.v1.ViewEvent' || schema.typeName === 'galaxy.v1.ViewRequest')
        return budget.views ?? (budget.views = { fields: 12 * 1024, messages: MAX_MESSAGES, bytes: budget.bytes, viewRows: 0, repeated: new Map() });
    return budget;
}
function enclosingBudget(name, bytes) {
    if (['galaxy.v1.ViewRequest', 'galaxy.v1.ViewEvent'].includes(name) && bytes > 128 * 1024)
        throw new Error('View enclosing byte budget exceeded');
}
function countField(field, wire, budget) {
    validateWire(field, wire);
    if (field.fieldKind === "list" && !(wire === WireType.LengthDelimited && packed(field)))
        countRepeated(field, budget);
}
function countRepeated(field, budget) {
    const count = (budget.repeated.get(field) ?? 0) + 1;
    // Descriptor identity aggregates spans even when protobuf merges several
    // occurrences of an optional diagnostics batch in the same envelope.
    const limit = repeatedLimit(field, budget);
    if (count > limit)
        throw new Error("Protocol repeated field expansion budget exceeded");
    budget.repeated.set(field, count);
}
function repeatedLimit(field, budget) {
    if (['galaxy.v1.OverviewRows', 'galaxy.v1.OwnedRows', 'galaxy.v1.DetailRows'].includes(field.parent.typeName)) {
        if (field.parent.typeName === 'galaxy.v1.OwnedRows' && field.number === 3)
            return 4096;
        if (++budget.viewRows > 256)
            throw new Error('View row allocation budget exceeded');
        return 256;
    }
    if (field.parent.typeName === 'galaxy.v1.OverviewSelector')
        return field.number === 2 ? 4096 : 256;
    switch (field.parent.typeName) {
        case 'galaxy.v1.DiagnosticBatch': return 16; // Its only list is diagnostic spans.
        default: return MAX_REPEATED;
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
    if (next > end)
        throw new Error("Truncated protocol field");
    if (field?.message) {
        scan(reader, field.message, next, depth + 1, budget);
        return;
    }
    // Current packed lists contain only negotiated versions/capabilities. Bound
    // their bytes across occurrences so tiny varints cannot expand into huge arrays.
    if (field && packed(field)) {
        scanPacked(reader, field, next, length, budget);
        return;
    }
    reader.pos = next;
}
function scanPacked(reader, field, end, length, budget) {
    chargePacked(field, length, budget);
    const wire = scalarWire(field);
    while (reader.pos < end)
        reader.skip(wire);
    if (reader.pos !== end)
        throw new Error("Protocol packed scalar crosses its boundary");
}
function scalarWire(field) {
    if (field.message || field.fieldKind === "map")
        return WireType.LengthDelimited;
    return field.scalar === undefined ? WireType.Varint : scalarWires[field.scalar] ?? WireType.Varint;
}
function packed(field) {
    return field.fieldKind === "list" && scalarWire(field) !== WireType.LengthDelimited;
}
function validateWire(field, wire) {
    // Generated readers can choose the declared scalar reader without checking the
    // tag's wire type. Our scan must consume exactly the same field boundaries.
    if (wire !== scalarWire(field) && !(wire === WireType.LengthDelimited && packed(field))) {
        throw new Error("Protocol field has incompatible wire type");
    }
}
function chargePacked(field, length, budget) {
    const count = (budget.repeated.get(field) ?? 0) + length;
    if (count > MAX_REPEATED)
        throw new Error("Protocol packed field expansion budget exceeded");
    budget.repeated.set(field, count);
}
//# sourceMappingURL=decode-budget.js.map