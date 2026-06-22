import { useEffect, useState } from 'react';
import { OnboardingScreen } from './ui/OnboardingScreen';
import { QueryScreen } from './ui/QueryScreen';
import { SessionScreen } from './ui/SessionScreen';
import { SettingsScreen } from './ui/SettingsScreen';
import { GraphScreen } from './ui/GraphScreen';
import { applyTheme, loadPrefs, loadSettings } from './state/storage';

type Route =
  | { kind: 'home' }
  | { kind: 'session'; query: string }
  | { kind: 'graph'; topic: string | null };

function routeFromHash(): Route {
  const h = window.location.hash;
  const t = h.match(/^#t=(.+)$/);
  if (t) return { kind: 'session', query: decodeURIComponent(t[1]) };
  const kg = h.match(/^#kg(?:=(.*))?$/);
  if (kg) return { kind: 'graph', topic: kg[1] ? decodeURIComponent(kg[1]) : null };
  return { kind: 'home' };
}

export function App() {
  const [route, setRoute] = useState<Route>(() => routeFromHash());
  // First visit (or an explicit retune) runs the startup flow before anything
  // else -- the answers warm-start the bandit and configure the loom.
  const [onboarding, setOnboarding] = useState<boolean>(() => loadPrefs() === null);
  const [settings, setSettings] = useState(false);

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Apply the saved theme as early as the app mounts.
  useEffect(() => {
    applyTheme(loadSettings().theme);
  }, []);

  const openTopic = (query: string) => {
    window.location.hash = `t=${encodeURIComponent(query)}`;
  };
  const openGraph = (topic?: string) => {
    window.location.hash = topic ? `kg=${encodeURIComponent(topic)}` : 'kg';
  };
  const back = () => {
    window.location.hash = '';
  };

  if (onboarding) return <OnboardingScreen onDone={() => setOnboarding(false)} />;
  if (settings)
    return (
      <SettingsScreen
        onDone={() => setSettings(false)}
        onRetune={() => {
          setSettings(false);
          setOnboarding(true);
        }}
      />
    );

  if (route.kind === 'session')
    return <SessionScreen key={route.query} query={route.query} onBack={back} />;
  if (route.kind === 'graph')
    return (
      <GraphScreen
        topic={route.topic}
        onBack={back}
        onSearch={(t) => openGraph(t)}
        onOpenTopic={openTopic}
      />
    );
  return (
    <QueryScreen
      onSubmit={openTopic}
      onSettings={() => setSettings(true)}
      onOpenGraph={() => openGraph()}
    />
  );
}
