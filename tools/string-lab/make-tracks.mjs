#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
//  STRING LAB · tools/string-lab/make-tracks.mjs — write the bundled MIDI files
// ────────────────────────────────────────────────────────────────────────────
//  Reads the scores in scores.mjs and writes one format 0 Standard MIDI File
//  per score to stella-nova/pages/string-lab/playback/tracks/<id>.mid. The
//  writer is the engine's own writeMidi(). Each chord change becomes a
//  marker event (meta 0x06, text "chord:<name>").
//
//    node tools/string-lab/make-tracks.mjs           write the files
//    node tools/string-lab/make-tracks.mjs --check   exit 1 when a file differs
//
//  The output is deterministic, so --check proves that the committed files
//  come from these scores.
// ════════════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { allScores } from './scores.mjs';
import { songFromNotes, writeMidi } from '../../stella-nova/pages/string-lab/engine/midi.js';

export const OUT_DIR = fileURLToPath(new URL('../../stella-nova/pages/string-lab/playback/tracks/', import.meta.url));
const DIVISION = 480;

/** One score -> MIDI bytes. */
export function buildTrack(score) {
  const song = songFromNotes(score.notes, { bpm: score.bpm, division: DIVISION, name: score.title, program: score.program });
  const tr = song.tracks[0];
  const end = tr.pop(); // end of track; markers go before it
  const meter = { tick: 0, type: 'meta', metaType: 0x58, data: [score.beatsPerBar || 4, 2, 24, 8] };
  const at = tr.findIndex((e) => e.metaType === 0x58);
  if (at >= 0) tr[at] = meter;
  for (const [beat, name] of score.chords || []) {
    tr.push({ tick: Math.round(beat * DIVISION), type: 'meta', metaType: 0x06, text: 'chord:' + name });
  }
  tr.push({ ...end, tick: Math.max(end.tick, ...tr.map((e) => e.tick)) });
  return writeMidi(song);
}

export function buildAll() {
  return allScores().map((s) => ({ id: s.id, file: s.id + '.mid', bytes: buildTrack(s) }));
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const check = process.argv.includes('--check');
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  let bad = 0;
  for (const t of buildAll()) {
    const path = OUT_DIR + t.file;
    if (check) {
      const same = existsSync(path) && Buffer.compare(readFileSync(path), Buffer.from(t.bytes)) === 0;
      if (!same) bad++;
      console.log((same ? 'same    ' : 'DIFFERS ') + t.file);
    } else {
      writeFileSync(path, t.bytes);
      console.log(`wrote ${t.file} (${t.bytes.length} bytes)`);
    }
  }
  if (bad) process.exit(1);
}
