# CodeMirror 6 bundle

`codemirror@6.bundle.js` is one ES module that esbuild 0.25.10 made from
`entry.js` (in this folder). The page imports only this file. The
packages are MIT (see LICENSE, copyright Marijn Haverbeke and others).

Packages in the bundle:

    @codemirror/view 6.43.14      @codemirror/state 6.7.6
    @codemirror/commands 6.11.1   @codemirror/language 6.13.1
    @codemirror/lang-python 6.2.1 @codemirror/autocomplete 6.20.3
    @codemirror/search 6.7.2      @codemirror/lint 6.9.7
    @lezer/highlight 1.2.5        @lezer/python 1.1.19
    @lezer/lr 1.4.11              @lezer/common 1.5.3
    style-mod 4.1.4  w3c-keyname 2.2.8  crelt 1.0.7

sha256 of the bundle: 1194d8cf57d11a682e5cc5c49851d7ef99b5ad0f8a5b579c017e9d511a13b311

To make the bundle again:

    npm install codemirror@6.0.2 @codemirror/lang-python@6.2.1 \
      @codemirror/view @codemirror/state @codemirror/language \
      @codemirror/commands @codemirror/autocomplete @codemirror/search \
      @codemirror/lint @lezer/highlight esbuild@0.25.10
    npx esbuild entry.js --bundle --format=esm --minify \
      --legal-comments=eof --outfile=codemirror@6.bundle.js

One bundle gives one copy of @codemirror/state. Separate CDN modules can
load two copies, and CodeMirror then stops with "multiple instances".
