/** The categories down the side of Settings and which are available in a social lobby. */
export type SettingsPane = 'you' | 'sound' | 'notify' | 'building' | 'workers';

export const PANES: { id: SettingsPane; icon: string; label: string; blurb: string }[] = [
  { id: 'you', icon: '🧍', label: 'You', blurb: 'How you look, how you see the office, and how you’re signed in.' },
  { id: 'sound', icon: '🔊', label: 'Sound & voice', blurb: 'How loud the office is for you, and how voice chat works.' },
  { id: 'notify', icon: '🔔', label: 'Notifications', blurb: 'Hear about a worker that needs someone, or finished, while you’re somewhere else.' },
  { id: 'building', icon: '🏢', label: 'Building', blurb: 'The map, the decorations, the sky, the dog, and where new floors are cloned.' },
  { id: 'workers', icon: '🤖', label: 'Workers', blurb: 'What workers start on, how many run at once, when they go home and what the office tells them.' },
];

export function visibleSettingsPanes(allowProjectTools: boolean) {
  return allowProjectTools ? PANES : PANES.filter(({ id }) => id === 'you' || id === 'sound');
}
