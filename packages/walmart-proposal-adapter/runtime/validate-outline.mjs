import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { definePresentationOutline } from '@hansen/presentation-contracts'

const path = process.argv[2]
if (!path) throw new Error('outline path is required')
const outline = definePresentationOutline(JSON.parse(await readFile(resolve(process.cwd(), path), 'utf8')))
const minimum = Number(process.argv[3] ?? 1)
const maximum = Number(process.argv[4] ?? 80)
if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) || minimum < 1 || maximum < minimum) throw new Error('slide-count range is invalid')
if (outline.slides.length < minimum || outline.slides.length > maximum) throw new Error(`Walmart buyer proposal must contain ${minimum}-${maximum} slides; received ${outline.slides.length}`)
process.stdout.write('validated paimind.presentation-outline/v1\n')
