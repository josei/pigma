# Third-party notices for `tests/figma/fixtures/`

The binary `.fig` fixtures in this directory are redistributed from
[openfig-core](https://github.com/OpenFig-org/openfig-core) (MIT). They are used
unmodified as real-world inputs for the native parser.

- `circle.fig`
- `openfigs.fig`
- `word-outline-stroke.fig`

`with-image.fig` is derived from `circle.fig` by this project: the archive was
re-packed with the original `thumbnail.png` also stored under `images/<sha1>` so
the embedded-image import path has a real fixture. `rest-file.json` and
`rest-nodes.json` were authored by this project.

The Kiwi binary codec in `src/figma/native/kiwi.ts` is an independent
reimplementation of the read side of
[kiwi-schema](https://github.com/evanw/kiwi) (MIT). The native format notes and
blob layouts in `src/figma/native/vector.ts` follow openfig-core's
documentation (MIT).

---

## MIT License — kiwi (kiwi-schema)

```
Copyright (c) 2016-2023 Evan Wallace

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## MIT License — openfig-core

Upstream declares `"license": "MIT"` with `"author": "rcoenen"` in its
`package.json` and states "License: MIT" in its README. The upstream repository
does not ship a standalone `LICENSE` file, so the standard MIT text is
reproduced below with that attribution.

```
Copyright (c) OpenFig contributors (openfig-core, author rcoenen)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Figma is a trademark of Figma, Inc. Pigma is not affiliated with, endorsed by,
or sponsored by Figma, Inc.
