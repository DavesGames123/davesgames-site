// ============================================================================
//  CNN EXPLAINER  ·  data.js  the example photos and the sources
// ----------------------------------------------------------------------------
//  DOM-free. examples/examples.bin holds EXAMPLES.length pictures of
//  64 x 64 x 3 bytes (RGB, row major), in the order of EXAMPLES. Each one
//  is a public-domain or CC0 photo from Wikimedia Commons, cropped to the
//  centre square and box-filtered to 64 x 64 (image.js coverResample).
//  The example photos of the original CNN Explainer are Tiny ImageNet
//  images. Their owners did not license them, so this page does not use
//  them (see CREDITS.md).
//
//  We picked two photos per class that the network gets right. The network
//  is wrong on many other photos: it is small and it saw only 64 x 64
//  pictures of ten classes.
//
//  grep -n 'export const EXAMPLES'   the photo list (class, source, licence)
//  grep -n 'export const SOURCE'     the paper and the repository
//  grep -n 'export function exampleRGB'  one picture out of examples.bin
// ============================================================================

export const SOURCE = {
  title: 'CNN Explainer: Learning Convolutional Neural Networks with Interactive Visualization',
  authors: 'Zijie J. Wang, Robert Turko, Omar Shaikh, Haekyu Park, Nilaksh Das, Fred Hohman, Minsuk Kahng and Duen Horng (Polo) Chau',
  venue: 'IEEE Transactions on Visualization and Computer Graphics (TVCG), presented at IEEE VIS 2020',
  doi: 'https://doi.org/10.1109/TVCG.2020.3030418',
  arxiv: 'https://arxiv.org/abs/2004.15004',
  repo: 'https://github.com/poloclub/cnn-explainer',
  live: 'https://poloclub.github.io/cnn-explainer/',
  licence: 'MIT, Copyright (c) 2020 Polo Club of Data Science',
  commit: 'd0971f9447ed9806022a3d47587b62394682bc51',
};

const C = (cls, file, author, licence) => ({
  cls, file, author, licence,
  url: 'https://commons.wikimedia.org/wiki/File:' + file.replace(/ /g, '_'),
});

export const EXAMPLES = [
  C('lifeboat', 'Lifeboat.16-01.underway.arp.jpg', 'Arpingstone', 'Public domain'),
  C('lifeboat', 'USCG 44 foot motor lifeboat CG 44301 -b.jpg', 'Adam Johnson, USCG', 'Public domain'),
  C('ladybug', 'Ladybug.jpg', 'Crux', 'Public domain'),
  C('ladybug', 'Red-ladybug-apeldoorn (Unsplash).jpg', 'Michel Bosma', 'CC0'),
  C('pizza', 'Pizza 14.jpg', 'Kurt Kaiser', 'CC0'),
  C('pizza', 'Pizza 10.jpg', 'Kurt Kaiser', 'CC0'),
  C('bell pepper', 'Bent red bell pepper 2017 - 2B.jpg', 'Fructibus', 'CC0'),
  C('bell pepper', 'Colorful Bell Peppers (Unsplash).jpg', 'Gabriel Ghnassia', 'CC0'),
  C('school bus', '2025 Blue Bird Vision- Bus 1- MOTSD.png', 'Vehicles on a Journey', 'CC0'),
  C('school bus', 'Blue Bird All-American RE - Leon District Schools, FL - 2052N.jpg', 'Winnebaggo', 'CC0'),
  C('koala', 'Koala-bear-sunlight (Unsplash).jpg', 'Les Anderson', 'CC0'),
  C('koala', 'Koala CMZ.jpg', 'Love Krittaya', 'Public domain'),
  C('espresso', 'Espresso BW 1.jpg', 'Berthold Werner', 'Public domain'),
  C('espresso', 'Espresso 01.jpg', 'Bjb-de', 'Public domain'),
  C('red panda', 'Red Panda (30763188080).jpg', 'Mathias Appel', 'CC0'),
  C('red panda', 'Red Panda (25193861686).jpg', 'Mathias Appel', 'CC0'),
  C('orange', 'Ambersweet oranges.jpg', 'USDA Agricultural Research Service (k3644-12)', 'Public domain'),
  C('orange', 'Orange fruit sliced.jpg', 'Paolo Neo', 'Public domain'),
  C('sport car', '1990 Buick Reatta roadster red - r.jpg', 'Christopher Ziemnowicz (CZmarlin)', 'CC0'),
  C('sport car', '3rd Mazda MX-5 -- 06-14-2010.jpg', 'IFCAR', 'Public domain'),
];

export const EXAMPLE_BYTES = 64 * 64 * 3;

// The RGB bytes of example i, as a view into the examples.bin bytes.
export function exampleRGB(bin, i) {
  const b = bin instanceof Uint8Array ? bin : new Uint8Array(bin);
  if (b.byteLength !== EXAMPLES.length * EXAMPLE_BYTES) throw new Error(`examples.bin: ${b.byteLength} bytes, want ${EXAMPLES.length * EXAMPLE_BYTES}`);
  return b.subarray(i * EXAMPLE_BYTES, (i + 1) * EXAMPLE_BYTES);
}
