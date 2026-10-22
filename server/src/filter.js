'use strict';
// A basic word filter for chat and player names. It hides common swear words and slurs in the languages our
// players use, matching whole words and simple disguises (repeated letters, digits for letters, spaces/dots inside).
// It will never be perfect; players can also mute anyone themselves.
const WORDS = [
  // English
  'fuck', 'fucker', 'fucking', 'motherfucker', 'shit', 'bullshit', 'bitch', 'bastard', 'cunt', 'dick', 'cock', 'pussy', 'asshole', 'whore', 'slut', 'wanker', 'twat',
  'nigger', 'nigga', 'faggot', 'fag', 'retard', 'kike', 'spic', 'chink', 'tranny',
  // Spanish
  'puta', 'puto', 'mierda', 'cabron', 'cabrón', 'pendejo', 'maricon', 'maricón', 'coño', 'gilipollas', 'verga', 'culero', 'zorra', 'hijueputa', 'malparido',
  // Portuguese
  'caralho', 'porra', 'buceta', 'viado', 'arrombado',
  // French / Italian / German
  'putain', 'salope', 'connard', 'enculé', 'cazzo', 'stronzo', 'vaffanculo', 'scheisse', 'scheiße', 'fotze', 'hurensohn', 'wichser',
  // Russian / Ukrainian (Cyrillic and Latin spellings)
  'блять', 'бля', 'сука', 'хуй', 'пизда', 'ебать', 'ебал', 'мудак', 'пидор', 'пидорас', 'хуйня', 'гандон', 'blyat', 'suka', 'pizda', 'pidor', 'nahui',
  // Polish / Latvian / Turkish
  'kurwa', 'chuj', 'pierdol', 'jebać', 'pizdā', 'dirsā', 'pimpis', 'siktir', 'orospu', 'amına',
];
const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' };
function norm(s) { return s.toLowerCase().replace(/[013457@$!]/g, c => LEET[c]).replace(/(.)\1+/g, '$1'); }
const BAD = WORDS.map(w => norm(w));
// words also caught inside longer words (e.g. "fuuuckyou"); everything else must match the whole word, so normal words like "Scunthorpe" or "cocktail" are safe
const INSIDE = ['fuck', 'nigger', 'nigga', 'faggot', 'motherfucker', 'хуй', 'блять', 'пизд', 'kurwa', 'puta', 'mierda'].map(norm);
function bad(token) { const t = norm(token).replace(/[^\p{L}]/gu, ''); return t.length > 1 && (BAD.includes(t) || INSIDE.some(w => t.includes(w))); }
// replaces bad words with asterisks; joins "f u c k"-style spacing first so it can be caught too
function clean(text) {
  let out = String(text).split(/(\s+)/).map(p => (/\s+/.test(p) ? p : bad(p) ? '*'.repeat(Math.min(p.length, 8)) : p)).join('');
  // letters spaced out ("f u c k"): check every run of 3+ single letters joined together
  return out.replace(/(?:^|(?<=\s))(\S(?:\s+\S){2,})(?=\s|$)/gu, run => (run.split(/\s+/).every(x => x.length === 1) && bad(run.replace(/\s+/g, '')) ? '*'.repeat(8) : run));
}
function cleanName(name) { return bad(name.replace(/\s+/g, '')) || name.split(/\s+/).some(bad) ? 'Player' : name; }
module.exports = { clean, cleanName };
