// entry.mjs: the ES module face of the vendored bundle. It only re-exports
// the upstream CommonJS modules (transpiled from src/ts unchanged).
import vector from './cjs/vector.js';
import tensor from './cjs/impl/tensor.js';
import basis from './cjs/impl/basis_field.js';
import tensorField from './cjs/impl/tensor_field.js';
import integrator from './cjs/impl/integrator.js';
import streamlines from './cjs/impl/streamlines.js';
import water from './cjs/impl/water_generator.js';
import graph from './cjs/impl/graph.js';
import polygonFinder from './cjs/impl/polygon_finder.js';
import polygonUtil from './cjs/impl/polygon_util.js';
import gridStorage from './cjs/impl/grid_storage.js';
export const Vector = vector.default;
export const Tensor = tensor.default;
export const Grid = basis.Grid, Radial = basis.Radial, BasisField = basis.BasisField, FIELD_TYPE = basis.FIELD_TYPE;
export const TensorField = tensorField.default;
export const FieldIntegrator = integrator.default, RK4Integrator = integrator.RK4Integrator, EulerIntegrator = integrator.EulerIntegrator;
export const StreamlineGenerator = streamlines.default;
export const WaterGenerator = water.default;
export const Graph = graph.default, Node = graph.Node;
export const PolygonFinder = polygonFinder.default;
export const PolygonUtil = polygonUtil.default;
export const GridStorage = gridStorage.default;
