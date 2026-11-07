import * as Comlink from 'comlink';
import type { SimWorkerApi } from './worker/simWorker';

export type SimClient = Comlink.Remote<SimWorkerApi>;

export function createSimClient(): SimClient {
  const worker = new Worker(new URL('./worker/simWorker.ts', import.meta.url), { type: 'module' });
  return Comlink.wrap<SimWorkerApi>(worker);
}
