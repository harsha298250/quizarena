import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { initClockSync } from './lib/clockSync';
import '@fontsource/bricolage-grotesque/600.css';
import '@fontsource/bricolage-grotesque/700.css';
import '@fontsource/bricolage-grotesque/800.css';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/700.css';
import '@fontsource/space-mono/400.css';
import '@fontsource/space-mono/700.css';
import './index.css';

// Initialize background authoritative clock synchronization
initClockSync();

createRoot(document.getElementById('root')!).render(<App />);
