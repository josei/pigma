let counter = 0;
let session = Math.floor(Math.random() * 0xffff)
  .toString(16)
  .padStart(4, '0');

/**
 * Figma-style node ids: `<session>:<counter>`. Kept human-readable so imported
 * documents and locally created nodes look identical in serialized JSON.
 */
export function nextNodeId(): string {
  counter += 1;
  return `${session}:${counter}`;
}

/** Ensure ids generated from here on never collide with `existing`. */
export function bumpSession(existing: Iterable<string>): void {
  let max = 0;
  for (const id of existing) {
    const m = /^([0-9a-f]+):(\d+)$/.exec(id);
    if (!m) continue;
    max = Math.max(max, Number(m[2]));
  }
  counter = Math.max(counter, max);
  session = Math.floor(Math.random() * 0xffff)
    .toString(16)
    .padStart(4, '0');
}
