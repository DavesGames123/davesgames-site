# Retro Shelf: licence review

This file is the gate for the Retro Shelf page. A game goes on the shelf only
when the rights holder's own terms let us give it away from this site,
unchanged and free of charge. When the terms are not clear, the game stays
off the shelf. The review date is 2026-10-13.

The site hosts each game as the archive that the rights holder released. We
do not change, repack or cut the archive. The browser unpacks it in memory
when a person presses Play. The licence text in each archive stays with it.
`games.json` holds the sha256 of each archive, and `tools/retro-fetch.mjs`
and `tests.mjs` check it.

The site charges nothing, shows no advertising and sells nothing on this
page. The site also links to the Steam page of Stella Nova, the owner's own
game. That fact is the reason that we left out one game (Quake, see below).

## Games on the shelf

| Game | Rights holder | Archive (sha256) | Primary source of the terms | Licence file in the archive |
|---|---|---|---|---|
| DOOM (shareware episode, v1.9) | id Software | `doom19s.zip` (`cacf0142b31ca1af00796b4a0339e07992ac5f21bc3f81e7532fe1b5e1b486e6`) | id Software's own shareware release, file `idstuff/doom/doom19s.zip` of the id FTP archive, mirrored by idgames: https://youfailit.net/pub/idgames/idstuff/doom/doom19s.zip | `DOOMS_19.DAT` (installer text) and `README.TXT` (in `DOOMS_19.1` + `DOOMS_19.2`) |
| Beneath a Steel Sky (floppy, 1.3) | Revolution Software Ltd | `BASS-Floppy-1.3.zip` (`d0bac1bd61747a67e885fa44b78c78887bf2b15d3dfa2790c483fad651078818`) | https://www.scummvm.org/games/ (download https://downloads.scummvm.org/frs/extras/Beneath%20a%20Steel%20Sky/BASS-Floppy-1.3.zip) | `readme.txt`, "The Legal Stuff" |
| Flight of the Amazon Queen (floppy) | John Passfield and Steven Stamatiadis | `FOTAQ_Floppy.zip` (`2e59de85f708cdb32bf85c85b394ac091c05f7647e856b71f5b3ae73fde761e0`) | https://www.scummvm.org/games/ (download https://downloads.scummvm.org/frs/extras/Flight%20of%20the%20Amazon%20Queen/FOTAQ_Floppy.zip) | `FOTAQ_Floppy/readme.txt`, "The Legal Stuff" |
| Lure of the Temptress (1.1, English) | Revolution Software Ltd | `lure-1.1.zip` (`f3178245a1483da1168c3a11e70b65d33c389f1f5df63d4f3a356886c1890108`) | https://www.scummvm.org/games/ (download https://downloads.scummvm.org/frs/extras/Lure%20of%20the%20Temptress/lure-1.1.zip) | `lure/LICENSE.txt` |
| Drascula: The Vampire Strikes Back (1.0, English) | Alcachofa Soft S.L. | `drascula-1.0.zip` (`b731f6cb5a22ba8b4c3b3362f570b9a10a67b6cb0b395394b19a94b36e4e42de`) | https://www.scummvm.org/games/ (download https://downloads.scummvm.org/frs/extras/Drascula_%20The%20Vampire%20Strikes%20Back/drascula-1.0.zip) | `readme.txt`, "The Legal Stuff" |
| Sołtys (English 1.0) | Laboratorium Komputerowe Avalon | `soltys-en-v1.0.zip` (`87b89e654b8a5b8ebe342cb4c5c6049ab9a43a5efb474d9c49bafb77dcce48f6`) | https://www.scummvm.org/games/ (download https://downloads.scummvm.org/frs/extras/Soltys/soltys-en-v1.0.zip) | `license.txt` |
| Sfinx (English 1.1) | Laboratorium Komputerowe Avalon | `sfinx-en-v1.1.zip` (`f516b30a046526f78cbc923d8f907d267ab964ccd9b770afc72350e8d467ec4d`) | https://www.scummvm.org/games/ (download https://downloads.scummvm.org/frs/extras/Sfinx/sfinx-en-v1.1.zip) | `sfinx-en-v1.1/license.txt` |

The six ScummVM archives have the same sha256 as the `.sha256` files that
downloads.scummvm.org publishes next to them (checked 2026-10-13). The DOOM
archive has the same sha256 on two idgames mirrors (youfailit.net and
ftpmirror1.infania.net). A third mirror (quaddicted.com) serves a different
file, so the fetch tool does not use it.

