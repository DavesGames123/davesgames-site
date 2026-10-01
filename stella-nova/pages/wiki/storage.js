// ============================================================================
//  WIKI  ·  pages/wiki/storage.js — article storage adapter
// ────────────────────────────────────────────────────────────────────────────
//  This classic script sets window.SNWikiStorage. The editor talks to
//  storage through these four calls only. Each call returns a Promise.
//
//    load(id)            -> { draft: Doc|null, published: Doc|null }
//    loadAll()           -> { [id]: { draft, published } }  (ids with any doc)
//    saveDraft(id, doc)  -> Doc   (doc = null deletes the local draft)
//    publish(id, doc)    -> { downloaded: bool, posted: bool, error: string|null }
//
//  Doc = { id, classification, designation, sections: { [key]: markup },
//          updated: ISO time, version: 1 }
//
//  CURRENT IMPLEMENTATION
//    Published docs are static JSON: content/index.json maps id -> Doc. It
//    ships empty ({}). Drafts live in localStorage on this device only.
//    publish() downloads the doc as JSON and posts it to formsubmit.co (the
//    same address as the bug form in pages/home/main.js) with the fields
//    "entry" and "json". The site owner then adds the doc to
//    content/index.json. Until that deploy, this device keeps a local copy
//    of the submitted doc, so the article shows it as published here.
//
//  HOW TO SWAP IN A LIVE BACKEND (edit this file only)
//    1. Replace fetchPublished() with a GET to the backend that returns
//       the same id -> Doc map.
//    2. Replace the body of publish() with a POST or PUT of the doc. Keep
//       the return shape.
//    3. To share drafts between devices, replace readDrafts() and
//       writeDrafts() with backend calls. Keep the Doc shape.
//    editor.js and main.js need no change.
//
//  grep -n targets
//    var ENDPOINT        formsubmit address
//    function fetchPublished
//    function readDrafts / function writeDrafts
//    function download   JSON file download
//    publish:            publish call
// ============================================================================
(function () {
  'use strict';

  var ENDPOINT = 'https://formsubmit.co/ajax/dave@davesgames.io';
  var DRAFTS = 'sn-wiki-drafts-v1';
  var SENT = 'sn-wiki-submitted-v1';
  var published = null;

  function fetchPublished() {
    if (published) return Promise.resolve(published);
    // file:// pages cannot fetch, so they have no published docs.
    if (location.protocol === 'file:') { published = {}; return Promise.resolve(published); }
    return fetch('content/index.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('status ' + r.status); return r.json(); })
      .catch(function () { return {}; })   // file:// or offline: no published docs
      .then(function (j) { published = (j && typeof j === 'object' && !Array.isArray(j)) ? j : {}; return published; });
  }
  function readMap(key) {
    try { var j = JSON.parse(localStorage.getItem(key) || '{}'); return j && typeof j === 'object' ? j : {}; } catch (e) { return {}; }
  }
  function writeMap(key, m) {
    try { localStorage.setItem(key, JSON.stringify(m)); return true; } catch (e) { return false; }
  }
  function readDrafts() { return readMap(DRAFTS); }
  function writeDrafts(m) { return writeMap(DRAFTS, m); }

  function clean(id, doc) {
    var s = {};
    var src = (doc && doc.sections) || {};
    Object.keys(src).forEach(function (k) { if (typeof src[k] === 'string') s[k] = src[k]; });
    return {
      id: id,
      classification: String((doc && doc.classification) || '').slice(0, 80),
      designation: String((doc && doc.designation) || '').slice(0, 80),
      sections: s,
      updated: new Date().toISOString(),
      version: 1
    };
  }
  function both(id, pub) {
    var sent = readMap(SENT);
    return { draft: readDrafts()[id] || null, published: pub[id] || sent[id] || null };
  }

  function download(id, doc) {
    try {
      var blob = new Blob([JSON.stringify(doc, null, 2) + '\n'], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = id.replace('/', '--') + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      return true;
    } catch (e) { return false; }
  }

  window.SNWikiStorage = {
    load: function (id) {
      return fetchPublished().then(function (pub) { return both(id, pub); });
    },
    loadAll: function () {
      return fetchPublished().then(function (pub) {
        var ids = {}, out = {};
        [pub, readMap(SENT), readDrafts()].forEach(function (m) { Object.keys(m).forEach(function (k) { ids[k] = true; }); });
        Object.keys(ids).forEach(function (id) { out[id] = both(id, pub); });
        return out;
      });
    },
    saveDraft: function (id, doc) {
      var m = readDrafts();
      if (doc === null) { delete m[id]; writeDrafts(m); return Promise.resolve(null); }
      var d = clean(id, doc);
      m[id] = d;
      if (!writeDrafts(m)) return Promise.reject(new Error('This browser blocks local storage, so the draft was not saved.'));
      return Promise.resolve(d);
    },
    publish: function (id, doc) {
      var d = clean(id, doc);
      var res = { downloaded: download(id, d), posted: false, error: null };
      var data = new FormData();
      data.append('entry', id);
      data.append('json', JSON.stringify(d));
      data.append('_subject', '[Stella Nova Wiki] ' + id);
      data.append('_captcha', 'false');
      return fetch(ENDPOINT, { method: 'POST', body: data, headers: { Accept: 'application/json' } })
        .then(function (r) { return r.json(); })
        .then(function (j) { if (!j || !(j.success === true || j.success === 'true')) throw new Error((j && j.message) || 'The form service refused the post.'); res.posted = true; })
        .catch(function (e) { res.error = e && e.message ? e.message : String(e); })
        .then(function () {
          // A failed post keeps the draft, so the editor can try again.
          if (!res.posted) return res;
          var sent = readMap(SENT); sent[id] = d; writeMap(SENT, sent);
          var m = readDrafts(); delete m[id]; writeDrafts(m);
          return res;
        });
    }
  };
})();
