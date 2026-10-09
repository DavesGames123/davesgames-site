# Neuron Lab and Neural Network: credits and licences

## NEURON

The two pages do not run NEURON. They run our own small JavaScript engine
(engine/) that follows NEURON's method and mechanisms:

- NEURON, https://github.com/neuronsimulator/nrn and https://www.neuronsimulator.org
- Licence: BSD-3-Clause ("Copyright (c) 2018, Michael Hines. All rights
  reserved.", file `Copyright` in the repository root, read 2026-10-08 at
  master 82241e0fa9729b317583805a902067019f597dbd).
- engine/hh.js copies the rate equations and PARAMETER defaults of
  `src/nrnoc/hh.mod` (last changed in commit 8202fe7e9db706d39780d0abb3531c929a325cb7).
- engine/cell.js follows `src/nrnoc/expsyn.mod`, `exp2syn.mod`, `netstim.mod`
  and `stim.mod` (IClamp) for the point processes, and the NEURON defaults
  dt = 0.025 ms, celsius = 6.3 degC, v_init = -65 mV, Ra = 35.4 ohm cm,
  cm = 1 uF/cm2, NetCon threshold 10 mV and delay 1 ms.
- No NEURON source file is shipped. The BSD notice above is kept here
  because the equations and defaults come from those files.

References:
- Hines M (1984). Efficient computation of branched nerve equations.
  Int J Biomed Comput 15, 69-76. https://doi.org/10.1016/0020-7101(84)90008-4
- Hines ML, Carnevale NT (1997). The NEURON simulation environment.
  Neural Comput 9, 1179-1209. https://doi.org/10.1162/neco.1997.9.6.1179
- Carnevale NT, Hines ML (2006). The NEURON Book. Cambridge University
  Press. (the d_lambda rule for nseg)
- Hodgkin AL, Huxley AF (1952). A quantitative description of membrane
  current and its application to conduction and excitation in nerve.
  J Physiol 117, 500-544. https://doi.org/10.1113/jphysiol.1952.sp004764
- Borgers C, Kopell N (2003). Synchronization in networks of excitatory
  and inhibitory neurons with sparse, random connectivity. Neural Comput
  15, 509-538. (PING)

## Browser build of NEURON

No official WebAssembly or Pyodide build of NEURON was found (2026-10-08).
The pages link to NEURON and do not embed it.

## Morphologies

All four cells (pyramidal, Purkinje, motor neuron, granule) are procedural:
engine/morph.js grows them from a seed after the plan of each cell type.
They are not reconstructions. No NeuroMorpho.org or ModelDB file is used,
so no per-cell licence applies. The pages label them "procedural".

## Ih (HCN) channel

engine/cell.js has an optional Ih current. Its rate equations and ehcn
= -45 mV are those of Ih.mod from Hay E, Hill S, Schurmann F, Markram H,
Segev I (2011). Models of neocortical layer 5b pyramidal cells capturing a
wide range of dendritic and perisomatic active properties. PLoS Comput Biol
7, e1002107. https://doi.org/10.1371/journal.pcbi.1002107 (ModelDB 139653),
after Kole MHP, Hallermann S, Stuart GJ (2006), J Neurosci 26, 1677-1687.
Only the equations are used; no ModelDB file is shipped.

## Randomize

The random ranges (engine/random.js) are our own choices inside the usual
bounds of HH-type models.
