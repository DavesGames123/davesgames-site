# CNN Explainer page: credits and licences

## The project this page shows

CNN Explainer, by Zijie J. Wang, Robert Turko, Omar Shaikh, Haekyu Park,
Nilaksh Das, Fred Hohman, Minsuk Kahng and Duen Horng (Polo) Chau
(Georgia Tech and Oregon State University).

- Paper: "CNN Explainer: Learning Convolutional Neural Networks with
  Interactive Visualization", IEEE Transactions on Visualization and
  Computer Graphics (TVCG), presented at IEEE VIS 2020.
  https://doi.org/10.1109/TVCG.2020.3030418 and https://arxiv.org/abs/2004.15004
- Repository: https://github.com/poloclub/cnn-explainer (read 2026-10-18 at
  commit d0971f9447ed9806022a3d47587b62394682bc51)
- Live demo: https://poloclub.github.io/cnn-explainer/

This page is not a copy of their Svelte interface. The layout, the code,
the drawings and the text are our own. We use the idea of the tool, the
Tiny VGG network design and the trained weights.

## What we took from the repository

| File here | From the repository | Licence | Change |
|---|---|---|---|
| model/weights.bin | public/assets/data/group1-shard1of1.bin | MIT (below) | none, byte for byte (sha256 306666f2a1cc2a0a8f7b3422617daac5ecdca20c707ab44b721522be1fe3f630) |
| net.js ARCH, CLASSES | public/assets/data/model.json (layer list), src/config.js (class names) | MIT | written again as our own JavaScript |

net.js is our own forward pass in plain JavaScript. It does not use
TensorFlow.js. A node check in the scratchpad ran the original model.json
with TensorFlow.js 4.22.0 and our forward pass on the 21 example images of
the repository: the top-1 class was the same on all 21, and the largest
difference of a probability was 1.1e-6.

### MIT licence of CNN Explainer

```
MIT License

Copyright (c) 2020 Polo Club of Data Science

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## What we did not take, and why

- **The example photos** (public/assets/img/*.jpeg, 64 x 64). The
  repository README says that the network was trained on ten classes of
  Tiny ImageNet, and the example photos are 64 x 64 pictures of the same
  kind. ImageNet does not own its photos, and its terms allow
  non-commercial research and teaching use only. The MIT notice of the
  repository cannot license photos that its authors do not own. So the page
  uses its own examples (next section).
- **The training data** (tiny-vgg/data.zip, Tiny ImageNet). Not used.
- **The fonts** (public/assets/font: "A Love of Thunder", "Coffee and
  Tea") and the icons and figures (public/assets/img/*.svg, *.png,
  public/assets/figures). Not used. The page uses the site fonts (STIX Two
  Text and Inter, vendor/fonts) and its own drawings.
- **TensorFlow.js, D3, Bulma, Font Awesome and the Svelte code.** Not used.

The trained weights come from a model that learned from Tiny ImageNet. The
repository ships them under its MIT licence, and we keep that notice.

## Example photos

All twenty are from Wikimedia Commons, in the public domain or CC0. Each
one is cropped to its centre square and box-filtered to 64 x 64 RGB
(image.js coverResample). The bytes are in examples/examples.bin, in the
order of data.js EXAMPLES. We chose two photos per class that the network
gets right. Credit is not required for these licences. We give it anyway.

| Class | File on Wikimedia Commons | Author | Licence |
|---|---|---|---|
| lifeboat | Lifeboat.16-01.underway.arp.jpg | Arpingstone | Public domain |
| lifeboat | USCG 44 foot motor lifeboat CG 44301 -b.jpg | Adam Johnson, USCG | Public domain |
| ladybug | Ladybug.jpg | Crux | Public domain |
| ladybug | Red-ladybug-apeldoorn (Unsplash).jpg | Michel Bosma | CC0 |
| pizza | Pizza 14.jpg | Kurt Kaiser | CC0 |
| pizza | Pizza 10.jpg | Kurt Kaiser | CC0 |
| bell pepper | Bent red bell pepper 2017 - 2B.jpg | Fructibus | CC0 |
| bell pepper | Colorful Bell Peppers (Unsplash).jpg | Gabriel Ghnassia | CC0 |
| school bus | 2025 Blue Bird Vision- Bus 1- MOTSD.png | Vehicles on a Journey | CC0 |
| school bus | Blue Bird All-American RE - Leon District Schools, FL - 2052N.jpg | Winnebaggo | CC0 |
| koala | Koala-bear-sunlight (Unsplash).jpg | Les Anderson | CC0 |
| koala | Koala CMZ.jpg | Love Krittaya | Public domain |
| espresso | Espresso BW 1.jpg | Berthold Werner | Public domain |
| espresso | Espresso 01.jpg | Bjb-de | Public domain |
| red panda | Red Panda (30763188080).jpg | Mathias Appel | CC0 |
| red panda | Red Panda (25193861686).jpg | Mathias Appel | CC0 |
| orange | Ambersweet oranges.jpg | USDA Agricultural Research Service (k3644-12) | Public domain |
| orange | Orange fruit sliced.jpg | Paolo Neo | Public domain |
| sport car | 1990 Buick Reatta roadster red - r.jpg | Christopher Ziemnowicz (CZmarlin) | CC0 |
| sport car | 3rd Mazda MX-5 -- 06-14-2010.jpg | IFCAR | Public domain |

The page links each file at https://commons.wikimedia.org/wiki/File:<name>.

## Photos of the user

An uploaded photo or a camera snapshot stays in the browser. The page
does not send it anywhere.
