### Changelog

All notable changes to this project will be documented in this file. Dates are displayed in UTC.

#### [v2.13.2](https://github.com/ObolNetwork/obol-sdk/compare/v2.13.1...v2.13.2)

- fix: support Safe wallets in EOA withdrawal/exit and batch deposit [`#228`](https://github.com/ObolNetwork/obol-sdk/pull/228)

#### [v2.13.1](https://github.com/ObolNetwork/obol-sdk/compare/v2.13.0...v2.13.1)

> 10 July 2026

- chore(release): v2.13.1 [`#227`](https://github.com/ObolNetwork/obol-sdk/pull/227)
- fix: support Safe wallets in OVM/splitter deployment flows [`#226`](https://github.com/ObolNetwork/obol-sdk/pull/226)

#### [v2.13.0](https://github.com/ObolNetwork/obol-sdk/compare/v2.12.6...v2.13.0)

> 8 July 2026

- chore(release): v2.13.0 [`#225`](https://github.com/ObolNetwork/obol-sdk/pull/225)
- Add v1.11.0 cluster definition hashing with List[Bytes65,32] signatures. [`#220`](https://github.com/ObolNetwork/obol-sdk/pull/220)

#### [v2.12.6](https://github.com/ObolNetwork/obol-sdk/compare/v2.12.5...v2.12.6)

> 2 June 2026

- chore(release): v2.12.6 [`#219`](https://github.com/ObolNetwork/obol-sdk/pull/219)
- fix: move @noble/curves to devDependencies to prevent consumer dep conflicts [`#218`](https://github.com/ObolNetwork/obol-sdk/pull/218)

#### [v2.12.5](https://github.com/ObolNetwork/obol-sdk/compare/v2.12.4...v2.12.5)

> 22 May 2026

- chore(release): v2.12.5 [`#217`](https://github.com/ObolNetwork/obol-sdk/pull/217)
- fix: raise lock validation worker timeouts for large clusters [`#216`](https://github.com/ObolNetwork/obol-sdk/pull/216)

#### [v2.12.4](https://github.com/ObolNetwork/obol-sdk/compare/v2.12.3...v2.12.4)

> 21 May 2026

- chore(release): v2.12.4 [`#215`](https://github.com/ObolNetwork/obol-sdk/pull/215)
- Hanan/worker timeout [`#214`](https://github.com/ObolNetwork/obol-sdk/pull/214)

#### [v2.12.3](https://github.com/ObolNetwork/obol-sdk/compare/v2.12.2...v2.12.3)

> 21 May 2026

- chore(release): v2.12.3 [`#213`](https://github.com/ObolNetwork/obol-sdk/pull/213)
- Hanan/timeoutError+ConcurrentRequests [`#212`](https://github.com/ObolNetwork/obol-sdk/pull/212)

#### [v2.12.2](https://github.com/ObolNetwork/obol-sdk/compare/v2.12.1...v2.12.2)

> 21 May 2026

- chore(release): v2.12.2 [`#211`](https://github.com/ObolNetwork/obol-sdk/pull/211)
- fix(security): stop auto-loading .env and allowlist Obol API baseUrl [`#210`](https://github.com/ObolNetwork/obol-sdk/pull/210)

#### [v2.12.1](https://github.com/ObolNetwork/obol-sdk/compare/v2.12.0...v2.12.1)

> 20 May 2026

- chore(release): v2.12.1 [`#209`](https://github.com/ObolNetwork/obol-sdk/pull/209)
- perf: run lock validation off main thread, parallelize BLS operations [`#208`](https://github.com/ObolNetwork/obol-sdk/pull/208)

#### [v2.12.0](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.13...v2.12.0)

> 15 May 2026

- chore(release): v2.12.0 [`#207`](https://github.com/ObolNetwork/obol-sdk/pull/207)
- Fix/lock share binding validation [`#199`](https://github.com/ObolNetwork/obol-sdk/pull/199)

#### [v2.11.13](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.12...v2.11.13)

> 11 May 2026

- chore(release): v2.11.13 [`#206`](https://github.com/ObolNetwork/obol-sdk/pull/206)
- Feat/export enr [`#204`](https://github.com/ObolNetwork/obol-sdk/pull/204)
- fix: sign release PR commits for branch protection compliance [`#205`](https://github.com/ObolNetwork/obol-sdk/pull/205)

#### [v2.11.12](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.11...v2.11.12)

> 8 May 2026

- chore(release): v2.11.12 [`#203`](https://github.com/ObolNetwork/obol-sdk/pull/203)
- Fix/release pr lockfile sync [`#202`](https://github.com/ObolNetwork/obol-sdk/pull/202)

#### [v2.11.11](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.10...v2.11.11)

> 8 May 2026

- fix(release): sync subproject lockfiles before dependency upgrades [`#201`](https://github.com/ObolNetwork/obol-sdk/pull/201)
- Chore/update dependencies [`#198`](https://github.com/ObolNetwork/obol-sdk/pull/198)
- chore: update dependencies to latest stable versions [`#193`](https://github.com/ObolNetwork/obol-sdk/pull/193)
- fix: pin GitHub Actions to SHA for supply chain security [`#183`](https://github.com/ObolNetwork/obol-sdk/pull/183)
- fix: enforce semantic commits in Renovate config [`#186`](https://github.com/ObolNetwork/obol-sdk/pull/186)
- fix: enforce node signatures count equals operators count in validate… [`#189`](https://github.com/ObolNetwork/obol-sdk/pull/189)
- Update actions/github-script action to v9 [`#187`](https://github.com/ObolNetwork/obol-sdk/pull/187)
- Updates claude.md to consider outside parties [`#188`](https://github.com/ObolNetwork/obol-sdk/pull/188)
- Update peter-evans/create-pull-request action to v8 [`#175`](https://github.com/ObolNetwork/obol-sdk/pull/175)
- Update ffurrer2/extract-release-notes action to v3 [`#169`](https://github.com/ObolNetwork/obol-sdk/pull/169)
- Update actions/checkout action to v6 [`#168`](https://github.com/ObolNetwork/obol-sdk/pull/168)
- Update actions/setup-node action to v6 [`#158`](https://github.com/ObolNetwork/obol-sdk/pull/158)
- Update README.md [`#64`](https://github.com/ObolNetwork/obol-sdk/pull/64)
- Update ffurrer2/extract-release-notes action to v2.3.0 [`#106`](https://github.com/ObolNetwork/obol-sdk/pull/106)
- fix: use Node 24 with --ignore-scripts for OIDC publishing [`#192`](https://github.com/ObolNetwork/obol-sdk/pull/192)
- fix: use Node 22.x for @chainsafe/blst compatibility [`#191`](https://github.com/ObolNetwork/obol-sdk/pull/191)
- chore: migrate npm publishing to OIDC trusted publishers [`#190`](https://github.com/ObolNetwork/obol-sdk/pull/190)
- update claude.md [`#184`](https://github.com/ObolNetwork/obol-sdk/pull/184)
- chore: use yarn cache in release-pr workflow [`248de15`](https://github.com/ObolNetwork/obol-sdk/commit/248de15f0f942b174570f62bea2363698ec06a3a)

#### [v2.11.10](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.9...v2.11.10)

> 16 March 2026

- chore(release): v2.11.10 [`#182`](https://github.com/ObolNetwork/obol-sdk/pull/182)
- remove holesky [`#181`](https://github.com/ObolNetwork/obol-sdk/pull/181)
- improve sdk docs and error handling [`#180`](https://github.com/ObolNetwork/obol-sdk/pull/180)

#### [v2.11.9](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.8...v2.11.9)

> 30 January 2026

- chore(release): v2.11.9 [`#179`](https://github.com/ObolNetwork/obol-sdk/pull/179)
- support delegated EOA [`#178`](https://github.com/ObolNetwork/obol-sdk/pull/178)
- fix docs [`#176`](https://github.com/ObolNetwork/obol-sdk/pull/176)
- Fix: Correct method name in signature validator [`#177`](https://github.com/ObolNetwork/obol-sdk/pull/177)

#### [v2.11.8](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.7...v2.11.8)

> 9 December 2025

- chore(release): v2.11.8 [`#174`](https://github.com/ObolNetwork/obol-sdk/pull/174)
- Hanan/fix ovm deposit [`#173`](https://github.com/ObolNetwork/obol-sdk/pull/173)

#### [v2.11.7](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.6...v2.11.7)

> 5 December 2025

- chore(release): v2.11.7 [`#172`](https://github.com/ObolNetwork/obol-sdk/pull/172)
- new ovm [`#171`](https://github.com/ObolNetwork/obol-sdk/pull/171)
- Hanna/recombine signature fix [`#170`](https://github.com/ObolNetwork/obol-sdk/pull/170)

#### [v2.11.6](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.5...v2.11.6)

> 11 November 2025

- chore(release): v2.11.6 [`#167`](https://github.com/ObolNetwork/obol-sdk/pull/167)
- accept 0 for full withdrawal [`#166`](https://github.com/ObolNetwork/obol-sdk/pull/166)

#### [v2.11.5](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.5-rc.2...v2.11.5)

> 7 November 2025

- chore(release): v2.11.5 [`#165`](https://github.com/ObolNetwork/obol-sdk/pull/165)
- return checksummed ovm address [`#164`](https://github.com/ObolNetwork/obol-sdk/pull/164)

#### [v2.11.5-rc.2](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.5-rc.1...v2.11.5-rc.2)

> 23 October 2025

- [Release] v2.11.5-rc.2 [`#162`](https://github.com/ObolNetwork/obol-sdk/pull/162)
- add js extension to missed files [`#161`](https://github.com/ObolNetwork/obol-sdk/pull/161)

#### [v2.11.5-rc.1](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.5-rc.0...v2.11.5-rc.1)

> 16 October 2025

- [Release] v2.11.5 [`#160`](https://github.com/ObolNetwork/obol-sdk/pull/160)
- remove ot used function [`#159`](https://github.com/ObolNetwork/obol-sdk/pull/159)
- Hanan/browser bundler config [`#157`](https://github.com/ObolNetwork/obol-sdk/pull/157)

#### [v2.11.5-rc.0](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.4...v2.11.5-rc.0)

> 3 October 2025

- [Release] v2.11.5-rc.0 [`#156`](https://github.com/ObolNetwork/obol-sdk/pull/156)
- fix critical vulnerabilities [`#155`](https://github.com/ObolNetwork/obol-sdk/pull/155)

#### [v2.11.4](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.3...v2.11.4)

> 19 September 2025

- chore(release): v2.11.4 [`#154`](https://github.com/ObolNetwork/obol-sdk/pull/154)
- update ovm factory info [`#153`](https://github.com/ObolNetwork/obol-sdk/pull/153)

#### [v2.11.3](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.2...v2.11.3)

> 18 September 2025

- chore(release): v2.11.3 [`#152`](https://github.com/ObolNetwork/obol-sdk/pull/152)
- update  validation for deposit_amounts [`#151`](https://github.com/ObolNetwork/obol-sdk/pull/151)

#### [v2.11.2](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.1...v2.11.2)

> 15 August 2025

- chore(release): v2.11.2 [`#148`](https://github.com/ObolNetwork/obol-sdk/pull/148)
- Hanan/deposit methods [`#147`](https://github.com/ObolNetwork/obol-sdk/pull/147)

#### [v2.11.1](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.0...v2.11.1)

> 15 August 2025

- chore(release): v2.11.1 [`#146`](https://github.com/ObolNetwork/obol-sdk/pull/146)
- Hanan/deposit methods [`#145`](https://github.com/ObolNetwork/obol-sdk/pull/145)

#### [v2.11.0](https://github.com/ObolNetwork/obol-sdk/compare/v2.10.2...v2.11.0)

> 14 August 2025

- chore(release): v2.11.0 [`#144`](https://github.com/ObolNetwork/obol-sdk/pull/144)
- Hanan/deposit methods [`#143`](https://github.com/ObolNetwork/obol-sdk/pull/143)

#### [v2.10.2](https://github.com/ObolNetwork/obol-sdk/compare/v2.10.1...v2.10.2)

> 12 August 2025

- chore(release): v2.10.2 [`#141`](https://github.com/ObolNetwork/obol-sdk/pull/141)
- hoodi support [`#139`](https://github.com/ObolNetwork/obol-sdk/pull/139)

#### [v2.10.1](https://github.com/ObolNetwork/obol-sdk/compare/v2.10.0...v2.10.1)

> 7 August 2025

- chore(release): v2.10.1 [`#138`](https://github.com/ObolNetwork/obol-sdk/pull/138)
- Hanan/await tx [`#137`](https://github.com/ObolNetwork/obol-sdk/pull/137)

#### [v2.10.0](https://github.com/ObolNetwork/obol-sdk/compare/v2.9.1...v2.10.0)

> 6 August 2025

- chore(release): v2.10.0 [`#136`](https://github.com/ObolNetwork/obol-sdk/pull/136)
- Hanan/eoa withdrawal [`#135`](https://github.com/ObolNetwork/obol-sdk/pull/135)

#### [v2.9.1](https://github.com/ObolNetwork/obol-sdk/compare/v2.9.0...v2.9.1)

> 26 July 2025

- chore(release): v2.9.1 [`#134`](https://github.com/ObolNetwork/obol-sdk/pull/134)
- Hanan/ovm request withdrawal [`#133`](https://github.com/ObolNetwork/obol-sdk/pull/133)

#### [v2.9.0](https://github.com/ObolNetwork/obol-sdk/compare/v2.8.1...v2.9.0)

> 25 July 2025

- chore(release): v2.9.0 [`#132`](https://github.com/ObolNetwork/obol-sdk/pull/132)
- Hanan/ovm request withdrawal [`#131`](https://github.com/ObolNetwork/obol-sdk/pull/131)

#### [v2.8.1](https://github.com/ObolNetwork/obol-sdk/compare/v2.8.0...v2.8.1)

> 27 June 2025

- chore(release): v2.8.1 [`#130`](https://github.com/ObolNetwork/obol-sdk/pull/130)
- use splitv2Factory contract instead of sdk [`#129`](https://github.com/ObolNetwork/obol-sdk/pull/129)

#### [v2.8.0](https://github.com/ObolNetwork/obol-sdk/compare/v2.7.0...v2.8.0)

> 25 June 2025

- chore(release): v2.8.0 [`#128`](https://github.com/ObolNetwork/obol-sdk/pull/128)
- Hanan/ovm methods [`#126`](https://github.com/ObolNetwork/obol-sdk/pull/126)

#### [v2.7.0](https://github.com/ObolNetwork/obol-sdk/compare/v2.6.0...v2.7.0)

> 11 June 2025

- chore(release): v2.7.0 [`#125`](https://github.com/ObolNetwork/obol-sdk/pull/125)
- Adding BLS aggregation for exits [`#123`](https://github.com/ObolNetwork/obol-sdk/pull/123)

#### [v2.6.0](https://github.com/ObolNetwork/obol-sdk/compare/v2.5.1...v2.6.0)

> 6 June 2025

- chore(release): v2.6.0 [`#122`](https://github.com/ObolNetwork/obol-sdk/pull/122)
- Update release-pr.yml [`#121`](https://github.com/ObolNetwork/obol-sdk/pull/121)
- Exit sdk commands [`#120`](https://github.com/ObolNetwork/obol-sdk/pull/120)

#### [v2.5.1](https://github.com/ObolNetwork/obol-sdk/compare/v2.5.0...v2.5.1)

> 30 May 2025

- chore(release): v2.5.1 [`#117`](https://github.com/ObolNetwork/obol-sdk/pull/117)
- default compounding to false [`#116`](https://github.com/ObolNetwork/obol-sdk/pull/116)

#### [v2.5.0](https://github.com/ObolNetwork/obol-sdk/compare/v2.4.6...v2.5.0)

> 23 May 2025

- chore(release): v2.5.0 [`#114`](https://github.com/ObolNetwork/obol-sdk/pull/114)
- default to v1.10.0 [`#111`](https://github.com/ObolNetwork/obol-sdk/pull/111)

#### [v2.4.6](https://github.com/ObolNetwork/obol-sdk/compare/v2.4.5...v2.4.6)

> 24 March 2025

- chore(release): v2.4.6 [`#105`](https://github.com/ObolNetwork/obol-sdk/pull/105)
- fix incentives type and accept rpcul in validateClusterLock [`#104`](https://github.com/ObolNetwork/obol-sdk/pull/104)

#### [v2.4.5](https://github.com/ObolNetwork/obol-sdk/compare/v2.4.4...v2.4.5)

> 20 March 2025

- chore(release): v2.4.5 [`#103`](https://github.com/ObolNetwork/obol-sdk/pull/103)
- Hanna/small fix [`#102`](https://github.com/ObolNetwork/obol-sdk/pull/102)

#### [v2.4.4](https://github.com/ObolNetwork/obol-sdk/compare/v2.4.3...v2.4.4)

> 19 March 2025

- chore(release): v2.4.4 [`#101`](https://github.com/ObolNetwork/obol-sdk/pull/101)
- remove not needed assignment [`#100`](https://github.com/ObolNetwork/obol-sdk/pull/100)

#### [v2.4.3](https://github.com/ObolNetwork/obol-sdk/compare/v2.4.2...v2.4.3)

> 18 March 2025

- chore(release): v2.4.3 [`#98`](https://github.com/ObolNetwork/obol-sdk/pull/98)
- add hoodi [`#97`](https://github.com/ObolNetwork/obol-sdk/pull/97)

#### [v2.4.2](https://github.com/ObolNetwork/obol-sdk/compare/v2.4.1...v2.4.2)

> 14 March 2025

- chore(release): v2.4.2 [`#96`](https://github.com/ObolNetwork/obol-sdk/pull/96)
- fetch incentives by network [`#95`](https://github.com/ObolNetwork/obol-sdk/pull/95)

#### [v2.4.1](https://github.com/ObolNetwork/obol-sdk/compare/v2.4.0...v2.4.1)

> 13 March 2025

- chore(release): v2.4.1 [`#94`](https://github.com/ObolNetwork/obol-sdk/pull/94)
- expect a provider in client [`#93`](https://github.com/ObolNetwork/obol-sdk/pull/93)

#### [v2.4.0](https://github.com/ObolNetwork/obol-sdk/compare/v2.3.0...v2.4.0)

> 13 March 2025

- chore(release): v2.4.0 [`#92`](https://github.com/ObolNetwork/obol-sdk/pull/92)
- incentives methods [`#90`](https://github.com/ObolNetwork/obol-sdk/pull/90)

#### [v2.3.0](https://github.com/ObolNetwork/obol-sdk/compare/v2.2.4...v2.3.0)

> 6 March 2025

- chore(release): v2.3.0 [`#89`](https://github.com/ObolNetwork/obol-sdk/pull/89)
- feat: add getIncentivesByAddress method to fetch incentives for a given address [`#77`](https://github.com/ObolNetwork/obol-sdk/pull/77)

#### [v2.2.4](https://github.com/ObolNetwork/obol-sdk/compare/v2.2.3...v2.2.4)

> 24 February 2025

- chore(release): v2.2.4 [`#87`](https://github.com/ObolNetwork/obol-sdk/pull/87)
- Hanan/v1.10.0 [`#86`](https://github.com/ObolNetwork/obol-sdk/pull/86)

#### [v2.2.3](https://github.com/ObolNetwork/obol-sdk/compare/v2.2.2...v2.2.3)

> 21 February 2025

- chore(release): v2.2.3 [`#85`](https://github.com/ObolNetwork/obol-sdk/pull/85)
- v1.10.0 [`#81`](https://github.com/ObolNetwork/obol-sdk/pull/81)
- feat: add renovate.json [`#75`](https://github.com/ObolNetwork/obol-sdk/pull/75)

#### [v2.2.2](https://github.com/ObolNetwork/obol-sdk/compare/v2.2.1...v2.2.2)

> 7 February 2025

- chore(release): v2.2.2 [`#74`](https://github.com/ObolNetwork/obol-sdk/pull/74)
- fix environment variable check and update readme [`#73`](https://github.com/ObolNetwork/obol-sdk/pull/73)

#### [v2.2.1](https://github.com/ObolNetwork/obol-sdk/compare/v2.2.0...v2.2.1)

> 7 February 2025

- chore(release): v2.2.1 [`#72`](https://github.com/ObolNetwork/obol-sdk/pull/72)
- fix verify eoa and safe signatures when publishing a lock [`#71`](https://github.com/ObolNetwork/obol-sdk/pull/71)

#### [v2.2.0](https://github.com/ObolNetwork/obol-sdk/compare/v2.1.2...v2.2.0)

> 7 February 2025

- chore(release): v2.2.0 [`#69`](https://github.com/ObolNetwork/obol-sdk/pull/69)
- Hanan/support safe [`#68`](https://github.com/ObolNetwork/obol-sdk/pull/68)

#### [v2.1.2](https://github.com/ObolNetwork/obol-sdk/compare/v2.1.1...v2.1.2)

> 8 January 2025

- chore(release): v2.1.2 [`#66`](https://github.com/ObolNetwork/obol-sdk/pull/66)
- Hanan/safe fix [`#65`](https://github.com/ObolNetwork/obol-sdk/pull/65)

#### [v2.1.1](https://github.com/ObolNetwork/obol-sdk/compare/v2.1.0...v2.1.1)

> 23 October 2024

- chore(release): v2.1.1 [`#62`](https://github.com/ObolNetwork/obol-sdk/pull/62)
- Add owr tranch function [`#61`](https://github.com/ObolNetwork/obol-sdk/pull/61)

#### [v2.1.0](https://github.com/ObolNetwork/obol-sdk/compare/v2.0.1...v2.1.0)

> 10 October 2024

- chore(release): v2.1.0 [`#60`](https://github.com/ObolNetwork/obol-sdk/pull/60)
- a warning and some improvements [`#59`](https://github.com/ObolNetwork/obol-sdk/pull/59)
- Hanan/create split [`#57`](https://github.com/ObolNetwork/obol-sdk/pull/57)

#### [v2.0.1](https://github.com/ObolNetwork/obol-sdk/compare/v2.0.0...v2.0.1)

> 6 August 2024

- chore(release): v2.0.1 [`#55`](https://github.com/ObolNetwork/obol-sdk/pull/55)
- Hanan/null deposit amounts [`#54`](https://github.com/ObolNetwork/obol-sdk/pull/54)
- accept a null value for deposit_amounts [`#52`](https://github.com/ObolNetwork/obol-sdk/pull/52)

### [v2.0.0](https://github.com/ObolNetwork/obol-sdk/compare/v1.0.17...v2.0.0)

> 30 July 2024

- [Release] v2.0.0 [`#50`](https://github.com/ObolNetwork/obol-sdk/pull/50)

#### [v1.0.17](https://github.com/ObolNetwork/obol-sdk/compare/v1.0.16...v1.0.17)

> 2 July 2024

- fix release action [`#49`](https://github.com/ObolNetwork/obol-sdk/pull/49)
- [Release] v1.0.17 [`#48`](https://github.com/ObolNetwork/obol-sdk/pull/48)
- use v1.8.0 in cluster creation [`#32`](https://github.com/ObolNetwork/obol-sdk/pull/32)
- chore(release): v1.0.17 [`#47`](https://github.com/ObolNetwork/obol-sdk/pull/47)
- revert back to using git changelog [`#46`](https://github.com/ObolNetwork/obol-sdk/pull/46)
- Hanan/ta nd c [`#44`](https://github.com/ObolNetwork/obol-sdk/pull/44)

#### [v1.0.16](https://github.com/ObolNetwork/obol-sdk/compare/v1.0.15...v1.0.16)

> 24 May 2024

- chore(release): v1.0.16 [`#43`](https://github.com/ObolNetwork/obol-sdk/pull/43)
- Hanan/tandc [`#42`](https://github.com/ObolNetwork/obol-sdk/pull/42)

#### [v1.0.15](https://github.com/ObolNetwork/obol-sdk/compare/v1.0.14...v1.0.15)

> 22 May 2024

- chore(release): v1.0.15 [`#41`](https://github.com/ObolNetwork/obol-sdk/pull/41)
- add acceptTermsAndConditions method [`#39`](https://github.com/ObolNetwork/obol-sdk/pull/39)

#### [v1.0.14](https://github.com/ObolNetwork/obol-sdk/compare/v1.0.13...v1.0.14)

> 6 May 2024

- chore(release): v1.0.14 [`#40`](https://github.com/ObolNetwork/obol-sdk/pull/40)
- Fix publish step in release [`#38`](https://github.com/ObolNetwork/obol-sdk/pull/38)

#### [v1.0.13](https://github.com/ObolNetwork/obol-sdk/compare/v1.0.12...v1.0.13)

> 18 March 2024

- Update changelog [`#37`](https://github.com/ObolNetwork/obol-sdk/pull/37)
- Fix release WF [`#36`](https://github.com/ObolNetwork/obol-sdk/pull/36)
- chore(release): v1.0.13 [`#35`](https://github.com/ObolNetwork/obol-sdk/pull/35)
- add contribution guidelines [`#34`](https://github.com/ObolNetwork/obol-sdk/pull/34)
- support v1.8.0 [`#31`](https://github.com/ObolNetwork/obol-sdk/pull/31)
- update e2e during release [`#25`](https://github.com/ObolNetwork/obol-sdk/pull/25)
- Luke/Fix changelog [`#24`](https://github.com/ObolNetwork/obol-sdk/pull/24)
- Add a workflow to create a release PR [`#19`](https://github.com/ObolNetwork/obol-sdk/pull/19)
- fix changelog generation [`c16e588`](https://github.com/ObolNetwork/obol-sdk/commit/c16e5881773b47b7b7e02f3241888c49ed70077c)
- Create label-issues.yml [`0f1252f`](https://github.com/ObolNetwork/obol-sdk/commit/0f1252f24badba89251a3595cb5d57a0790e5faf)
- change to upgrade [`430bbc0`](https://github.com/ObolNetwork/obol-sdk/commit/430bbc05325f5b5f713b52952fd16954cf1396d6)

#### v1.0.12

> 27 February 2024

- Fix sdk deployment [`#18`](https://github.com/ObolNetwork/obol-sdk/pull/18)
- Hanan/update sdk [`#17`](https://github.com/ObolNetwork/obol-sdk/pull/17)
- Hanan/update sdk [`#16`](https://github.com/ObolNetwork/obol-sdk/pull/16)
- Hanan/update sdk [`#15`](https://github.com/ObolNetwork/obol-sdk/pull/15)
- Hanan/get cluster lock [`#12`](https://github.com/ObolNetwork/obol-sdk/pull/12)
- Hanan/config cluster method [`#3`](https://github.com/ObolNetwork/obol-sdk/pull/3)
- poc for obol-sdk [`#1`](https://github.com/ObolNetwork/obol-sdk/pull/1)
- Bump json5 from 2.2.1 to 2.2.3 [`#3`](https://github.com/ObolNetwork/obol-sdk/pull/3)
- add artifacts files [`76fe25c`](https://github.com/ObolNetwork/obol-sdk/commit/76fe25cf95733651b70d2e0d99f593994364a8c3)
- drop build info [`7265292`](https://github.com/ObolNetwork/obol-sdk/commit/7265292cb6b9264f4fe61bd4929a6d1acf495a15)
- add typechain files [`5e29b6a`](https://github.com/ObolNetwork/obol-sdk/commit/5e29b6adad0bc630d301a6274a58a678276ee773)
