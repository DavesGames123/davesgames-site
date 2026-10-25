// ============================================================================
//  STEREOGRAM HISTORY  ·  data.js — sources, timeline, Tyler's work
// ----------------------------------------------------------------------------
//  Every date and name on the page comes from this file, and each item
//  names its source ids. The sources were fetched on 2026-10-24:
//
//    Crossref records (title, authors, journal, volume, pages, year) of
//      every DOI below.
//    wheatstone1838 . the scan text of the paper (archive.org item
//      jstor-108203). The quotes on the page are copied from it.
//    brewster1856 ... the Project Gutenberg text (eBook 71483). The
//      wallpaper quotes and the 1849-1851 lens stereoscope story are
//      copied from it.
//    tyler2014 ...... the Scholarpedia article "Autostereogram" by
//      C. W. Tyler (archive.org copy of revision 195873). Most of the
//      1968-1994 timeline comes from its "Historical Timeline".
//    tylerNAS ....... Tyler's NAS memoir of Bela Julesz (PDF).
//    tylerCV ........ Tyler's own curriculum vitae (PDF, 2025): positions
//      and the publication list.
//    tiw1994 ........ the PDF of the paper (SFU course copy): the
//      separation formula, mu = 1/3, eye separation 2.5 in, echoes.
//    peck1979 ....... the Google Patents record of US 4,135,502.
//    magiceyeFaq .... the company's own FAQ page.
//
//  Not fetched: Tyler (1983), the first printed autostereograms, and the
//  1994 "CG Stereogram" book. The page cites them through tyler2014.
//
//  UNSURE DATES. An item with `unsure` carries a note that says why. The
//  page shows a "date unsure" tag on it.
//
//  grep -n targets
//    sources .............. "export const SOURCES"
//    timeline ............. "export const TIMELINE"
//    Tyler's papers ....... "export const TYLER_WORKS"
//    Tyler's positions .... "export const TYLER_POSITIONS"
//    quotes ............... "export const QUOTES"
//    viewing numbers ...... "export const VIEW"
// ============================================================================