### DOOM: the terms and why they are enough

The DOOM v1.9 shareware package has no licence document. id Software put
its terms into the package itself. The installer data file `DOOMS_19.DAT`
says, word for word:

```text
LINE0=DOOM
LINE1=Version 1.9
LINE2=Created by id Software
LINE3=Copyright (C) 1993-1995
LINE5=SHAREWARE VERSION
LINE6=PLEASE DISTRIBUTE!!!
```

`README.TXT` (inside the self-extractor) adds one request, word for word:

```text
id Software respectfully requests that you do not modify the
levels for the shareware version of DOOM.  We feel that the
distribution of new levels that work with the shareware version
of DOOM will lessen a potential user's incentive to purchase the
registered version.
```

`DOOM.EXE` prints "do not distribute" only for the registered and
commercial versions. The shareware version has no such text. We read
"SHAREWARE VERSION / PLEASE DISTRIBUTE!!!" as a clear grant to give the
unchanged package away free of charge. We host the unchanged zip, we load
no other levels, and we charge nothing.

Caution: the grant is a short statement, not a formal licence. id Software
(now part of ZeniMax Media and Microsoft) can still ask us to remove the
file. If that happens, remove the `game-doom` record from
`stella-nova/vendor/retro/retro.lock.json` and the `doom` entry from
`games.json`.

### The ScummVM freeware games: the terms

Each of the six archives has a licence with the same five or six clauses.
Clauses 1 and 3 are the ones that matter here. The full text of each
licence is in the appendix, word for word.

- Clause 1: "You may distribute this game for free on any medium, provided
  this readme [or license] and all associated copyright notices and
  disclaimers are left intact."
- Clause 3: "You may not charge a fee for the game itself."

We serve the archive unchanged, so the readme and the notices stay intact.
The credits table on the page names the rights holder of each game, and
links to the licence file.

## Games that are not on the shelf

