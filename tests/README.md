# Tests

Three suites, all real:

| Suite | Command | What it drives |
| --- | --- | --- |
| Unit / integration | `npm test` (`vitest run`) | `src/**/*.test.ts(x)` and `tests/**/*.test.ts`, in-process and over real sockets, HTTP and spawned CLIs |
| Browser | `npm run test:browser` (`playwright test`) | the real app in Chromium — see [`browser/README.md`](browser/README.md) |
| Flake capture | `RUNS=5 scripts/flake-hunt.sh <label>` | the unit suite in a loop, keeping the FULL output of any run that fails |

## A `Pre-transform error` means the tree moved, not that the code is broken

```
[vite] Pre-transform error: Transform failed with 1 error:
/home/jose/Code/pigma/src/model/types.ts:1:22: ERROR: Unexpected end of file
```

This is **not a test failure**. It means a source file was written **while vite was
transforming it** — in this repository, another agent editing the tree during a
run. The file fails to collect, once per importer, and the failure count scales
with how long the file was mid-write and how many files import it:

| Write window | Result (measured 2026-10-05) |
| --- | --- |
| 1.5 s | 42–46 transform errors → `1 failed \| 1068 passed` |
| 8 s | 117 transform errors → `2 failed \| 1064 passed` |
| file left broken | 96 files uncollected, 247 transform errors |

The two intermittent shapes this project has seen — a single test failing on a
pass's first run, and a collection failure with dozens of files uncollected in the
transform phase — are **one cause at two magnitudes**.

What to do about it:

- **Re-run.** The file's content at that instant failed, not the code. A clean
  re-run with no other writers is the correct response.
- **`--retry` does not help.** Vitest's `retry` applies to tests, never to
  collection: a permanently broken file with `--retry=3` still exits 1 with 96
  files uncollected and **zero** retry markers in the output.
- **`scripts/flake-hunt.sh` does it for you.** It hashes the working tree before
  and after each run; a failure with a transform error *and* a changed tree hash is
  reported as `TREE MOVED` — a concurrent writer, not a broken test — and re-run
  once. Failures that are not explained that way are copied to
  `failures/<label>-<n>.log` in full, which is the thing that makes the next
  sighting nameable instead of a summary line.
- **Ruled out** by runs, so it is not re-litigated: load (a browser suite running
  concurrently), worker count, `--sequence.shuffle`, two vitest instances sharing
  the transform cache, available memory (never below 1.2 GB) and file descriptors
  (max 24).
