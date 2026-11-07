import GUI from 'lil-gui';
import { defaultParams, paramMeta, type ParamName, type Params } from '../sim/params';

/**
 * lil-gui sliders for every model parameter, grouped as in params.ts.
 * Shown in dev builds, or in any build with ?tune in the URL.
 */
export function tuningEnabled(): boolean {
  return import.meta.env.DEV || new URLSearchParams(location.search).has('tune');
}

export function createTuningPanel(initial: Params, onChange: (name: ParamName, value: number) => void, onReset: () => void): GUI {
  const gui = new GUI({ title: 'Model parameters', width: 320 });
  gui.domElement.classList.add('tuning');
  const values: Params = { ...initial };
  const folders = new Map<string, GUI>();
  for (const name of Object.keys(paramMeta) as ParamName[]) {
    const meta = paramMeta[name];
    let folder = folders.get(meta.group);
    if (!folder) {
      folder = gui.addFolder(meta.group);
      folder.close();
      folders.set(meta.group, folder);
    }
    folder
      .add(values, name, meta.min, meta.max, meta.step)
      .name(meta.label)
      .onChange((v: number) => onChange(name, v));
  }
  gui.add(
    {
      defaults: () => {
        Object.assign(values, defaultParams);
        gui.controllersRecursive().forEach((c) => c.updateDisplay());
        onReset();
      },
    },
    'defaults',
  ).name('Restore defaults and restart');
  return gui;
}
