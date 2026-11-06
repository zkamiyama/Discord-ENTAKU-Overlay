# Third-party notices

This application bundles JavaScript, WebAssembly decoders, and the Bun runtime. The Windows ZIP contains the tracked application source and license notices. User-supplied avatars and studio models are not included in the repository or distribution; their licenses remain the user's responsibility.

| Component | Use | Notice |
|---|---|---|
| Three.js 0.187.0 | Rendering, GLTFLoader, LoadingManager, controls and math | MIT; `licenses/three-LICENSE.txt` in the distribution |
| Draco | Unmodified glTF decoder shipped with Three.js | Apache-2.0; `licenses/Apache-2.0.txt`, `licenses/Draco-README.md`; Copyright the Draco Authors |
| Basis Universal | Unmodified KTX2 transcoder shipped with Three.js | Apache-2.0; `licenses/Apache-2.0.txt`, `licenses/Basis-README.md`; Copyright 2019-2026 Binomial LLC |
| meshoptimizer | Official decoder included in Three.js addons | MIT; Copyright 2016-2026 Arseny Kapoulkine; `licenses/meshoptimizer-LICENSE.md` |
| fflate 0.8.3 | Bounded ZIP import and release packaging | MIT; Copyright 2023 Arjun Barrett; `licenses/fflate-LICENSE.txt` |
| Bun 1.4.4 and bundled components | Compiled application runtime | `licenses/Bun-LICENSE.md` preserves upstream's license and component/source list |

Draco source: https://github.com/google/draco

Basis Universal source: https://github.com/BinomialLLC/basis_universal

Meshoptimizer source: https://github.com/zeux/meshoptimizer

Bun source and bundled-library notices: https://github.com/oven-sh/bun/tree/bun-v1.4.4

The application source is provided under this repository's LICENSE. Upstream runtime and bundled components retain their own terms. JavaScriptCore/WebKit source and license references are listed in Bun's notices. A compiled executable does not replace those notices or upstream source obligations.

TypeScript, Playwright, and type packages are development tools and are not included as application runtime dependencies. No font files are distributed.

Discord and OBS are separate applications and are not included. StreamKit compatibility authentication is an explicitly enabled interoperability path, not an independently approved application credential. It does not itself establish permission to distribute that authentication method. User tokens are not extracted and self-bots are not used.