export const SOURCES = Object.freeze({
  wells1792: { cite: 'W. C. Wells 1792, An essay upon single vision with two eyes (London). Reprinted with commentary in N. J. Wade 2003, Destined for distinguished oblivion: the scientific vision of William Charles Wells, ch. 3', doi: '10.1007/978-1-4615-0213-5_3' },
  wheatstone1838: { cite: 'C. Wheatstone 1838, "Contributions to the physiology of vision. Part the first. On some remarkable, and hitherto unobserved, phenomena of binocular vision", Philosophical Transactions of the Royal Society of London 128, 371-394', doi: '10.1098/rstl.1838.0019', url: 'https://archive.org/details/jstor-108203' },
  brewster1844: { cite: 'D. Brewster 1844, "On the knowledge of distance given by binocular vision", Transactions of the Royal Society of Edinburgh 15, 663-675', doi: '10.1017/S0080456800030246' },
  brewster1856: { cite: 'D. Brewster 1856, The stereoscope: its history, theory, and construction (London: John Murray). Project Gutenberg eBook 71483', url: 'https://www.gutenberg.org/ebooks/71483' },
  julesz1960: { cite: 'B. Julesz 1960, "Binocular depth perception of computer-generated patterns", Bell System Technical Journal 39(5), 1125-1162', doi: '10.1002/j.1538-7305.1960.tb03954.x' },
  julesz1962: { cite: 'B. Julesz, J. E. Miller 1962, "Automatic stereoscopic presentation of functions of two variables", Bell System Technical Journal 41, 663-676', doi: '10.1002/j.1538-7305.1962.tb02424.x' },
  julesz1971: { cite: 'B. Julesz 1971, Foundations of cyclopean perception (Chicago: University of Chicago Press)', url: null },
  tylerNAS: { cite: 'C. W. Tyler 2014, "Bela Julesz 1928-2003", Biographical Memoirs, National Academy of Sciences', url: 'https://www.nasonline.org/wp-content/uploads/2024/06/julesz-bela.pdf' },
  tyler1971: { cite: 'C. W. Tyler 1971, "Stereoscopic depth movement: two eyes less sensitive than one", Science 174, 958-961', doi: '10.1126/science.174.4012.958' },
  tyler1974: { cite: 'C. W. Tyler 1974, "Depth perception in disparity gratings", Nature 251, 140-142', doi: '10.1038/251140a0' },
  allenmark2010: { cite: 'G. Allenmark, J. C. A. Read 2010, "Detectability of sine- versus square-wave disparity gratings: a challenge for current models of depth perception", Journal of Vision 10(8), 17', doi: '10.1167/10.8.17' },
  tylerjulesz1980: { cite: 'C. W. Tyler, B. Julesz 1980, "On the depth of the cyclopean retina", Experimental Brain Research 40, 196-202', url: null },
  tyler1979: { cite: 'C. W. Tyler, P. Apkarian, D. M. Levi, K. Nakayama 1979, "Rapid assessment of visual function: an electronic sweep technique for the pattern visual evoked potential", Investigative Ophthalmology & Visual Science 18(7), 703-713', url: null },
  norcia1985: { cite: 'A. M. Norcia, C. W. Tyler 1985, "Spatial frequency sweep VEP: visual acuity during the first year of life", Vision Research 25(10), 1399-1408', url: null },
  tyler1998: { cite: 'C. W. Tyler 1998, "Painters centre one eye in portraits", Nature 392, 877-878', url: null },
  tylerclarke1990: { cite: 'C. W. Tyler, M. B. Clarke 1990, "The autostereogram", Proc. SPIE 1256, Stereoscopic Displays and Applications, 182-197', doi: '10.1117/12.19904' },
  tyler2014: { cite: 'C. W. Tyler 2014, "Autostereogram", Scholarpedia 9(4), 9229', doi: '10.4249/scholarpedia.9229', url: 'http://www.scholarpedia.org/article/Autostereogram' },
  tylerCV: { cite: 'C. W. Tyler, curriculum vitae (2025), positions and publications', url: 'https://christophertyler.org/wp-content/uploads/2017/12/CV_CWT_2025_full.pdf' },
  peck1979: { cite: 'D. Peck, "Stereoscopic patterns and method of making same", US Patent 4,135,502 (filed 7 September 1976, granted 23 January 1979)', url: 'https://patents.google.com/patent/US4135502A/en' },
  stork1989: { cite: 'D. G. Stork, C. Rocca 1989, "Software for generating auto-random-dot stereograms", Behavior Research Methods, Instruments, & Computers 21, 525-534', doi: '10.3758/BF03202884' },
  tiw1994: { cite: 'H. W. Thimbleby, S. Inglis, I. H. Witten 1994, "Displaying 3D images: algorithms for single-image random-dot stereograms", IEEE Computer 27(10), 38-48', doi: '10.1109/2.318576' },
  magiceyeFaq: { cite: 'Magic Eye Inc., "Who invented Magic Eye stereograms?" (the company\'s own account)', url: 'https://www.magiceye.com/faq-items/who-invented-magic-eye-stereograms/' },
});

export const SRC_IDS = Object.keys(SOURCES);
export const srcUrl = id => { const s = SOURCES[id]; return s.doi ? `https://doi.org/${s.doi}` : s.url; };

// Short quotes, copied from the fetched texts.
export const QUOTES = Object.freeze({
  wheatstoneName: { src: 'wheatstone1838', text: 'I therefore propose that it be called a Stereoscope, to indicate its property of representing solid figures.' },
  wheatstoneMirrors: { src: 'wheatstone1838', text: 'two plane mirrors, about four inches square, inserted in frames, and so adjusted that their backs form an angle of 90° with each other' },
  wheatstoneOutline: { src: 'wheatstone1838', text: 'For the purposes of illustration I have employed only outline figures, for had either shading or colouring been introduced it might be supposed that the effect was wholly or in part due to these circumstances' },
  brewsterWall: { src: 'brewster1856', text: 'the whole papered wall with all its flowers will be seen suspended in the air at the distance of six inches from the observer!' },
  brewsterRelief: { src: 'brewster1856', text: 'If the distance, for example, between two corresponding leaves is greater than the distance between other two corresponding leaves, then the two first when united will appear nearer the eye than the other two' },
  brewsterDefect: { src: 'brewster1856', text: 'thus displaying on a large scale the imperfection in the workmanship which otherwise it would have been difficult to discover' },
});

