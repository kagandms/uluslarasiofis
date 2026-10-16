import { createHash } from 'node:crypto';
import { canonical } from './evidence.mjs';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const metadata = value => Object.fromEntries(Object.entries(value || {}).map(([key, item]) => [key, item instanceof Date ? item.toISOString() : item]));

export async function verifyRestoredObject(original, restored) {
    if (!original || !restored) throw new Error('RECOVERY_OBJECT_MISSING');
    const [left, right] = await Promise.all([original.arrayBuffer(), restored.arrayBuffer()]);
    if (left.byteLength !== right.byteLength || sha256(Buffer.from(left)) !== sha256(Buffer.from(right))) throw new Error('RECOVERY_OBJECT_HASH_MISMATCH');
    if (canonical(metadata(original.httpMetadata)) !== canonical(metadata(restored.httpMetadata))
        || canonical(metadata(original.customMetadata)) !== canonical(metadata(restored.customMetadata))) throw new Error('RECOVERY_OBJECT_METADATA_MISMATCH');
    return { bytes: left.byteLength, sha256: sha256(Buffer.from(right)) };
}
