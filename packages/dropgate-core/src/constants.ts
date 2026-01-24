/**
 * Default chunk size for file uploads (5MB)
 */
export const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024;

/**
 * AES-GCM initialization vector size in bytes
 */
export const AES_GCM_IV_BYTES = 12;

/**
 * AES-GCM authentication tag size in bytes
 */
export const AES_GCM_TAG_BYTES = 16;

/**
 * Total encryption overhead per chunk (IV + tag)
 */
export const ENCRYPTION_OVERHEAD_PER_CHUNK = AES_GCM_IV_BYTES + AES_GCM_TAG_BYTES;

/**
 * Maximum file size (in bytes) that can be downloaded without an onData callback.
 * Files larger than this require streaming via onData to avoid memory exhaustion.
 * Default: 100MB
 */
export const MAX_IN_MEMORY_DOWNLOAD_BYTES = 100 * 1024 * 1024;
