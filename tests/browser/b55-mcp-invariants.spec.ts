import { test, expect, connectEditor, mcpCall } from './relay';

/**
 * The live-editor bridge enforces the same document invariants as the in-memory
 * session.
 *
 * The editor session used to call the store's `apply` directly and never ran
 * `documentProblems`, so a hostile script committed opacity 42, a negative width
 * or a malformed colour through the live editor — the path a real harness takes —
 * while the in-memory session refused every one. Both now share one settle +
 * validate, and the refusal happens BEFORE the store sees anything, so a refused
 * write leaves the document and the undo history untouched.
 */

/** Run a plugin script through the live bridge; returns the raw tool response. */
async function script(relay: Parameters<typeof mcpCall>[0], code: string) {
  return (await mcpCall(relay, 'tools/call', { name: 'use_pigma', arguments: { code } })) as {
    result?: { isError?: boolean; content?: Array<{ text?: string }> };
  };
}

const text = (response: Awaited<ReturnType<typeof script>>): string =>
  response.result?.content?.[0]?.text ?? JSON.stringify(response);

test('B55a the live bridge refuses a hostile script and leaves the editor alone', async ({ page, relay }) => {
  await page.goto('/?blank=1');
  await page.waitForSelector('.app');
  await connectEditor(page, relay);

  const history = () => page.evaluate(() => window.__pigmaStore!.getState().past.length);
  const nodes = () =>
    page.evaluate(() => window.__pigmaStore!.getState().file.document.children[0]!.children.length);

  // A real node to attack, created through the same bridge and read back from
  // the editor's own document, so the id is certainly one it knows.
  const created = await script(
    relay,
    "figma.createRectangle({ x: 0, y: 0, width: 40, height: 40, name: 'Hostile target' }).id;",
  );
  expect(created.result?.isError ?? false, text(created)).toBe(false);
  const nodeId = await page.evaluate(
    () => window.__pigmaStore!.getState().file.document.children[0]!.children[0]!.id,
  );
  expect(nodeId).not.toBe('');

  const hostile: Array<[string, string, RegExp]> = [
    ['opacity', `figma.getNodeById(${JSON.stringify(nodeId)}).opacity = 42;`, /opacity must be between 0 and 1/],
    ['negative width', `figma.getNodeById(${JSON.stringify(nodeId)}).resize(-10, 10);`, /width must not be negative/],
    [
      'malformed colour',
      `figma.getNodeById(${JSON.stringify(nodeId)}).fills = [{ type: 'SOLID', color: { r: 2, g: 0, b: 0 } }];`,
      /colour\.r must be between 0 and 1/,
    ],
  ];

  for (const [label, code, expected] of hostile) {
    const historyBefore = await history();
    const nodesBefore = await nodes();
    const response = await script(relay, code);
    const message = text(response);
    expect(message, `${label}: the live bridge accepted an invalid write`).toMatch(/invalid/);
    expect(message, `${label}: the message should name the field`).toMatch(expected);
    expect(message, `${label}: the message should name the node`).toContain(nodeId);
    expect(await history(), `${label}: the undo history changed`).toBe(historyBefore);
    expect(await nodes(), `${label}: the document changed`).toBe(nodesBefore);
  }

  // The editor is still usable: a legitimate write lands on the same bridge.
  const good = await script(relay, `figma.getNodeById(${JSON.stringify(nodeId)}).opacity = 0.5;`);
  expect(good.result?.isError ?? false, text(good)).toBe(false);
  const opacity = await page.evaluate(
    (id) => (window.__pigmaStore!.getState().file.document.children[0]!.children.find((c) => c.id === id) as { opacity: number }).opacity,
    nodeId,
  );
  expect(opacity).toBe(0.5);
  expect(await history()).toBeGreaterThan(0);
});
