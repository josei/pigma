import { useEffect } from 'react';
import { useEditor } from '../store/editorStore';
import { advanceTime } from '../model/keyframes';

/**
 * Playback: while the editor is playing, the key time moves on each frame and wraps at the end of the timeline. It runs at app level,
 * so it keeps going when the Animation section is closed. The preview follows the key time, and nothing is stored.
 */
export function usePlayback(): void {
  const playing = useEditor((state) => state.playing);
  useEffect(() => {
    if (!playing) return undefined;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const state = useEditor.getState();
      state.setKeyframeTime(advanceTime(state.keyframeTime, now - last));
      last = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);
}
