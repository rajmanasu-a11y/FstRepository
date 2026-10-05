// English is the key; Hindi is looked up by the English text. Missing strings fall back to
// English, so a new language is added by adding one more dictionary (NFR-16).
import { HI } from './strings.hi.js';

let current = 'en';
export function setLang(l) { current = l === 'hi' ? 'hi' : 'en'; document.documentElement.lang = current === 'hi' ? 'hi' : 'en'; }
export function lang() { return current; }
export function t(s) { return current === 'hi' ? HI[s] || s : s; }
/** Pick a localised field from an object: name / nameHi, title / titleHi. */
export function tf(obj, field = 'name') { return current === 'hi' && obj?.[field + 'Hi'] ? obj[field + 'Hi'] : obj?.[field]; }
