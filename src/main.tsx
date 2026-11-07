import { render } from 'preact';
import 'uplot/dist/uPlot.min.css';
import './ui/styles.css';
import { App } from './ui/App';
import { createSimClient } from './simClient';

render(<App client={createSimClient()} />, document.getElementById('app')!);
