// STRING LAB · playback/tests.mjs — node tests for the playback module
//   node stella-nova/pages/string-lab/playback/tests.mjs
// No browser. The sound engine runs on the engine's stub AudioContext.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TRACKS } from './tracks.js';
import { loadSong, Session, ChordSession, soundPolicy, chordMarkers, EXTREME_SCALE } from './session.js';
import { intervalInfo, chordRatios, sharedPartials, describeNote } from './ratios.js';
import { INSTRUMENTS, midiToFreq } from '../engine/instruments.js';
import { isPlayable, parseMidi, writeMidi, songFromNotes } from '../engine/midi.js';
import { PROGRESSIONS, STRUM_PATTERNS, findShape } from '../engine/chords.js';
import { AudioEngine, createStubContext } from '../engine/audio.js';
import { buildAll } from '../../../../tools/string-lab/make-tracks.mjs';

let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) pass++;
  else { fail++; console.log('FAIL', msg); }
};
const group = (name) => console.log('\n# ' + name);

const dir = fileURLToPath(new URL('./tracks/', import.meta.url));
const bytesOf = (t) => new Uint8Array(readFileSync(dir + t.id + '.mid'));

group('library files');
{
  const files = readdirSync(dir).filter((f) => f.endsWith('.mid')).sort();
  ok(TRACKS.length >= 8, `at least 8 tracks (${TRACKS.length})`);
  ok(files.length === TRACKS.length, `one file per track (${files.length} files)`);
  const built = buildAll();
  for (const b of built) {
    const same = Buffer.compare(readFileSync(dir + b.file), Buffer.from(b.bytes)) === 0;
    ok(same, `${b.file} equals the output of make-tracks.mjs`);
  }
  ok(built.length === TRACKS.length, 'every score has a track entry');
  for (const t of TRACKS) ok(built.some((b) => b.id === t.id), `${t.id} is built by the tool`);
}

group('every bundled MIDI parses, maps and plays to its end');
for (const t of TRACKS) {
  const song = loadSong(bytesOf(t));
  ok(song.notes.length > 20, `${t.id}: ${song.notes.length} notes`);
  ok(song.markers.length > 0, `${t.id}: ${song.markers.length} chord markers`);
  ok(Math.abs(song.bpm - 60) < 200 && song.bpm > 30, `${t.id}: tempo ${song.bpm.toFixed(1)} bpm`);
  const rt = parseMidi(writeMidi(parseMidi(bytesOf(t)))) && true;
  ok(rt, `${t.id}: parse - write - parse`);
  for (const key of ['steel', 'classical', 'violin']) {
    const s = new Session({ instrument: key }).load(song);
    const inst = INSTRUMENTS[key];
    const bad = s.steps.filter((st) => !isPlayable({ notes: st.notes }, inst));
    ok(bad.length === 0, `${t.id} on ${key}: ${s.steps.length} steps, ${bad.length} unplayable`);
    const empty = s.steps.filter((st) => st.notes.length === 0);
    ok(empty.length === 0, `${t.id} on ${key}: every step sounds a note (${empty.length} empty)`);
    // the guitars keep every note of the bundled tracks (no drops)
    if (key !== 'violin') {
      const dropped = s.steps.reduce((a, st) => a + st.dropped.length, 0);
      ok(dropped === 0, `${t.id} on ${key}: ${dropped} notes dropped`);
    }
  }
  // continuous play on the stub sound engine, at real time and at 1/10
  for (const scale of [1, 0.1]) {
    const audio = new AudioEngine({ createContext: () => createStubContext() });
    audio.start();
    let sounded = 0, events = 0;
    const s = new Session({
      instrument: t.inst,
      onEvent: (ev) => {
        events++;
        if (soundPolicy(scale).sound) for (const n of ev.step.notes) { audio.playNote({ instrument: ev.instrument, string: n.string, fret: n.fret }); sounded++; }
      },
    }).load(song);
    s.play();
    let frames = 0;
    const dt = 1 / 30;
    while (s.playing && frames < 400000) { s.tick(dt, scale); frames++; }
    const wallNeeded = song.notes.reduce((m, n) => Math.max(m, n.t + n.dur), 0) / scale;
    ok(!s.playing && s.atEnd, `${t.id} at ${scale}: plays to its end (${events}/${s.steps.length} steps)`);
    ok(events === s.steps.length, `${t.id} at ${scale}: every step fires once`);
    ok(Math.abs(frames * dt - wallNeeded) < 0.1, `${t.id} at ${scale}: wall time ${(frames * dt).toFixed(2)} s vs ${wallNeeded.toFixed(2)} s`);
    ok(sounded > 0 && audio.ctx.log.started.length === sounded, `${t.id} at ${scale}: ${sounded} sources started`);
  }
}

