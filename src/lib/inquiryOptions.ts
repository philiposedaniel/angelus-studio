/** Shared by the inquiries collection and the website form (safe to import in the browser). */
export const EVENT_TYPES = ['wedding', 'event', 'corporate', 'livestream', 'portrait', 'other'] as const
export type EventType = (typeof EVENT_TYPES)[number]
