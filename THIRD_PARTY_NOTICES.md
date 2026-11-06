# Third-party notices

The development executable embeds Bun 1.4.4 and the browser bundle includes Three.js 0.187.0. No font files are distributed. The UI uses fonts installed on the operating system.

## Bun and linked libraries

`licenses/Bun-LICENSE.md` is the upstream notice from the `bun-v1.4.4` tag:
https://github.com/oven-sh/bun/blob/bun-v1.4.4/LICENSE.md

Bun includes statically linked components under additional licenses. The upstream notice identifies these components and provides instructions for rebuilding/relinking JavaScriptCore/WebKit. Preserve that notice. This application's source and pinned dependency lockfile are included under `source/` in the development ZIP; the source commit is recorded in `START-HERE.txt`.

To rebuild this application, install the pinned Bun version, run `bun install --frozen-lockfile`, and run `bun run build:exe -- --windows`. Rebuilding or substituting the runtime follows the upstream Bun instructions. A public production release remains gated on authentication-use review, a complete distribution/license review, signing and the acceptance tests documented in this repository. These notices are not a claim that those release gates have been completed.

## Three.js

Three.js is MIT licensed. The development ZIP includes the installed package's `LICENSE` as `licenses/Three-LICENSE.txt`. Source: https://github.com/mrdoob/three .

## Development dependencies

TypeScript, Playwright, type declarations and fflate are development/build dependencies. They are not required on an end user's machine. Their exact versions are recorded in `package.json` and `bun.lock`.