group('step mode visits every note once');
for (const t of TRACKS) {
  const song = loadSong(bytesOf(t));
  const seen = new Map();
  const s = new Session({ instrument: 'classical', onEvent: (ev) => { for (const n of ev.step.src) seen.set(n, (seen.get(n) || 0) + 1); } }).load(song);
  let k = 0;
  while (s.next()) k++;
  ok(k === s.steps.length, `${t.id}: ${k} steps`);
  ok(seen.size === song.notes.length, `${t.id}: ${seen.size}/${song.notes.length} notes visited`);
  ok([...seen.values()].every((c) => c === 1), `${t.id}: no note visited twice`);
  ok(s.next() === null && s.atEnd, `${t.id}: next() at the end returns null`);
  const back = s.prev();
  ok(back && back.step.i === s.steps.length - 2, `${t.id}: prev() goes back one step`);
  const g = s.goTo(3);
  ok(g && g.step.i === 3 && s.index === 3, `${t.id}: goTo(3)`);
  const n4 = s.next();
  ok(n4 && n4.step.i === 4, `${t.id}: next() after goTo(3) is step 4`);
}

group('step after pause continues from the play position');
{
  const song = loadSong(bytesOf(TRACKS[0]));
  const s = new Session({ instrument: 'classical' }).load(song);
  s.play();
  for (let i = 0; i < 60; i++) s.tick(1 / 30, 1); // 2 s
  s.pause();
  const at = s.index;
  const ev = s.next();
  ok(ev && ev.step.i === at + 1, `next after pause is step ${at + 1} (got ${ev && ev.step.i})`);
}

group('tempo');
{
  const song = loadSong(bytesOf(TRACKS[4]));
  const s = new Session({ instrument: 'violin' }).load(song);
  s.setTempo(2);
  s.play();
  let frames = 0;
  while (s.playing) { s.tick(1 / 60, 1); frames++; }
  const dur = song.notes.reduce((m, n) => Math.max(m, n.t + n.dur), 0);
  ok(Math.abs(frames / 60 - dur / 2) < 0.05, `tempo 2 halves the time (${(frames / 60).toFixed(2)} s vs ${(dur / 2).toFixed(2)} s)`);
}

group('chord markers and roots');
{
  const song = loadSong(bytesOf(TRACKS.find((t) => t.id === 'romanza')));
  const s = new Session({ instrument: 'classical' }).load(song);
  ok(s.steps[0].chord === 'Em' && s.steps[0].rootPc === 4, 'romanza opens on Em (root E)');
  const am = s.steps.find((st) => st.chord === 'Am');
  ok(am && am.rootPc === 9, 'romanza reaches Am (root A)');
  // an upload with no markers: the root comes from the bass
  const notes = [{ t: 0, dur: 1, midi: 45 }, { t: 0, dur: 1, midi: 69 }, { t: 1, dur: 1, midi: 72 }, { t: 2, dur: 1, midi: 76 }];
  const up = loadSong(writeMidi(songFromNotes(notes, { bpm: 60, name: 'upload' })));
  ok(up.markers.length === 0, 'a plain file has no markers');
  const su = new Session({ instrument: 'steel' }).load(up);
  ok(su.steps.every((st) => st.rootPc === 9), 'root of an unmarked file is the bass note A');
  ok(up.name === 'upload', 'the track name comes from the file');
  let threw = false;
  try { loadSong(new Uint8Array([1, 2, 3, 4])); } catch (_) { threw = true; }
  ok(threw, 'a file that is not MIDI throws');
}

group('ratios');
{
  const fifth = intervalInfo(45, 52);
  ok(fifth.ratioText === '3/2' && fifth.name === 'perfect fifth', 'A to E is 3/2, perfect fifth');
  ok(Math.abs(fifth.diff + 1.955) < 0.01, `ET fifth is 1.96 cents narrow (${fifth.diff.toFixed(3)})`);
  const third = intervalInfo(60, 64);
  ok(third.ratioText === '5/4' && Math.abs(third.diff - 13.686) < 0.01, 'major third 5/4, ET 13.7 cents wide');
  const down = intervalInfo(64, 60);
  ok(down.ratioText === '4/5' && down.down, 'a falling major third is 4/5');
  ok(intervalInfo(40, 64).ratioText === '4/1' && intervalInfo(40, 64).name === '2 octaves', 'E2 to E4 is 4/1');
  ok(intervalInfo(48, 64).ratioText === '5/2' && intervalInfo(48, 64).name === 'major tenth', 'C3 to E4 is 5/2');
  ok(intervalInfo(55, 55).ratioText === '1/1', 'unison 1/1');
  const E = chordRatios([40, 47, 52, 56, 59, 64], 4);
  ok(E.text === '2 : 3 : 4 : 5 : 6 : 8', `open E chord is ${E.text}`);
  const Am = chordRatios([45, 52, 57, 60, 64], 9);
  ok(Am.text === '10 : 15 : 20 : 24 : 30', `open Am chord is ${Am.text}`);
  const G = chordRatios([43, 47, 50, 55, 59, 67], 7);
  ok(G.text === '4 : 5 : 6 : 8 : 10 : 16', `open G chord is ${G.text}`);
  const sp = sharedPartials(110, 165, 8);
  ok(sp.length && sp[0].i === 3 && sp[0].j === 2, 'A2 and E3 share harmonic 3 = 2');
  const d = describeNote(INSTRUMENTS.steel, { midi: 57, string: 1, fret: 12 }, { prev: 45, rootPc: 9 });
  ok(Math.abs(d.f - 220) < 1e-9 && Math.abs(d.lengthM - INSTRUMENTS.steel.scaleM / 2) < 1e-12, 'A3 at fret 12: 220 Hz, half the scale');
  ok(d.fromPrev.ratioText === '2/1' && d.fromRoot.ratioText === '1/1', 'octave from previous, unison over root');
  ok(Math.abs(d.waveSpeed / (2 * INSTRUMENTS.steel.scaleM) - midiToFreq(45)) < 1e-6, 'wave speed / 2L gives the open string pitch');
}

