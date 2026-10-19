'use client'

import { FieldLabel, SelectInput, useField, useFormFields, useLocale } from '@payloadcms/ui'
import type { TextFieldClientComponent } from 'payload'
import { useEffect, useState } from 'react'

type Option = { label: string; value: string }

/**
 * A person's meal, chosen from the meals their event offers (Events → Invitations and RSVP →
 * Meal choices). The guest's event is read through the API as the signed-in user.
 */
export const MealChoiceField: TextFieldClientComponent = ({ path, readOnly }) => {
  const { value, setValue } = useField<string | null>({ path })
  const eventId = useFormFields(([fields]) => fields.event?.value) as number | string | undefined
  const locale = useLocale()
  const [options, setOptions] = useState<Option[] | null>(null)

  useEffect(() => {
    if (eventId === undefined || eventId === null || eventId === '') return
    const controller = new AbortController()
    fetch(`/api/events/${encodeURIComponent(String(eventId))}?depth=0&locale=${locale.code}&select[mealOptions]=true`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((event: { mealOptions?: { id?: string; label?: string }[] } | null) =>
        setOptions(
          (event?.mealOptions ?? []).flatMap((option) =>
            option.id ? [{ value: option.id, label: option.label || option.id }] : [],
          ),
        ),
      )
      .catch(() => {})
    return () => controller.abort()
  }, [eventId, locale.code])

  const known = options ?? []
  // A meal the event no longer offers still shows, so staff can see it and change it.
  const all = value && !known.some((option) => option.value === value) ? [...known, { value, label: 'A meal no longer offered' }] : known

  if (options !== null && options.length === 0 && !value) {
    return (
      <div className="field-type">
        <FieldLabel label="Meal" path={path} />
        <p style={{ margin: 0, fontSize: 13, opacity: 0.75 }}>This event offers no meal choices.</p>
      </div>
    )
  }
  return (
    <SelectInput
      path={path}
      name={path}
      label="Meal"
      options={all}
      value={value ?? undefined}
      readOnly={readOnly}
      isClearable
      onChange={(selected) => {
        const option = Array.isArray(selected) ? selected[0] : selected
        setValue(option && typeof option === 'object' && 'value' in option ? (option.value as string) : null)
      }}
    />
  )
}
