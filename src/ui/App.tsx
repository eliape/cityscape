import * as Comlink from 'comlink';
import type GUI from 'lil-gui';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { MapScene } from '../render/scene';
import { OVERLAYS, type Legend, type OverlayId } from '../render/overlays';
import { defaultParams, type ParamName } from '../sim/params';
import type { LineView, NetworkView, Snapshot, Stats, TerrainView } from '../sim/types';
import type { SimClient } from '../simClient';
import type { Speed } from '../worker/simWorker';
import { BottomBar } from './BottomBar';
import { BuildPanel } from './BuildPanel';
import { draftOf, endStations, snapToRail, startTool, toggleStation, toolPath, type LineToolState } from './lineTool';
import { SidePanel } from './SidePanel';
import { emptyHistory, type History } from './StatsPanel';
import { createTuningPanel, tuningEnabled } from './tuning';

const MAX_HISTORY = 12 * 200;

export function App({ client }: { client: SimClient }) {
  const mapEl = useRef<HTMLDivElement>(null);
  const scene = useRef<MapScene | null>(null);
  const gui = useRef<GUI | null>(null);
  const history = useRef<History>(emptyHistory());

  const [stats, setStats] = useState<Stats | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState<Speed>(1);
  const [overlay, setOverlayState] = useState<OverlayId>('none');
  const [flatten, setFlattenState] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [legend, setLegend] = useState<Legend | null>(null);
  const [seed, setSeed] = useState(1);
  const [tuningOpen, setTuningOpen] = useState(false);
  const [, setHistoryVersion] = useState(0);
  const [tool, setTool] = useState<LineToolState | null>(null);
  const [lines, setLines] = useState<LineView[]>([]);
  const [buildError, setBuildError] = useState<string | null>(null);
  const water = useRef<Uint8Array | null>(null);
  const hover = useRef<number | null>(null);
  const toolRef = useRef<LineToolState | null>(null);

  // Map + worker wiring.
  useEffect(() => {
    const s = new MapScene(mapEl.current!);
    scene.current = s;

    const onSnapshot = (snap: Snapshot) => {
      s.setSnapshot(snap);
      setLegend(s.legend);
    };
    const onStats = (st: Stats) => {
      const h = history.current;
      const year = st.month / 12;
      const last = h.years.length - 1;
      if (last >= 0 && st.month < h.years[last] * 12 - 1e-6) {
        // Time went backwards: a new city.
        Object.assign(h, emptyHistory(), { version: h.version + 1 });
      }
      const n = h.years.length - 1;
      if (n >= 0 && Math.abs(h.years[n] - year) < 1e-9) {
        h.population[n] = st.population;
        h.commute[n] = st.meanCommute;
        h.lnA[n] = st.meanLnA;
      } else {
        h.years.push(year);
        h.population.push(st.population);
        h.commute.push(st.meanCommute);
        h.lnA.push(st.meanLnA);
        if (h.years.length > MAX_HISTORY) for (const k of ['years', 'population', 'commute', 'lnA'] as const) h[k].shift();
      }
      h.version++;
      setHistoryVersion(h.version);
      setStats(st);
    };
    const onTerrain = (t: TerrainView) => {
      water.current = t.water.slice();
      s.setTerrain(t);
      // A new map: any line being drawn belonged to the old one.
      toolRef.current = null;
      setTool(null);
      s.setDraft(null);
    };
    const onNetwork = (n: NetworkView) => {
      s.setNetwork(n);
      setLines(n.lines);
    };
    client.connect(Comlink.proxy({ terrain: onTerrain, snapshot: onSnapshot, stats: onStats, network: onNetwork }));
    return () => {
      s.dispose();
    };
  }, [client]);

  const playingRef = useRef(false);
  const togglePlay = useCallback(() => {
    const next = !playingRef.current;
    playingRef.current = next;
    if (next) client.play();
    else client.pause();
    setPlaying(next);
  }, [client]);

  const setSpeed = useCallback(
    (s: Speed) => {
      setSpeedState(s);
      client.setSpeed(s);
    },
    [client],
  );

  const setOverlay = useCallback((id: OverlayId) => {
    setOverlayState(id);
    scene.current?.setOverlay(id);
    setLegend(scene.current?.legend ?? null);
  }, []);

  const setFlatten = useCallback((on: boolean) => {
    setFlattenState(on);
    scene.current?.setFlatten(on);
  }, []);

  // ── Metro line tool ──
  const updateTool = useCallback((next: LineToolState | null) => {
    toolRef.current = next;
    setTool(next);
    scene.current?.setDraft(next ? draftOf(next, hover.current) : null);
    if (mapEl.current) mapEl.current.style.cursor = next ? 'crosshair' : '';
  }, []);

  const startMetro = useCallback(() => {
    setBuildError(null);
    updateTool(startTool());
  }, [updateTool]);

  const cancelTool = useCallback(() => {
    setBuildError(null);
    updateTool(null);
  }, [updateTool]);

  const toStations = useCallback(() => {
    const t = toolRef.current;
    if (!t || t.phase !== 'rail' || t.points.length < 2) return;
    updateTool({ ...t, phase: 'stations', stations: endStations(toolPath(t), water.current) });
  }, [updateTool]);

  const backToRail = useCallback(() => {
    const t = toolRef.current;
    if (t) updateTool({ ...t, phase: 'rail', stations: [] });
  }, [updateTool]);

  const buildLine = useCallback(async () => {
    const t = toolRef.current;
    if (!t || t.phase !== 'stations') return;
    if (t.stations.length < 2) {
      setBuildError('Place at least two stations');
      return;
    }
    const res = await client.addLine({ path: toolPath(t), stations: t.stations });
    if ('error' in res) setBuildError(res.error);
    else {
      setBuildError(null);
      updateTool(null);
    }
  }, [client, updateTool]);

  const removeLine = useCallback((id: number) => client.removeLine(id), [client]);

  const undo = useCallback(() => {
    const t = toolRef.current;
    if (!t) return;
    if (t.phase === 'rail') updateTool({ ...t, points: t.points.slice(0, -1) });
    else if (t.stations.length > 0) updateTool({ ...t, stations: t.stations.slice(0, -1) });
  }, [updateTool]);

  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    s.pointer = {
      hover(cell) {
        hover.current = cell;
        const t = toolRef.current;
        if (t) s.setDraft(draftOf(t, cell));
      },
      click(cell) {
        const t = toolRef.current;
        if (!t) return;
        setBuildError(null);
        if (t.phase === 'rail') {
          if (t.points[t.points.length - 1] !== cell) updateTool({ ...t, points: [...t.points, cell] });
          return;
        }
        const path = toolPath(t);
        const k = snapToRail(path, cell);
        if (k < 0) return;
        if (!t.stations.includes(k) && water.current?.[path[k]]) {
          setBuildError('A station needs land for its entrance; the rail itself can run under water');
          return;
        }
        updateTool({ ...t, stations: toggleStation(t.stations, k) });
      },
      dblclick() {
        if (toolRef.current?.phase === 'rail') toStations();
      },
    };
    return () => {
      s.pointer = null;
    };
  }, [updateTool, toStations]);

  const reset = useCallback(() => {
    client.reset(seed);
  }, [client, seed]);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') {
        if (toolRef.current) cancelTool();
        return;
      }
      if (e.key === 'Enter' && toolRef.current && t?.tagName !== 'BUTTON') {
        if (toolRef.current.phase === 'rail') toStations();
        else buildLine();
        return;
      }
      if (e.key === 'Backspace' && toolRef.current) {
        e.preventDefault();
        undo();
        return;
      }
      if (e.key === 'm' || e.key === 'M') {
        if (toolRef.current) cancelTool();
        else startMetro();
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === '1') setSpeed(1);
      else if (e.key === '2') setSpeed(4);
      else if (e.key === '3') setSpeed(16);
      else if (e.key === 'o' || e.key === 'O') {
        const i = OVERLAYS.findIndex((o) => o.id === overlay);
        setOverlay(OVERLAYS[(i + 1) % OVERLAYS.length].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, setSpeed, setOverlay, overlay, cancelTool, toStations, buildLine, undo, startMetro]);

  // Parameter tuning panel (lil-gui), created on first open.
  useEffect(() => {
    if (!tuningOpen) {
      gui.current?.hide();
      return;
    }
    if (gui.current) {
      gui.current.show();
      return;
    }
    let cancelled = false;
    client.getParams().then((params) => {
      if (cancelled) return;
      gui.current = createTuningPanel(
        params,
        (name: ParamName, value: number) => client.setParam(name, value),
        () => client.reset(seed, defaultParams),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [tuningOpen, client, seed]);

  return (
    <div class={`layout ${collapsed ? 'is-collapsed' : ''}`}>
      <SidePanel
        collapsed={collapsed}
        onCollapse={setCollapsed}
        overlay={overlay}
        onOverlay={setOverlay}
        legend={legend}
        flatten={flatten}
        onFlatten={setFlatten}
        seed={seed}
        onSeed={setSeed}
        onReset={reset}
        history={history.current}
        tuning={tuningEnabled()}
        tuningOpen={tuningOpen}
        onTuning={setTuningOpen}
        build={
          <BuildPanel
            tool={tool}
            lines={lines}
            error={buildError}
            onStart={startMetro}
            onCancel={cancelTool}
            onNext={toStations}
            onBack={backToRail}
            onBuild={buildLine}
            onRemove={removeLine}
          />
        }
      />
      <main class="map" ref={mapEl} />
      <BottomBar stats={stats} playing={playing} speed={speed} onTogglePlay={togglePlay} onSpeed={setSpeed} />
    </div>
  );
}
