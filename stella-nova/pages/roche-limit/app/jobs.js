// ============================================================================
//  ROCHE LIMIT  ·  app/jobs.js — calls to worker.js
// ----------------------------------------------------------------------------
//  workerCall posts one job to the worker and resolves with its reply.
//  boot() in main.js routes each reply to its job through workerJobs.
//
//  grep -n targets
//    post a job ...... "function workerCall"
//    pending jobs .... "const workerJobs"
// ============================================================================
import { S } from './state.js';

export const workerJobs = new Map();let jobId = 0;
export function workerCall(msg, transfer = []) {
  return new Promise(res => { const id = ++jobId; workerJobs.set(id, res); S.worker.postMessage(Object.assign({ id }, msg), transfer); });
}
