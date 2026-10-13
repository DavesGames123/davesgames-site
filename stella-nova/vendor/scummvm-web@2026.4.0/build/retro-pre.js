// Retro Shelf (davesgames.io) build hook. Added with --pre-js at link time.
// Before main() runs, give the Emscripten FS to the host page, so the page
// can write the files of a freeware game (unpacked from its unchanged zip)
// into /games/<id>. The page passes the game path in the URL hash.
Module['preRun'] = Module['preRun'] || [];
Module['preRun'].push(function () {
  if (typeof Module['retroFS'] !== 'function') return;
  addRunDependency('retro-fs');
  Promise.resolve(Module['retroFS'](FS)).then(
    function () { removeRunDependency('retro-fs'); },
    function (e) { console.error('retro-fs', e); removeRunDependency('retro-fs'); });
});
