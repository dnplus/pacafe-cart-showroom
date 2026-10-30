const RESET_GAP_MS = 250;
const EPSILON_MS = .000001;

export function frameCadence(fps = 30) {
  const period = 1000 / fps;
  let nextDue = 0;
  let lastCallback: number | null = null;
  return {
    advance(time: number): 'skip' | 'frame' | 'resume' {
      if (lastCallback === null || time < lastCallback || time - lastCallback >= RESET_GAP_MS) {
        lastCallback = time;
        nextDue = time + period;
        return 'resume';
      }
      if (time === lastCallback) return 'skip';
      lastCallback = time;
      if (time + EPSILON_MS < nextDue) return 'skip';
      nextDue += (Math.floor((time + EPSILON_MS - nextDue) / period) + 1) * period;
      return 'frame';
    },
    reset() { lastCallback = null; },
  };
}
