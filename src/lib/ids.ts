/** The id of a relationship value, whether Payload returned an id or a populated document. */
export const idOf = (value: unknown): number | string | undefined =>
  value && typeof value === 'object' && 'id' in value
    ? (value as { id: number | string }).id
    : (value as number | string | undefined)