// One row per event. y: the year shown. srcs: source ids. unsure: a
// note when sources disagree or the date is second-hand.
export const TIMELINE = Object.freeze([
  { y: '1792', t: 'Single vision with two eyes', d: 'William Charles Wells publishes an essay on how the two eyes give one view.', srcs: ['wells1792', 'tyler2014'] },
  { y: '1838', t: 'Wheatstone names the stereoscope', d: 'Charles Wheatstone shows that two flat drawings, one for each eye, give a solid figure, and describes a mirror instrument to view them. The paper was read to the Royal Society on 21 June 1838.', srcs: ['wheatstone1838'] },
  { y: '1844', t: 'Brewster and the wallpaper', d: 'In April 1844 David Brewster reads a paper in Edinburgh on the false distances seen when the eyes join two neighbouring figures of a wallpaper or carpet.', srcs: ['brewster1844', 'brewster1856'] },
  { y: '1849-51', t: 'The lens stereoscope', d: 'Brewster shows his lens stereoscope to the British Association in Birmingham (1849), takes one to Paris (1850), where Jules Duboscq makes it for sale, and Duboscq shows it at the Great Exhibition of 1851.', srcs: ['brewster1856'] },
  { y: '1858', t: 'Colour anaglyph projection', d: 'Joseph D\'Almeida projects stereo pictures in two colours.', srcs: ['tyler2014'], unsure: 'from Tyler\'s timeline only; other histories name earlier anaglyph work' },
  { y: '1939', t: 'Camouflaged blob stereograms', d: 'Boris Kompaneysky publishes a two-image stereogram of random blobs in Russia.', srcs: ['tyler2014'], unsure: 'from Tyler\'s timeline only' },
  { y: '1960', t: 'Julesz: the random-dot stereogram', d: 'Bela Julesz at Bell Labs makes stereo pairs of computer random dots: each image alone shows nothing, the pair shows a shape in depth.', srcs: ['julesz1960', 'tylerNAS'], unsure: 'the paper is 1960; some accounts date the first images to 1959' },
  { y: '1962', t: 'Two surfaces in one pair', d: 'Julesz and Joan Miller code two independent depth surfaces in one stereo pair. Tyler notes that one image of such a pair is, in effect, a random-dot autostereogram, and that there is no record that Julesz saw this.', srcs: ['julesz1962', 'tyler2014'] },
  { y: '1968', t: 'Repeats that change their spacing', d: 'Pete Stephens, a student at Claremont Graduate School, finds the depth effect of repeated images with different spacings and makes paper-cutout works from it.', srcs: ['tyler2014'] },
  { y: '1970', t: 'A hand-made random-dot autostereogram', d: 'Masayuki Ito designs a fully camouflaged random-dot autostereogram of flat squares by hand.', srcs: ['tyler2014'], unsure: 'Tyler\'s article spells the first name both Masayuki and Masuhiro' },
  { y: '1971', t: 'Foundations of Cyclopean Perception', d: 'Julesz\'s book. He names the depth seen only by the joined eyes "cyclopean", after Hering\'s single imaginary eye of 1868.', srcs: ['julesz1971', 'tylerNAS'] },
  { y: '1972', t: 'Line autostereograms', d: 'Edward Trent publishes line autostereograms with continuous depth in the Bulletin of the Stereoscopic Society.', srcs: ['tyler2014'] },
  { y: '1979', t: 'Peck\'s patent', d: 'US Patent 4,135,502 to Donald Peck: horizontal rows of repeated figures whose spacing varies to give depth. Filed in 1976.', srcs: ['peck1979'] },
  { y: '1979', t: 'Tyler and Clarke: one image, any depth', d: 'Christopher Tyler and programmer Maureen Clarke make the look-back algorithm that turns any depth map into a random-dot autostereogram, on an Apple II with a dot-matrix printer.', srcs: ['tyler2014', 'tylerclarke1990', 'tylerCV'] },
  { y: '1983', t: 'First printed', d: 'The first publication of Tyler and Clarke\'s autostereograms, in a vision-science text.', srcs: ['tyler2014'], unsure: 'not fetched; the date is from Tyler\'s timeline' },
  { y: '1986', t: 'A frontispiece', d: 'David Stork uses a random-dot autostereogram made with Chris Rocca as the frontispiece of the book Seeing the Light. Their program follows in 1989.', srcs: ['tyler2014', 'stork1989'] },
  { y: '1988', t: 'The first moving one', d: 'Dan Dyckman makes "Echodots", an animated autostereogram.', srcs: ['tyler2014'] },
  { y: '1990', t: '"The autostereogram"', d: 'Tyler and Clarke publish the algorithm, with two-way and depth-cycling autostereograms and "autolustergrams", at the SPIE Stereoscopic Displays and Applications meeting.', srcs: ['tylerclarke1990', 'tyler2014'], unsure: 'the SPIE volume is dated 1990; Tyler\'s timeline says 1991' },
  { y: '1991', t: 'Colour from a company', d: 'Tom Baccei and Cheri Smith, with programmer Bob Salitsky, make full-colour autostereograms at N.E. Thing Enterprises.', srcs: ['magiceyeFaq'], unsure: 'the company\'s own account' },
  { y: '1993', t: 'The bestseller books', d: 'The first Magic Eye book ("A New Way of Looking at the World") begins a long series. Magic Eye is a trademark of its owner.', srcs: ['tyler2014', 'magiceyeFaq'] },
  { y: '1994', t: 'A symmetric algorithm', d: 'Thimbleby, Inglis and Witten publish a symmetric algorithm with hidden-surface removal and a fix for "echoes". Most modern generators, this page included, follow it.', srcs: ['tiw1994'] },
]);