group('sound policy');
ok(soundPolicy(1).sound && soundPolicy(0.1).sound, 'auto: sound at 1 and 1/10');
ok(!soundPolicy(0.01).sound && !soundPolicy(0.001).sound, 'auto: muted at 1/100 and 1/1000');
ok(soundPolicy(0.001, 'always').sound, 'always: sound at 1/1000');
ok(!soundPolicy(0.1, 'slowmute').sound && soundPolicy(1, 'slowmute').sound, 'slowmute: sound only at real time');
ok(EXTREME_SCALE > 0.01 && EXTREME_SCALE < 0.1, 'the extreme limit is between 1/100 and 1/10');

group('full chord patterns');
for (const prog of PROGRESSIONS) {
  const pat = prog.meter === 3 ? STRUM_PATTERNS.find((p) => p.meter === 3) : STRUM_PATTERNS[2];
  const audio = new AudioEngine({ createContext: () => createStubContext() });
  audio.start();
  const seen = [];
  const cs = new ChordSession({
    bpm: 120,
    onEvent: (ev) => {
      seen.push(ev);
      audio.playChord({ instrument: ev.instrument, frets: ev.strum.shape.frets, direction: ev.strum.dir === 'U' ? 'up' : 'down' });
    },
  });
  cs.setProgression(prog, pat);
  ok(cs.events.length > 0 && cs.events.every((e) => e.shape), `${prog.name}: ${cs.events.length} strums, all with shapes`);
  cs.play();
  let frames = 0;
  while (cs.playing && frames < 100000) { cs.tick(1 / 30, 1); frames++; }
  ok(seen.length === cs.events.length, `${prog.name}: plays every strum (${seen.length})`);
  const want = (prog.chords.length * prog.beatsPerChord * 60) / 120;
  ok(Math.abs(frames / 30 - want) < 0.1, `${prog.name}: ${(frames / 30).toFixed(2)} s at 120 bpm (want ${want.toFixed(2)})`);
  ok(audio.ctx.log.started.length === seen.reduce((a, e) => a + e.strum.shape.frets.filter((f) => f >= 0).length, 0), `${prog.name}: one source per ringing string`);
  const r = chordRatios(seen[0].midis, null);
  ok(r.ints.length >= 2, `${prog.name}: first chord ${seen[0].strum.chord} = ${r.text}`);
}
{
  const cs = new ChordSession({});
  cs.setProgression(PROGRESSIONS[0], STRUM_PATTERNS[0]);
  let k = 0;
  while (cs.next()) k++;
  ok(k === cs.events.length && cs.atEnd, 'chord step mode visits every strum once');
  ok(cs.prev().i === cs.events.length - 2, 'chord prev() goes back one strum');
  ok(findShape('B7') && findShape('E7') && findShape('A7'), 'the blues shapes exist');
}

group('marker parse');
{
  const song = songFromNotes([{ t: 0, dur: 1, midi: 60 }], { bpm: 120 });
  song.tracks[0].splice(1, 0, { tick: 0, type: 'meta', metaType: 0x06, text: 'chord:F#m7' }, { tick: 480, type: 'meta', metaType: 0x06, text: 'verse' });
  const m = chordMarkers(parseMidi(writeMidi(song)));
  ok(m.length === 1 && m[0].name === 'F#m7' && m[0].rootPc === 6, 'chord:F#m7 marker gives root F#; other markers are skipped');
}

group('ui module links');
{
  const ui = await import('./ui.js');
  ok(typeof ui.mountPlayback === 'function', 'ui.js links and exports mountPlayback');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
