/**
 * Tone linter (docs/PLAN.md §2 rule 6). Reasons must be blunt and exact: no compliments, no softeners, no insults,
 * no slang, no hype. `lintTone` returns one violation string per banned thing found; an empty list means clean.
 * tests/unit/scoring-tone.test.ts renders every template across a grid of facts and requires an empty list.
 *
 * Matching is case-insensitive on whole words (so "greater" is not "great", "adjust" is not "just", "cancel" is
 * not "cel"). Curly apostrophes are normalised first. "slightly" is only allowed in a sentence that also
 * carries a number ("slightly above 12°"), because then it quantifies instead of softening.
 */

export type ToneCategory = 'compliment' | 'softener' | 'insult' | 'slang' | 'hype'

export const BANNED_PHRASES: Readonly<Record<Exclude<ToneCategory, 'hype'>, readonly string[]>> = {
  compliment: [
    'great',
    'good start',
    'not bad',
    'decent',
    'nice',
    'pretty good',
    'solid',
    'impressive',
    'awesome',
    'amazing',
    'excellent',
    'fantastic',
    'wonderful',
    'perfect',
    'well done',
    'good job',
    'nice work',
    'congrats',
    'congratulations',
    'proud',
    'gorgeous',
    'stunning',
  ],
  softener: [
    'just',
    'a bit',
    'a little',
    'unfortunately',
    'sadly',
    'hopefully',
    "don't worry",
    'no worries',
    'keep it up',
    'keep going',
    'stay positive',
    'on the bright side',
    'silver lining',
    'somewhat',
    'kind of',
    'sort of',
    "it's okay",
    "it's ok",
    "that's okay",
    'no big deal',
    'not a big deal',
    "don't be discouraged",
  ],
  insult: ['ugly', 'fugly', 'subhuman', 'hideous', 'disgusting', 'repulsive', 'pathetic', 'loser', 'worthless', 'deformed', 'freak'],
  slang: [
    'cel',
    'incel',
    "it's over",
    'cooked',
    'mogged',
    'mog',
    'mogs',
    'mogging',
    'chad',
    'gigachad',
    'cope',
    'copium',
    'ngmi',
    'lol',
    'lmao',
    'bro',
    'fam',
    'tbh',
    'ngl',
  ],
}

/** Words that read as hype; "!" is checked separately. */
export const HYPE_WORDS: readonly string[] = ['insane', 'incredible', 'unreal', 'mind-blowing', 'epic', 'legendary']

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Whole-word boundary: a letter, digit or underscore on either side means it is part of a longer word. */
const BEFORE = '(?<![\\p{L}\\p{N}_])'
const AFTER = '(?![\\p{L}\\p{N}_])'

function phraseSource(phrase: string): string {
  // Spaces inside a phrase match any run of whitespace.
  return phrase.split(/\s+/).map(escape).join('\\s+')
}

const categoryByPhrase = new Map<string, ToneCategory>()
for (const [category, phrases] of Object.entries(BANNED_PHRASES) as [Exclude<ToneCategory, 'hype'>, readonly string[]][]) {
  for (const phrase of phrases) categoryByPhrase.set(phrase, category)
}
for (const phrase of HYPE_WORDS) categoryByPhrase.set(phrase, 'hype')

// One alternation, longest phrase first, so "pretty good" wins over any shorter overlap and the text is scanned once.
const BANNED = new RegExp(
  `${BEFORE}(${[...categoryByPhrase.keys()]
    .sort((a, b) => b.length - a.length)
    .map(phraseSource)
    .join('|')})${AFTER}`,
  'giu',
)
const SLIGHTLY = new RegExp(`${BEFORE}slightly${AFTER}`, 'giu')

function normalise(text: string): string {
  return text.replace(/[’‘]/g, "'")
}

/** The sentence containing `index`, split on . ! ? ; : and newlines. */
function sentenceAround(text: string, index: number): string {
  const before = text.slice(0, index).split(/[.!?;:\n]/).pop() ?? ''
  const after = text.slice(index).split(/[.!?;:\n]/)[0] ?? ''
  return before + after
}

/** Violations found in `text`, e.g. `softener: "just"`. Sorted by position; each distinct hit listed once. */
export function lintTone(text: string): string[] {
  const t = normalise(text)
  const hits: { index: number; message: string }[] = []

  for (const m of t.matchAll(BANNED)) {
    const phrase = m[0].toLowerCase().replace(/\s+/g, ' ')
    hits.push({ index: m.index, message: `${categoryByPhrase.get(phrase)}: "${phrase}"` })
  }
  for (const m of t.matchAll(SLIGHTLY)) {
    if (!/\d/.test(sentenceAround(t, m.index))) hits.push({ index: m.index, message: 'softener: "slightly" without a number' })
  }
  for (let i = t.indexOf('!'); i !== -1; i = t.indexOf('!', i + 1)) hits.push({ index: i, message: 'hype: "!"' })

  hits.sort((a, b) => a.index - b.index)
  const seen = new Set<string>()
  const out: string[] = []
  for (const h of hits) {
    if (seen.has(h.message)) continue
    seen.add(h.message)
    out.push(h.message)
  }
  return out
}
