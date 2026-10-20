// What HAL says in the page's readout.

export type Status = {
  // Whether the page hears from its server.
  connected: boolean;
  // Whether the watcher has written anything.
  running: boolean;
  // Whether the watcher has stopped writing.
  stale: boolean;
  // How many items surely wait on the user.
  waiting: number;
  // The hour of the day, 0 to 23.
  hour: number;
};

/** Returns the greeting for hour, 0 to 23. */
export function greeting(hour: number): string {
  if (hour < 5) return "Working late";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** Returns what HAL says about status. */
export function halMessage(s: Status): string {
  if (!s.connected) return "I seem to have lost contact with the ship's computer. Retrying.";
  if (!s.running) return "The watcher isn't running. I suggest starting herdr-project --watch.";
  if (s.stale) return "The watcher has stopped reporting. You may want to restart it.";
  if (!s.waiting) return `${greeting(s.hour)}. All systems functional. Nothing requires your attention.`;
  const what = s.waiting === 1 ? "One matter requires" : `${s.waiting} matters require`;
  return `${greeting(s.hour)}. ${what} your attention.`;
}
