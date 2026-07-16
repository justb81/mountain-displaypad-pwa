# Changelog

## [0.12.1](https://github.com/justb81/mountain-displaypad-pwa/compare/mountain-displaypad-v0.12.0...mountain-displaypad-v0.12.1) (2026-07-16)


### Bug Fixes

* center WCO title bar content and use the app icon in the header ([#119](https://github.com/justb81/mountain-displaypad-pwa/issues/119)) ([e46aaac](https://github.com/justb81/mountain-displaypad-pwa/commit/e46aaac66e281a4d28709168ad60a4b4d19d4fea))
* keep refreshing a minimized window instead of misreading throttling as a wake ([#117](https://github.com/justb81/mountain-displaypad-pwa/issues/117)) ([99862d9](https://github.com/justb81/mountain-displaypad-pwa/commit/99862d929cefe405778757600a932117c1dfe104))

## [0.12.0](https://github.com/justb81/mountain-displaypad-pwa/compare/mountain-displaypad-v0.11.0...mountain-displaypad-v0.12.0) (2026-07-15)


### Features

* PWA manifest tier 1 — focus-existing launch, install identity, icons, Apply-all shortcut ([#108](https://github.com/justb81/mountain-displaypad-pwa/issues/108)) ([8eb7cdf](https://github.com/justb81/mountain-displaypad-pwa/commit/8eb7cdf8823800deb6132969df5a33c2ff232244)), closes [#105](https://github.com/justb81/mountain-displaypad-pwa/issues/105)
* show connection state via Badging API on installed app icon ([#110](https://github.com/justb81/mountain-displaypad-pwa/issues/110)) ([7b19a42](https://github.com/justb81/mountain-displaypad-pwa/commit/7b19a42e4862a0f4ba9f2f469a95ee88bf38c0d1)), closes [#106](https://github.com/justb81/mountain-displaypad-pwa/issues/106)
* Window Controls Overlay — native-feeling title bar for the installed app ([#111](https://github.com/justb81/mountain-displaypad-pwa/issues/111)) ([f031c02](https://github.com/justb81/mountain-displaypad-pwa/commit/f031c02799d0c2624e434d678bfb010a5f5efcd3))

## [0.11.0](https://github.com/justb81/mountain-displaypad-pwa/compare/mountain-displaypad-v0.10.0...mountain-displaypad-v0.11.0) (2026-07-14)


### Features

* re-sync the pad after the machine wakes from standby ([#94](https://github.com/justb81/mountain-displaypad-pwa/issues/94)) ([a742b1f](https://github.com/justb81/mountain-displaypad-pwa/commit/a742b1f4b1f9fa084d25d913dff2a58a20d2114b))

## [0.10.0](https://github.com/justb81/mountain-displaypad-pwa/compare/mountain-displaypad-v0.9.0...mountain-displaypad-v0.10.0) (2026-07-14)


### Features

* Add a "next" page navigation action ([#90](https://github.com/justb81/mountain-displaypad-pwa/issues/90)) ([b21dd6f](https://github.com/justb81/mountain-displaypad-pwa/commit/b21dd6f29c0ad0b57aa218383e31683124fdec35))
* optimize template stash — JSON I/O, keywords, badges, drag-to-stash ([#81](https://github.com/justb81/mountain-displaypad-pwa/issues/81)) ([#93](https://github.com/justb81/mountain-displaypad-pwa/issues/93)) ([64dfd3b](https://github.com/justb81/mountain-displaypad-pwa/commit/64dfd3befeafd7978e6188f655bb0b36cc882e0a))

## [0.9.0](https://github.com/justb81/mountain-displaypad-pwa/compare/mountain-displaypad-v0.8.2...mountain-displaypad-v0.9.0) (2026-07-13)


### Features

* combine page nav actions, drop copy-text, rename Open URL ([#83](https://github.com/justb81/mountain-displaypad-pwa/issues/83), [#84](https://github.com/justb81/mountain-displaypad-pwa/issues/84), [#85](https://github.com/justb81/mountain-displaypad-pwa/issues/85)) ([#86](https://github.com/justb81/mountain-displaypad-pwa/issues/86)) ([eabdab1](https://github.com/justb81/mountain-displaypad-pwa/commit/eabdab1a18e2f722e5610f67920adcae6f412957))


### Bug Fixes

* non-destructive face switching + fully configurable second face ([#80](https://github.com/justb81/mountain-displaypad-pwa/issues/80), [#82](https://github.com/justb81/mountain-displaypad-pwa/issues/82)) ([#87](https://github.com/justb81/mountain-displaypad-pwa/issues/87)) ([bc5145f](https://github.com/justb81/mountain-displaypad-pwa/commit/bc5145fa9e3743f3ba19c1cb174ba35de7238e32))

## [0.8.2](https://github.com/justb81/mountain-displaypad-pwa/compare/mountain-displaypad-v0.8.1...mountain-displaypad-v0.8.2) (2026-07-13)


### Bug Fixes

* use pwa-icon.svg as the browser favicon instead of the unused favicon.svg ([#78](https://github.com/justb81/mountain-displaypad-pwa/issues/78)) ([acd099c](https://github.com/justb81/mountain-displaypad-pwa/commit/acd099c175fd03967b4fc101874f85a3a78a3a3c))

## [0.8.1](https://github.com/justb81/mountain-displaypad-pwa/compare/mountain-displaypad-v0.8.0...mountain-displaypad-v0.8.1) (2026-07-13)


### Bug Fixes

* don't provide brightness 0 percent ([#71](https://github.com/justb81/mountain-displaypad-pwa/issues/71)) ([9c47a34](https://github.com/justb81/mountain-displaypad-pwa/commit/9c47a3420d5bbf8ee720f2caaa24e2826cfd7416))
* Widen the app layout and make text inputs scroll instead of overflow ([#70](https://github.com/justb81/mountain-displaypad-pwa/issues/70)) ([b082732](https://github.com/justb81/mountain-displaypad-pwa/commit/b0827320ad57bc4098cc92e470ce177237547385))

## [0.8.0](https://github.com/justb81/mountain-displaypad-pwa/compare/mountain-displaypad-v0.7.0...mountain-displaypad-v0.8.0) (2026-07-13)


### Features

* named secrets for webhooks and live-template transforms ([#66](https://github.com/justb81/mountain-displaypad-pwa/issues/66)) ([#69](https://github.com/justb81/mountain-displaypad-pwa/issues/69)) ([7dc4988](https://github.com/justb81/mountain-displaypad-pwa/commit/7dc49884f22ddbe746d0f44490876ae13c2f147e))
* set display brightness via HID ([#67](https://github.com/justb81/mountain-displaypad-pwa/issues/67)) ([b804bb7](https://github.com/justb81/mountain-displaypad-pwa/commit/b804bb7d00d848837e71e5e76c3c79c63fb6221a))

## [0.7.0](https://github.com/justb81/mountain-displaypad-pwa/compare/mountain-displaypad-v0.6.0...mountain-displaypad-v0.7.0) (2026-07-13)


### Features

* Update footer to show version and GitHub link ([#65](https://github.com/justb81/mountain-displaypad-pwa/issues/65)) ([684ea5e](https://github.com/justb81/mountain-displaypad-pwa/commit/684ea5e8ace4c6cae9db52b5aac2e208bb1102a5))


### Bug Fixes

* Potential fix for code scanning alert no. 8: Workflow does not contain permissions ([#63](https://github.com/justb81/mountain-displaypad-pwa/issues/63)) ([0c7bdce](https://github.com/justb81/mountain-displaypad-pwa/commit/0c7bdce4f019f140928ded7fa1f3f795e864ce33))

## [0.6.0](https://github.com/justb81/mountain-displaypad-pwa/compare/mountain-displaypad-v0.5.0...mountain-displaypad-v0.6.0) (2026-07-12)


### Features

* auto-load a site icon for Open URL keys ([#41](https://github.com/justb81/mountain-displaypad-pwa/issues/41)) ([#62](https://github.com/justb81/mountain-displaypad-pwa/issues/62)) ([ae770ef](https://github.com/justb81/mountain-displaypad-pwa/commit/ae770ef9f7dd9d2fe04d0785dbc8267c523cf8ef))
* drop images, SVGs, and image URLs straight onto a key ([#61](https://github.com/justb81/mountain-displaypad-pwa/issues/61)) ([8b50109](https://github.com/justb81/mountain-displaypad-pwa/commit/8b50109d65a71017257d088be16970e0c0b82974))
* **pages:** add a delete-page control ([#58](https://github.com/justb81/mountain-displaypad-pwa/issues/58)) ([dd48f5d](https://github.com/justb81/mountain-displaypad-pwa/commit/dd48f5df0af20e68a8f3f0f2bbb4fc632dbcb3af)), closes [#52](https://github.com/justb81/mountain-displaypad-pwa/issues/52)

## [0.5.0](https://github.com/justb81/mountain-displaypad-pwa/compare/mountain-displaypad-v0.4.2...mountain-displaypad-v0.5.0) (2026-07-10)


### Features

* **ux:** UX overhaul: design system, progressive disclosure, and fixed rendering bugs ([#50](https://github.com/justb81/mountain-displaypad-pwa/issues/50)) ([6d98d8e](https://github.com/justb81/mountain-displaypad-pwa/commit/6d98d8eb741e7305c4d5a03f7e5c8027151613bf))

## [0.4.2](https://github.com/justb81/mountain-displaypad-pwa/compare/mountain-displaypad-v0.4.1...mountain-displaypad-v0.4.2) (2026-07-10)


### Bug Fixes

* Stashed template-face keys show a snapshot instead of a blank swatch ([#44](https://github.com/justb81/mountain-displaypad-pwa/issues/44)) ([9e58de8](https://github.com/justb81/mountain-displaypad-pwa/commit/9e58de8812c45a65a97d2871edbe69bda226a4bd))

## [0.4.1](https://github.com/justb81/mountain-displaypad-pwa/compare/mountain-displaypad-v0.4.0...mountain-displaypad-v0.4.1) (2026-07-10)


### Bug Fixes

* reload template/transform editors when switching keys ([#45](https://github.com/justb81/mountain-displaypad-pwa/issues/45)) ([276fddf](https://github.com/justb81/mountain-displaypad-pwa/commit/276fddf0b2f559cbab0488e61a2227a63be4ca9f))

## [0.4.0](https://github.com/justb81/mountain-displaypad-pwa/compare/mountain-displaypad-v0.3.0...mountain-displaypad-v0.4.0) (2026-07-10)


### Features

* Render template key faces live in the virtual keypad ([#43](https://github.com/justb81/mountain-displaypad-pwa/issues/43)) ([0fbd6b3](https://github.com/justb81/mountain-displaypad-pwa/commit/0fbd6b39a0d2a18d718e945c7c4e7248ba147b83))
* reset a key to its defaults via Delete key or Reset button ([#40](https://github.com/justb81/mountain-displaypad-pwa/issues/40)) ([a8bb55d](https://github.com/justb81/mountain-displaypad-pwa/commit/a8bb55dd020464db4f42fd00fabfee3cc8804486))

## [0.3.0](https://github.com/justb81/mountain-displaypad-pwa/compare/mountain-displaypad-v0.2.0...mountain-displaypad-v0.3.0) (2026-07-10)


### Features

* add data-driven template key faces (transform + Mustache HTML) ([#37](https://github.com/justb81/mountain-displaypad-pwa/issues/37)) ([a4cca50](https://github.com/justb81/mountain-displaypad-pwa/commit/a4cca50ae828cfa00f420bf65dc3479245ac1094))

## [0.2.0](https://github.com/justb81/mountain-displaypad-pwa/compare/mountain-displaypad-v0.1.1...mountain-displaypad-v0.2.0) (2026-07-10)


### Features

* add remove-background button for image key faces ([#32](https://github.com/justb81/mountain-displaypad-pwa/issues/32)) ([0ff536c](https://github.com/justb81/mountain-displaypad-pwa/commit/0ff536cef9cdbc08af69aeee9562d3fcaa52716a))
* carry Base Camp profile name and image through import/export ([#27](https://github.com/justb81/mountain-displaypad-pwa/issues/27)) ([9efdaff](https://github.com/justb81/mountain-displaypad-pwa/commit/9efdaff540b11e3c1d9c13bcf89c22e3ea41319f)), closes [#7](https://github.com/justb81/mountain-displaypad-pwa/issues/7)


### Bug Fixes

* default key background color should be black ([#25](https://github.com/justb81/mountain-displaypad-pwa/issues/25)) ([e4fa02e](https://github.com/justb81/mountain-displaypad-pwa/commit/e4fa02e7c1f2bbcf02037ef4f40dc53e0954b185)), closes [#21](https://github.com/justb81/mountain-displaypad-pwa/issues/21)

## [0.1.1](https://github.com/justb81/mountain-displaypad-pwa/compare/mountain-displaypad-v0.1.0...mountain-displaypad-v0.1.1) (2026-07-09)


### Bug Fixes

* use a PAT so release-please's release triggers the Pages deploy ([#23](https://github.com/justb81/mountain-displaypad-pwa/issues/23)) ([cffdda6](https://github.com/justb81/mountain-displaypad-pwa/commit/cffdda67f7ee8b09ab9ddc43bfde2ebaef015fd6))

## [0.1.0](https://github.com/justb81/mountain-displaypad-pwa/compare/mountain-displaypad-v0.0.1...mountain-displaypad-v0.1.0) (2026-07-09)


### Features

* Add drag-and-drop to swap/copy key configs ([#11](https://github.com/justb81/mountain-displaypad-pwa/issues/11)) ([#19](https://github.com/justb81/mountain-displaypad-pwa/issues/19)) ([2ec0704](https://github.com/justb81/mountain-displaypad-pwa/commit/2ec0704ab0f13a442c29c14e6045cd1ac2d55823))
