// R2 Workers API places its documented numeric code at the end of message.
// Do not treat arbitrary 404s, network failures or authorization errors as absence.
export function isMissingMultipartUpload(error: unknown): boolean {
  return error instanceof Error && /\(10024\)\s*$/.test(error.message);
}
