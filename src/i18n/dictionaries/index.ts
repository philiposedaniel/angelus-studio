import type { Locale } from '../config'
import { en, type Dictionary } from './en'
import { es } from './es'

/** Interface text per language. Languages without a dictionary use English. */
const dictionaries: Partial<Record<Locale, Dictionary>> = { en, es }

export const getDictionary = (locale: Locale): Dictionary => dictionaries[locale] ?? en

export type { Dictionary }
