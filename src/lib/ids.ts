/** The id of a relationship value, whether Payload returned an id or a populated document. */
export const idOf = (value: unknown): number | string | undefined =>
  value && typeof value === 'object' && 'id' in value
    ? (value as { id: number | string }).id
    : (value as number | string | undefined)

/** Postgres `serial` ids stop here; a larger number in a query makes the database refuse it. */
const MAX_ROW_ID = 2_147_483_647

/** A row id typed by a person or taken from a URL, or null when it cannot be one. */
export const parseRowId = (value: string): number | null => {
  if (!/^\d{1,10}$/.test(value)) return null
  const id = Number(value)
  return id >= 1 && id <= MAX_ROW_ID ? id : null
}
