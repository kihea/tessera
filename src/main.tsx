import { createRoot } from 'react-dom/client';
import { App } from './App';
import './ui/styles.css';

// No StrictMode: the loom is an online planner with internal state advanced
// per emitted card; StrictMode's double-invocation in dev would advance it
// twice per card and skew exposure counts.
createRoot(document.getElementById('root')!).render(<App />);