// Tyler's positions, from his CV. Public record only.
export const TYLER_POSITIONS = Object.freeze([
  { y: '1970', t: 'Ph.D., University of Keele (neurocommunication)' },
  { y: '1974-75', t: 'Research fellow, Department of Sensory and Perceptual Processes, Bell Laboratories (the department of Julesz)' },
  { y: '1975', t: 'Joins the Smith-Kettlewell Eye Research Institute, San Francisco; senior scientist from 1982' },
  { y: '1990-2003', t: 'Associate director, Smith-Kettlewell' },
  { y: '2002', t: 'Head of the Smith-Kettlewell Brain Imaging Center' },
  { y: '2013', t: 'Professor (part-time), Division of Optometry and Vision Sciences, City St George\'s, University of London' },
]);

// Selected papers. what: one plain sentence, from the title and the
// cited text only, no claim beyond them.
export const TYLER_WORKS = Object.freeze([
  { src: 'tyler1971', what: 'As the title says: for movement in depth, two eyes were less sensitive than one.' },
  { src: 'tyler1974', what: 'Surfaces with a wavy depth profile, seen only by disparity: the finest corrugation that stereo vision can follow is near 3-4 cycles per degree, far coarser than the limit for brightness gratings.', also: ['allenmark2010'] },
  { src: 'tylerjulesz1980', what: 'With Julesz: a study of the depth of the "cyclopean retina", the joined view that random-dot stereograms reach.' },
  { src: 'tyler1979', what: 'The sweep visual evoked potential: a fast way to measure the brain response over a range of stimulus values.' },
  { src: 'norcia1985', what: 'The sweep VEP applied to measure the acuity of infants in the first year of life.' },
  { src: 'tylerclarke1990', what: 'The autostereogram: one printed image that holds a cyclopean depth form, and other free-fusion forms built on it.' },
  { src: 'tyler1998', what: 'As the title says: in portraits, painters tend to put one eye at the centre of the picture. One of many papers by Tyler on vision and art.' },
  { src: 'tylerNAS', what: 'The memoir of Bela Julesz for the National Academy of Sciences.' },
]);

// Viewing numbers of the TIW paper (Figure 3 program and text).
export const VIEW = Object.freeze({ src: 'tiw1994', eyeSepIn: 2.5, mu: 1 / 3, dpi: 72, viewIn: 15, maxDisparityDeg: 0.5 });

// The disparity-grating limit (Allenmark and Read 2010, citing Tyler 1974).
export const GRATING_LIMIT_CPD = Object.freeze({ lo: 3, hi: 4, src: 'allenmark2010' });