| Game | Reason |
|---|---|
| Quake (shareware 1.06, `quake106.zip`) | The licence (`SLICNSE.TXT` in `resource.1`) lets end users give the software away "free of charge only ... as a whole". But clause 2(f) forbids any use "for any commercial purpose", and clause 3(d) forbids to "Publicly display the Software". This site promotes a commercial game (Stella Nova). The terms are not clear for a site of this type, so Quake stays off. The clauses are quoted below. |
| Wolfenstein 3D (shareware 1.4) | id Software no longer hosts the shareware package, and the idgames archive has no copy. The only copies that we found are on third-party sites (for example dosgamesarchive.com: `1wolf14.zip`, a "BBS" repack). The terms are in `VENDOR.DOC`, which is packed inside the Apogee installer format. We could not read it from a primary source. |
| Commander Keen 1 (shareware) | Same as Wolfenstein 3D: no copy from the rights holder, and the `VENDOR.DOC` terms could not be read from a primary source. The third-party download that we tried refused the request (HTTP 403). |
| Cave Story (original freeware, 2004) | Studio Pixel no longer offers the freeware download (https://studiopixel.jp/ has no download), and the game is now licensed to Nicalis. We found no current statement from the author that permits redistribution. |
| God of Thunder (freeware version) | ScummVM offers it, but the `LICENSE.TXT` in `gotfree.zip` says: "The End User may not rent, lease, sell, or otherwise distribute the Software." |
| DreamWeb (UK floppy 1.1) | The licence permits free redistribution. We left it out on purpose because of its mature content (nudity and a sex scene), which does not suit this site. |
| Broken Sword 2.5, Nippon Safes Inc., The Griffon Legend, Mystery House | Not reviewed. Broken Sword 2.5 is 860 MB. The others need engines that the ScummVM build of this page does not have. |
| Any commercial game, ROM, disc image or BIOS | Never hosted. The "Bring your own disc" section loads only a file that the person picks from their own device. |

### Quake shareware: the clauses that keep it off

From `SLICNSE.TXT` (in `resource.1` of `quake106.zip`, sha256
`ec6c9d34b1ae0252ac0066045b6611a7919c2a0d78a3a66d9387a8f597553239`), word
for word:

```text
2.      Commercial Use is Prohibited.  Under no circumstances shall
        you, the end-user, be permitted, allowed or authorized to
        commercially exploit the Software, or any portion thereof, such 
        as a screen display or a screenshot.  Neither you nor anyone at your
        direction shall do any of the following acts:

        a.      Rent the Software;

        b.      Sell the Software;

        c.      Lease or lend the Software;

        d.      Offer the Software on a pay-per-play basis;

        e.      Distribute the Software for money or any other
                consideration; or 

        f.      In any other manner and through any medium
                whatsoever commercially exploit the Software or use
                the Software for any commercial purpose. 

        3.      Additional Prohibited Uses.  Neither you, nor anyone at your
        direction, shall take the following action in regard to the
        Software, or any portion thereof, such as a screen display or 
        a screenshot:

        a.      Modify, disassemble, reverse engineer or decompile
                the Software; 

        b.      Translate the Software;

        c.      Reproduce the Software;

        d.      Publicly display the Software; or

        e.      Prepare derivative works based upon the Software.

        6.      Permitted Distribution. So long as this Agreement
        accompanies the Software at all times, ID grants to Providers the
        limited right to distribute, free of charge, except normal access
        fees, and by electronic means only, the Software; provided, however,
        the Software must be so electronically distributed only in a
        compressed format. The term "Providers," as used in the foregoing
        sentence, shall mean persons whose business it is to provide
        services on the Internet, on commercial online networks, or on the
        BBS. Anyone who receives the Software from a Provider shall be
        limited to all the terms and conditions of this Agreement. Further,
        ID grants to you, the end-user, the limited right to distribute,
        free of charge only, the Software as a whole.
```

## Engines

| Engine | Version | Licence | Exact source | Where the files come from |
|---|---|---|---|---|
| js-dos emulators (DOSBox compiled to WebAssembly) | `emulators` 8.5.2 | GPL-2.0 (`LICENSE` in the package) | https://github.com/caiiiycuk/emulators/tree/6bbf0925d221a7304ea8e0dda1e89b8dc01569b2 (the `gitHead` of the npm package) | https://registry.npmjs.org/emulators/-/emulators-8.5.2.tgz, fetched at deploy, sha256 pinned |
| ScummVM (WebAssembly build) | 2026.4.0 | GPL-3.0-or-later (`doc/COPYING`, `doc/COPYRIGHT` in the build folder) | https://github.com/scummvm/scummvm/tree/v2026.4.0 (commit 7d2709da5136866589f7602f5f5a7b17de03420e), plus the build script and the one pre-js hook in `stella-nova/vendor/scummvm-web@2026.4.0/build/` | Built for this site with Emscripten 4.0.10 and committed under `stella-nova/vendor/scummvm-web@2026.4.0/` |
| EmulatorJS (player for the "Bring your own disc" section) | 4.2.3 | GPL-3.0 (`LICENSE` in the package) | https://github.com/EmulatorJS/EmulatorJS/tree/v4.2.3 (commit e150dc0491ae747028919fb82d6598954976ede6) | https://registry.npmjs.org/@emulatorjs/emulatorjs/-/emulatorjs-4.2.3.tgz, fetched at deploy, sha256 pinned |

The ScummVM build has six engines: sky, queen, lure, drascula, cge and cge2.
The build does not change the ScummVM source. It adds one `--pre-js`
file (`retro-pre.js`) at link time. That file gives the page the
Emscripten file system before `main()` runs, so the page can write the
unpacked game files into `/games/<id>`.

### Emulator cores ("Bring your own disc")

EmulatorJS builds each core with https://github.com/EmulatorJS/build. The
npm package does not name the source commit. The table gives the last
commit of each source repository before the build start time in
`reports/<core>.json` (from the GitHub API, 2026-10-13).

| System | Core (npm 4.2.3) | Licence (`license.txt` in the core) | Source at build time |
|---|---|---|---|
| PlayStation | pcsx_rearmed | GPL-2.0 | https://github.com/EmulatorJS/pcsx_rearmed/tree/f29871dde1742cafb0ab56ba33636a8600bbbd80 |
| Nintendo 64 | mupen64plus_next | GPL-2.0 | https://github.com/EmulatorJS/mupen64plus-libretro-nx/tree/0346d3ef26016bb4de604cf918d004bd791447ee |
| NES and Famicom Disk System | fceumm | GPL-2.0 | https://github.com/EmulatorJS/libretro-fceumm/tree/d9d7e141274d07186b6a871ca2919b6f13cfb2f9 |
| Game Boy and Game Boy Color | gambatte | GPL-2.0 | https://github.com/EmulatorJS/gambatte-libretro/tree/811b1f7a56c16f8588caada36d7a3f9a56cb16d4 |
| Game Boy Advance | mgba | MPL-2.0 | https://github.com/EmulatorJS/mgba/tree/57678d6180e7020798809703283e02d2bba18b63 |

Build tool for all cores: https://github.com/EmulatorJS/build/tree/b24e5b535034dc7c3428d76f236d4793881969b6.

The PlayStation core has a high-level BIOS (HLE) inside it, so the page
needs no Sony BIOS file. A person can pick their own BIOS file if they own
one. The Game Boy Advance core (mGBA) also has its own HLE BIOS.

Systems that are not offered, and why:

- Super Nintendo: the only EmulatorJS core is snes9x. Its licence permits
  use "for non-commercial purposes" only. For the reason given for Quake,
  we do not host it.
- Sega Mega Drive and Genesis: genesis_plus_gx and picodrive both have
  non-commercial licences. Same reason.
- Systems that need a BIOS with no free replacement (for example the Sega
  Saturn and the PC Engine CD): not offered.

## Appendix: the licence of each ScummVM archive, word for word

### BASS-Floppy-1.3.zip : readme.txt

```text
License:
 1) You may distribute this game for free on any medium, provided this readme
and all associated copyright notices and disclaimers are left intact.

 2) You may charge a reasonable copying fee for this archive, and may distribute
it in aggregate as part of a larger & possibly commercial software distribution
(such as a Linux distribution or magazine coverdisk). You must provide proper
attribution and ensure this readme and all associated copyright notices, and
disclaimers are left intact.

 3) You may not charge a fee for the game itself. This includes reselling the
game as an individual item.

 4) You may modify the game as you wish.  You may also distribute modified
versions under the terms set forth in this license, but with the additional
requirement that the work is marked with a prominent notice which states that
it is a modified version.

 5) All game content is (C) Revolution Software Ltd. The ScummVM engine is (C)
The ScummVM Team (www.scummvm.org)

 6) THE GAMEDATA IN THIS ARCHIVE IS PROVIDED "AS IS" AND WITHOUT ANY EXPRESS OR
IMPLIED WARRANTIES, INCLUDING AND NOT LIMITED TO ANY IMPLIED WARRANTIES OF
MERCHANTIBILITY AND FITNESS FOR A PARTICULAR PURPOSE.
```

### FOTAQ_Floppy.zip : FOTAQ_Floppy/readme.txt

```text
Licence:
 1) You may distribute this game for free on any medium, provided this Readme
and all associated copyright notices and disclaimers are left intact.

 2) You may charge a reasonable copying fee for this archive, and may
distribute it in aggregate as part of a larger and possibly commercial software
distribution (such as a Linux distribution or magazine coverdisk). You must
provide proper attribution and ensure that this Readme and all associated
copyright notices and disclaimers are left intact.

 3) You may not charge a fee for the game itself. This includes reselling the
game as an individual item.

 4) You may modify the game as you wish.  You may also distribute modified
versions under the terms set forth in this licence, but with the additional
requirement that the work is marked with a prominent notice which states that
it is a modified version.

 5) All game content is (C) John Passfield and Steven Stamatiadis.
    The ScummVM engine is (C) The ScummVM Team (www.scummvm.org).

 6) THE GAME DATA IN THIS ARCHIVE IS PROVIDED "AS IS" AND WITHOUT ANY EXPRESS OR
IMPLIED WARRANTIES, INCLUDING AND NOT LIMITED TO ANY IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE.
```

### lure-1.1.zip : lure/LICENSE.txt

```text
Lure of the Temptress, PC DOS version         (C) Revolution Software Ltd 1992-
-------------------------------------         ---------------------------------

 1) You may distribute this game for free on any medium, provided this license 
and all associated copyright notices and disclaimers are left intact.

 2) You may charge a reasonable copying fee for this archive, and may distribute
it in aggregate as part of a larger & possibly commercial software distribution
(such as a Linux distribution or magazine coverdisk). You must provide proper
attribution and ensure this license and all associated copyright notices, and
disclaimers are left intact.

 3) You may not charge a fee for the game itself. This includes reselling the
game as an individual item.

 4) You may modify the game as you wish.  You may also distribute modified
versions under the terms set forth in this license, but with the additional
requirement that the work is marked with a prominent notice which states that
it is a modified version.

 5) All game content is (C) Revolution Software Ltd.

 6) THE GAMEDATA IN THIS ARCHIVE IS PROVIDED "AS IS" AND WITHOUT ANY EXPRESS OR
IMPLIED WARRANTIES, INCLUDING AND NOT LIMITED TO ANY IMPLIED WARRANTIES OF
MERCHANTIBILITY AND FITNESS FOR A PARTICULAR PURPOSE.
```

### drascula-1.0.zip : readme.txt

```text
Licence:
 1) You may distribute "DRASCULA" for free on any medium, provided this Readme
and all associated copyright notices and disclaimers are left intact.

 2) You may charge a reasonable copying fee for this archive, and may
distribute it in aggregate as part of a larger and possibly commercial software
distribution (such as a Linux distribution or magazine coverdisk). You must
provide proper attribution and ensure that this Readme and all associated
copyright notices and disclaimers are left intact.

 3) You may not charge a fee for the game itself. This includes reselling the
game as an individual item.

 4) You may modify the game as you wish.  You may also distribute modified
versions under the terms set forth in this licence, but with the additional
requirement that the work is marked with a prominent notice which states that
it is a modified version.

 5) All game content is Copyright (C) Alcachofa Soft S.L.
    The ScummVM engine is Copyright (C) The ScummVM Team (www.scummvm.org).

 6) THE GAME DATA IN THIS ARCHIVE IS PROVIDED "AS IS" AND WITHOUT ANY EXPRESS OR
IMPLIED WARRANTIES, INCLUDING AND NOT LIMITED TO ANY IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE.
```

### soltys-en-v1.0.zip : license.txt

```text
Soltys, PC DOS version English v1.0
-----------------------------------
(C) Laboratorium Komputerowe Avalon 1995-2011
---------------------------------------------

 1) You may distribute this game for free on any medium, provided this license 
and all associated copyright notices and disclaimers are left intact.

 2) You may charge a reasonable copying fee for this archive, and may distribute
it in aggregate as part of a larger & possibly commercial software distribution
(such as a Linux distribution or magazine coverdisk). You must provide proper
attribution and ensure this license and all associated copyright notices, and
disclaimers are left intact.

 3) You may not charge a fee for the game itself. This includes reselling the
game as an individual item.

 4) You may modify the game as you wish.  You may also distribute modified
versions under the terms set forth in this license, but with the additional
requirement that the work is marked with a prominent notice which states that
it is a modified version.

 5) All game content is (C) Laboratorium Komputerowe Avalon.

 6) THE GAMEDATA IN THIS ARCHIVE IS PROVIDED "AS IS" AND WITHOUT ANY EXPRESS OR
IMPLIED WARRANTIES, INCLUDING AND NOT LIMITED TO ANY IMPLIED WARRANTIES OF
MERCHANTIBILITY AND FITNESS FOR A PARTICULAR PURPOSE.
```

### sfinx-en-v1.1.zip : sfinx-en-v1.1/license.txt

```text
Sfinx, PC DOS version English v0.3
----------------------------------
(C) Laboratorium Komputerowe Avalon 1995-2014
---------------------------------------------

 1) You may distribute this game for free on any medium, provided this license 
and all associated copyright notices and disclaimers are left intact.

 2) You may charge a reasonable copying fee for this archive, and may distribute
it in aggregate as part of a larger & possibly commercial software distribution
(such as a Linux distribution or magazine coverdisk). You must provide proper
attribution and ensure this license and all associated copyright notices, and
disclaimers are left intact.

 3) You may not charge a fee for the game itself. This includes reselling the
game as an individual item.

 4) You may modify the game as you wish.  You may also distribute modified
versions under the terms set forth in this license, but with the additional
requirement that the work is marked with a prominent notice which states that
it is a modified version.

 5) All game content is (C) Laboratorium Komputerowe Avalon.

 6) THE GAMEDATA IN THIS ARCHIVE IS PROVIDED "AS IS" AND WITHOUT ANY EXPRESS OR
IMPLIED WARRANTIES, INCLUDING AND NOT LIMITED TO ANY IMPLIED WARRANTIES OF
MERCHANTIBILITY AND FITNESS FOR A PARTICULAR PURPOSE.
```
