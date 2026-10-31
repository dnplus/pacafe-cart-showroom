# Third-party assets and software

pacafe-cart-showroom is licensed under Apache-2.0 (see `LICENSE` and `NOTICE`). This file lists everything in the repository or the built app that comes from someone else, and the code ported from the owner's earlier projects.

## Assets

| Asset | Where it is used | Source | Author | License |
|---|---|---|---|---|
| `character.glb` and `Textures/colormap.png` from Starter Kit 3D Platformer, unchanged, in `assets/third-party/kenney-platformer-kit/` | Rendered by `scripts/render-character.mjs` to `public/art/characters/clerk-standee.png` and `clerk-portrait.png`, the clerk behind the counter, and its green variant `clerk-mint-*.png` | https://github.com/KenneyNL/Starter-Kit-3D-Platformer at commit `3fa8a04b1c01ab23db43123d4ce814a34c3fc7f0` | Kenney (https://kenney.nl) | CC0 1.0. The kit's README: "Assets included in this package (2D sprites, 3D models and sound effects) are CC0 licensed". The kit's code is MIT and is not used here. |
| 7 個家具 GLB，不改動，在 `public/furniture/`：`terra-counter.glb`、`atelier-archive-bookshelf.glb`、`terra-plant.glb`、`terra-plant-cactus.glb`、`terra-rug-round.glb`、`terra-rug-star.glb`、`terra-cash-register.glb`，共 543,340 bytes | 房間裡的櫃台、貨架、植物、地毯、收銀機（`src/room/furnitureModels.ts` 載入） | 擁有者另一個專案 pa-cafe 的 `public/furniture/`（commit `7d7b8364f35b46062d438c774b33dece254c4bac`）：`terra__bar`、`atelier__item_01_archive_bookshelf`、`terra__plant`、`terra__plant_cactus`、`terra__rug_round`、`terra__rug_star`、`terra__counter_classic_cash_register`。逐檔 sha256 在 `README.md` 的「搬來的家具模型」和 `tests/furniture-models.test.ts` | Dylan Lu（pa-cafe 的作者，也是這個專案的擁有者） | pa-cafe 沒有為這些模型寫授權條款。它的 `assets/furniture/README.md`、`countertop/README.md` 和 `sources.json` 把它們記為為 PA Cafe 製作的原創 GLB（收銀機：「Source artwork is original; no third-party island assets were copied」），書櫃來自該專案記錄的 `PA_Cafe_Atelier_Objects_V04` 套件。作者本人把它們放進這個 Apache-2.0 專案。 |
| Nunito Sans variable font, through `@fontsource-variable/nunito-sans` 5.3.0 | The interface font, bundled into `dist/client` | https://github.com/Fonthausen/NunitoSans, packaged by https://github.com/fontsource/font-files | The Nunito Sans Project Authors | SIL Open Font License 1.1 |

The SHA-256 of each Kenney file is in `assets/third-party/kenney-platformer-kit/README.md`, and `scripts/render-character.mjs` refuses to run on any other file.

## Software bundled into the app

These packages ship in `dist/client` or the Worker.

| Package | Version | Source | Author | License |
|---|---|---|---|---|
| react | 19.3.0 | https://github.com/react/react | Meta Platforms, Inc. and affiliates | MIT |
| react-dom | 19.3.0 | https://github.com/react/react | Meta Platforms, Inc. and affiliates | MIT |
| three | 0.186.1 | https://github.com/mrdoob/three.js | three.js authors | MIT |
| zod | 4.6.7 | https://github.com/colinhacks/zod | Colin McDonnell | MIT |
| lucide-react | 1.54.0 | https://github.com/lucide-icons/lucide | Lucide Icons and Contributors | ISC |
| @fontsource-variable/nunito-sans | 5.3.0 | https://github.com/fontsource/font-files | The Nunito Sans Project Authors (font), Fontsource (packaging) | OFL-1.1 |

## Development tools

These build, check or run the project and do not ship in the app.

| Package | Version | Source | Author | License |
|---|---|---|---|---|
| vite | 8.3.4 | https://github.com/vitejs/vite | Evan You and Vite contributors | MIT |
| @vitejs/plugin-react | 6.1.2 | https://github.com/vitejs/vite-plugin-react | Evan You and Vite contributors | MIT |
| vitest | 5.0.3 | https://github.com/vitest-dev/vitest | Anthony Fu and Vitest contributors | MIT |
| typescript | 6.0.3 | https://github.com/microsoft/TypeScript | Microsoft Corp. | Apache-2.0 |
| wrangler | 4.149.0 | https://github.com/cloudflare/workers-sdk | Cloudflare, Inc. | MIT OR Apache-2.0 |
| @cloudflare/workers-types | 5.20261010.1 | https://github.com/cloudflare/workerd | Cloudflare, Inc. | MIT OR Apache-2.0 |
| playwright-core | 1.63.0 | https://github.com/microsoft/playwright | Microsoft Corporation | Apache-2.0 |
| @types/node, @types/react, @types/react-dom, @types/three | 26.6.5, 19.3.0, 19.3.0, 0.186.0 | https://github.com/DefinitelyTyped/DefinitelyTyped | DefinitelyTyped contributors | MIT |

The versions are the ones pinned in `package.json`. Their own dependencies are in `package-lock.json`.

## Code ported from the owner's earlier projects

- The 3D room in `src/room/`, `src/components/`, `src/video/ease.ts`, `src/browserStorage.ts`, `src/i18n/`, `src/world.css` and the room modules in `shared/` come from PA Cafe (`pa-cafe/pa-cafe`, branch `s10-studio-desk`, commit `a48a6b66`), cut down to the showroom. `src/room/furnitureModels.ts` and everything in `src/cart/` are new.
- `tools/meta-hackathon/probe/` and `docs/PLAN.md` come from agentic-remotion-studio (`dnplus/agentic-remotion-studio`, branch `meta-hackathon/2026`, commit `0a0bc75`), cut down as their headers say.

Both projects have the same owner as this repository, and the ported code is included under this repository's Apache-2.0 license.

## Original to this repository

- `public/studio/showroom-set.glb`, the presenter studio set, is generated from three.js primitives by `scripts/generate-studio-set.mjs`. Apache-2.0.
- The counter, cart shelf, plant, rug, product boxes and cash register are drawn in code by `src/room/furnitureModels.ts` and `src/cart/cartScene.ts`. Apache-2.0.
- `docs/screenshots/*.png` are screenshots of this app made by `scripts/screenshots.mjs`. Apache-2.0.
- `public/art/characters/clerk-mint-standee.png` and `clerk-mint-portrait.png` are the Kenney character above with its purple palette cells turned to green (the face and the white parts keep their colours), rendered by `scripts/render-character.mjs`. Kenney's CC0 allows changing the model, and the result is released under Apache-2.0 here.
- The 圍裙店員 and 帽子店員 clerks and the owner's placeholder figure are drawn in code as SVG by `src/room/characterArt.ts` and `src/room/silhouette.ts`. Apache-2.0. They are neutral figures: no character, logo or mascot of any company, and nothing was copied from another project's art.
