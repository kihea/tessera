import { useEffect, useState } from 'react';
import { OnboardingScreen } from './ui/OnboardingScreen';
import { QueryScreen } from './ui/QueryScreen';
import { SessionScreen } from './ui/SessionScreen';
import { SettingsScreen } from './ui/SettingsScreen';
import { applyTheme, loadPrefs, loadSettings } from './state/storage';

function topicFromHash(): string | null {
  const m = window.location.hash.match(/^#t=(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function App() {
  const [topic, setTopic] = useState<string | null>(() => topicFromHash());
  // First visit (or an explicit retune) runs the startup flow before anything
  // else -- the answers warm-start the bandit and configure the loom.
  const [onboarding, setOnboarding] = useState<boolean>(() => loadPrefs() === null);
  const [settings, setSettings] = useState(false);

  useEffect(() => {
    const onHash = () => setTopic(topicFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Apply the saved theme as early as the app mounts.
  useEffect(() => {
    applyTheme(loadSettings().theme);
  }, []);

  const open = (query: string) => {
    window.location.hash = `t=${encodeURIComponent(query)}`;
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

  return topic ? (
    <SessionScreen key={topic} query={topic} onBack={back} />
  ) : (
    <QueryScreen onSubmit={open} onSettings={() => setSettings(true)} />
  );
}
