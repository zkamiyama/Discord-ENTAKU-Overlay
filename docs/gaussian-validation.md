# 静的3DGSアバターの検証記録

## 対象と判定の読み方

対象は`feature/static-3dgs`の実装です。開始HEADは`2ed355cfc2e753672c9340f0bdb3d58161330773`、指示書の参照コミットは`a00cdc2b4b9a656c2026f43bde0c59c011cd8c53`です。開始時の差分はADR 0023の追加だけでした。適用した規則と依存の判断は[ADR 0023](adr/0023-static-gaussian-avatars.md)にあります。

この記録はコードの実装、実行したテスト、実機での確認を区別します。「テストを追加した」は「合格した」と同じではありません。総合判定が「未実施」の行でも、単体・結合テストで確認できた部分を併記します。

固定依存はBun 1.4.4、Three.js 0.187.0、Spark 2.4.0です。Sparkの公開配布物のgitHeadは`ffe210dc0a45d0515a06c9235878108112827d61`です。

## 実行環境と記録

検証対象のソース・テストは`6ab4d92e804e6207d0e0a7d1b6fb05ef7686a8f0`です。[最終CI実行](https://github.com/zkamiyama/Discord-ENTAKU-Overlay/actions/runs/42747157632)は全4ジョブが成功しました。この後の検証記録・利用手順の更新では、ソースとテストを変更していません。

| 実行した検査 | 結果 |
|---|---|
| Linuxの型検査・全体テスト | 289件合格、0件不合格、75ファイル |
| Windowsの型検査・全体テスト | 289件合格、0件不合格、75ファイル |
| Chromiumのe2e | 63件合格、0件不合格。2ジョブに32件／31件を分割 |
| GS専用のローカル単体・結合テスト | 47件合格、0件不合格、3,489 assertions、9ファイル |
| Linux／Windowsのコンパイル済み実行ファイル | 両OSのビルドと隔離HTTPスモークが合格 |
| Windows配布ZIP | 431ファイルとSHA-256の検査が合格 |

ブラウザ検証はLinux上のChromium 158.0.8127.18、ANGLE／SwiftShaderによるソフトウェアWebGLです。実GPU、Windowsの実ブラウザ、OBS本体、実キャラクター素材での確認は未実施です。CIの機能検証を、それらの画質・速度・安定性の確認としては扱いません。

ローカルの管理実行環境もLinuxですが、Unixドメインソケットが禁止されており、既存のDiscord IPCテストとChromiumの起動が失敗します。Chromiumのログは`socket() failed: Operation not permitted (1)`です。描画開始前の環境制約として記録し、全体検査とブラウザ描画は上記CIで実行しました。CIでは既存IPCテストも両OSで合格しています。

初回の[CI](https://github.com/zkamiyama/Discord-ENTAKU-Overlay/actions/runs/42741629729)はブラウザ52件合格・7件不合格、2回目の[CI](https://github.com/zkamiyama/Discord-ENTAKU-Overlay/actions/runs/42744137384)は61件合格・2件不合格でした。非表示欄のフォーム検証、暗色のsRGB変換、影・LoDの測定条件、LoD完了の待機、資源試験の既定設定を修正しました。追加監査で見つかったカメラ計算の奥行き・低い顔位置と、サンプルの実表示範囲も修正し、最終CIで回帰を検査しています。

### 証拠と配布物

- [ブラウザ証拠1](https://github.com/zkamiyama/Discord-ENTAKU-Overlay/actions/runs/42747157632/artifacts/13733050837)：GSのPNG・JSON、実行ファイルのオフライン描画、資源解放の記録。
- [ブラウザ証拠2](https://github.com/zkamiyama/Discord-ENTAKU-Overlay/actions/runs/42747157632/artifacts/13732092994)：もう一方のe2eジョブの記録。
- [Windows開発配布物](https://github.com/zkamiyama/Discord-ENTAKU-Overlay/actions/runs/42747157632/artifacts/13731721312)：上記ソースコミットから作成したZIP。

Windows開発配布物に入る`Discord-ENTAKU-Overlay-0.1.0-rc.15-windows-x64.zip`は59,702,682 bytes、SHA-256は`c465c6efdef01e02ff971cb0438309ea828501d3f3e8b5e9f0a31f2e0664cf78`です。このハッシュはGitHubが外側に付けるartifact ZIPではなく、中の配布ZIPを指します。文書だけを更新して再生成した配布物は別のハッシュになるため、その配布物の`BUILD-INFO.json`と添付チェックサムを参照してください。

GitHub Actionsのartifactには保存期限があります。取得できない場合は、上記コミットから後述のコマンドでテストと配布物生成を再実行できます。

## 受け入れ条件 A01〜A16

全項目のコード実装は完了しています。A01〜A15の「合格」は記載した自動テストの範囲での判定です。実機確認の範囲は右列に分け、A16はOBSを含む総合条件が未実施のため、部分的な合格をもって全体の合格とはしていません。

| 条件 | 判定と根拠 | 未実施の確認・範囲 |
|---|---|---|
| A01 旧2D・旧プリセット | 合格：旧schema1、前面／背面、顔矩形・crop、名札、発話、カメラの既存テスト | 実GPU／OBSでの目視 |
| A02 取り込み・割り当て・調整 | 合格：取り込み、プレビュー、倍率・yaw・前後位置の保存、別参加者への書き出し／再取込 | 実キャラクターでの校正 |
| A03 異なる8体・2D混在 | 合格：8色それぞれの顔領域、1体の交換と復元、7GS＋1画像、机の314標本の遮蔽、逆向き分割でのGS同士の前後関係 | 実素材8体の画質・性能 |
| A04 発話・stale・入退室・席移動 | 合格：実AvatarからGSオブジェクトのopacity・発話グロー状態・proxyへ各状態と席座標が届くことを単体確認。発話による再取得なしと共有維持も検査 | 実Discord切断・復旧とstaleの連続画素・動画評価 |
| A05 遅い読込・交換・退出・破損 | 合格：遅いAからBへの交換、古い結果の破棄、最後のlease解放、破損した1人と他の表示の分離 | 実GPUでの長時間運用 |
| A06 顔位置・身長・幅・ショット | 合格：6変形プロフィールの実顔8頂点を全SINGLE、TWO_SHOT、WIDE、8:9 SPLITへ投影。席幅、身体遮蔽、固定yawも検査 | 実キャラクターでの構図評価 |
| A07 分割・CUT・解像度 | 合格：同じ2カメラで3回のCUT、逆向きの赤／青、通常／分割、resize、透明領域、view上限 | 実GPU／OBSでの連続操作 |
| A08 距離・共通LoD予算 | 合格：完了した視点・投影・予算と実表示選択数が一致。距離と予算で選択数が変化し、分割の合計1976点は予算2000内 | 実素材のLoD品質・処理時間 |
| A09 代理形状の影 | 合格：人物・ライトの移動に影が追従。ライトのみの移動でscene revisionを維持。proxyを非表示にした後、影なしの基準画像との差は0 | 実Discord退出時の影の連続画素、実素材のproxy形状に応じた影品質 |
| A10 GS外観のSSR | 合格：赤／青それぞれのSSR ON／OFF差から、反射成分がGSの色へ追従することを検査 | 実素材と実GPUでの反射品質 |
| A11 環境遮蔽と自己遮蔽防止 | 合格：遮蔽物の後ろで赤画素が減少し、前へ動かすと遮蔽物なしと一致。proxy ON／OFFの主画面差分は0 | 複雑な実素材の交差部 |
| A12 効果・色・透過 | 合格：直描画／target色一致、露出からの保護、人物除外、灰色化と復帰。SSR・AO・DoF・Bloom・MSAA・FXAA同時描画で透明画素を確認 | 実GPU／OBSでの色・アルファ・画質 |
| A13 保存・再起動・プリセット・持ち運び | 合格：プリセット、校正ZIP、別参加者への割当、Linux配布binary再起動後のGS／proxy再読込と描画 | Windows実ブラウザでの再起動後の描画 |
| A14 不正素材の拒否 | 合格：manifest・参照・ZIP展開・パス・PLY／SPZ・保存上限の拒否。通常点群PLYのUI説明と既存状態の保持 | 対応形式は素材仕様書に限定 |
| A15 資源の解放・共有 | 合格：交換・エディタ開閉・通常／分割の3反復で実worker／WebGL handle数が同じ値へ戻る。残る利用者の共有資産を維持し、全解除後はGS cache・viewsが空 | 実GPUメモリbytesと長時間の反復 |
| A16 配布exe・空キャッシュ・外部遮断 | 未実施（総合）：Linux配布binary、新規Chromiumの空キャッシュ、外部HTTP／WS遮断、blob worker、WASM、実画素は合格。Windowsはビルド・HTTPスモークまで合格 | OBS本体とWindows実ブラウザ |

## CIで得た測定値

以下は上記のブラウザ証拠1にあるJSONからの測定値です。ソフトウェアWebGLによる機能検証であり、実GPUでのフレーム速度の目安には使いません。

### 選択数と元データを区別する

`lod-results.json`の素材は入力9,216 Splat、生成後のLoD階層10,113 Splatです。入力を保持するCPU配列は262,144 bytes、LoD配列は325,648 bytesでした。距離や予算を変えてもこの元配列量は変わりません。

| 条件 | 実際の選択数 | 予算 |
|---|---:|---:|
| 距離2m | 9,216 | 12,000 |
| 距離2m、予算を縮小 | 999 | 1,000 |
| 距離40m | 8,880 | 12,000 |
| 距離80m | 216 | 12,000 |
| 距離2mへ戻す | 9,216 | 12,000 |
| 逆向きの分割2画面、2体 | 左988＋右988＝1,976 | 左1,000＋右1,000＝2,000 |

分割時の人物別選択は左`[756, 232]`、右`[232, 756]`でした。完了したLoD結果と実描画の`displayedLodInstances`が一致することを検査しています。`lodPending`がtrueでも、現在の視点に合う完了済み結果と追加要求は区別できます。共有meshのバージョン更新によって再選択が発生するSDKの動作は残っており、その実GPUでの負荷は未測定です。

### 表示・遮蔽・色を確認する

`eight-results.json`では、異なる8素材の入力Splat数は384、448、512、576、640、704、768、832です。各参加者の顔領域で、その素材の色の連結成分が検出され、8人すべてで可視性の条件を通過しました。1人を別色へ交換して戻す対照と、7GS＋1画像の混在でも各参加者を識別できました。机の確認点は314／314がworldの不透明画素となり、GSの漏れは0でした。

`reflection-results.json`では、直描画とrender target経由の色は両方RGBA`[255, 6, 6, 255]`です。proxy ON／OFFの主画面差分は0画素でした。SSRのON／OFF差を赤素材と青素材で比べると、反射領域の6,781画素が外観変更へ追従しています。

`geometry-results.json`では、遮蔽物の後ろに置いたGSの赤画素は11,810から7,048へ減少しました。同じGSを前へ動かすと、遮蔽物の有無で赤画素数は23,737で一致します。影の重心Xはライト移動で388.10から250.85、人物移動で388.10から476.96へ変化しました。proxyを非表示にした後、影なしの基準画像との差は0です。

`split-results.json`では、同じ2カメラの位置・向きを3回切り替え、左右の赤／青の入れ替わりを確認しました。SSR・AO・DoF・Bloom・MSAA・FXAAを同時に有効にした描画で、透明画素は94,629ありました。`color-post-results.json`では、人物除外時の赤から後処理対象時の灰色へ変化し、設定を戻すと元の色・画像へ復帰しました。

### 資源の反復と実行ファイルを確認する

`resource-lifetimes.json`は共有2体から1体への変更、素材交換、通常／分割、エディタ開閉、全解除を3回繰り返した結果です。次の値は各回で同じでした。

| 操作後 | 生存worker数 | 生存texture数 | 生存framebuffer数 |
|---|---:|---:|---:|
| 分割表示 | 7 | 63 | 22 |
| 通常表示へ戻る | 7 | 51 | 12 |
| エディタを閉じる（Dock側） | 1 | 0 | 0 |
| GSをすべて解除（Overlay側） | 1 | 28 | 6 |

全解除後のGS instance数は0で、GS資産一覧とview一覧は空でした。残る1 workerは共有デコードプールです。Overlayのworld描画に必要な資源は残ります。表の値は公開APIで追跡したhandle数であり、GPUメモリのbytesや長時間運転の測定値ではありません。

`executable-offline-results.json`では、Linuxの実行ファイルだけを隔離ディレクトリに置き、PATHを空にして起動しました。保存・再起動後、新規ChromiumでHTTPキャッシュを無効にし、対象サーバー以外へのHTTP／WSを遮断した状態で描画しています。ローカルoriginのblob workerが3つ動作し、1,810,131 bytesのWASMコンパイルに成功しました。GS表示時の赤画素は3,523、解除後は51でした。worker／WASM・ページ・通信のエラーは0です。OBSはこの試験に含まれません。

## 自動テストを再実行する

同じブランチを取得し、Bun 1.4.4とPlaywright対応Chromiumを用意します。

```sh
bun install --frozen-lockfile
bun run check
bun run test:gaussian
bun run fixtures:gaussian
bunx playwright install --with-deps chromium
bun run test:gaussian:browser
bun run build:exe
bun run smoke:exe
```

通常のe2e全体は`bun run test:e2e`です。既存の2D・カメラ・画質テストも維持します。システムChromiumを使う場合は`ENTAKU_CHROMIUM_PATH`へ実行ファイルの絶対パスを指定できます。これはブラウザの場所を選ぶ設定で、OSのソケット制限を回避する機能ではありません。

描画テストは`.work/gaussian/`へPNGとJSONを出力します。CIでは`entaku-browser-evidence-*`に保存します。失敗時はPlaywrightの`test-results/`も確認します。

`gaussian-executable.spec.ts`はLinuxの配布binaryを現ソースからビルドし、空のデータディレクトリへ素材を保存して再起動します。新規Chromiumプロセスの空キャッシュで、対象のローカルサーバー以外へのHTTP／WebSocketを遮断します。表示画素、blob worker、WASMのコンパイル、保存素材の再読込を検査します。OBSの動作はこのテストの対象外です。

Windows配布物の検査は変更のないGit作業ツリーで実行します。

```sh
bun run package:windows
bun run verify:package
```

検査対象はWindows x64 baselineのexe、組込みWeb素材、同梱ソース、文書、Sparkのライセンス、8種類のサンプル、各ファイルとZIPのSHA-256です。`BUILD-INFO.json`へ元コミットを記録します。配布ZIPはCIの`entaku-windows-development`に保存します。

## 実GPUとOBSでの確認手順

この環境にはユーザーの実GPUとOBS本体、評価対象の実キャラクター素材がありません。このため、次の検証は実施済みとして扱いません。

### Windowsで検証用デモを起動する

CIのWindows ZIPを新しいフォルダーへすべて展開し、ZIPのSHA-256と`BUILD-INFO.json`のコミットを記録します。展開先でPowerShellを開き、次を実行してください。初回は未使用のデータディレクトリを指定します。

```powershell
.\ENTAKU-Overlay.exe --demo --no-open --data-dir .\data-3dgs-validation
```

コンソールに表示されたDock URLとOverlay URLを手動で開きます。既定ポートなら、それぞれ`http://127.0.0.1:31337/dock`と`http://127.0.0.1:31337/overlay`です。コンソールは開いたままにし、終了時はCtrl+Cを押します。再起動の確認では同じコマンドとデータディレクトリを使います。

Dockの参加者欄の「＋」（デモ参加者を追加）で8人に増やします。`examples/gaussian/character-01.entaku.zip`から`character-08.entaku.zip`までを取り込み、異なる参加者へ割り当ててください。比較用に「GS1体＋2D7人」と「異なるGS8体」のプリセットを保存します。両条件で参加者数と席配置を揃え、1体条件の素材名も記録します。

### 表示・操作・保存を確認する

1. 1体と8種類の各設定で、顔と名札から各参加者を識別できるか、机とGSの前後関係が正しいかを確認します。8体のうち1体を2D画像へ切り替え、混在した表示も比較します。
2. デモのマイクボタン、退出、復帰、席移動、素材交換を繰り返します。`window.entakuGaussianDiagnostics()`の素材一覧と取得・素材準備の時間を操作前後で保存し、発話だけで再ロードせず、削除した人物が遅れて戻らないことを確認します。
3. SINGLE、TWO_SHOT、WIDE、SPLITで顔位置・身長・横幅を変え、顔が収まり、GS本体がカメラへ勝手に回らないか確認します。分割は自動撮影と分割設定を有効にし、隣接していない2人のデモ発話をONにして、Dockが「左右2分割」になるまで待ちます。分割しない場合はカメラの判断理由を記録します。通常／分割の往復、連続CUT、解像度変更も行います。
4. 影とSSRを個別にON／OFFにします。人物とライトを移動し、退出後の影が消えることを確認します。色の異なるGSへ交換し、机や床の反射色も変わるか比較します。SSR、AO、DoF、Bloom、自動露出、人物除外、画質プリセットを切り替え、透明背景、人物の色、黒画面、効果の残留も記録します。
5. 保存後にexeを終了し、同じコマンドで再起動します。プリセットと書き出したZIPを読み戻し、ZIPを別の参加者へ割り当てて、顔位置・向き・倍率・proxyが復元されるか確認します。

### Windowsブラウザの空キャッシュと外部遮断を確認する

1. 上で作成した検証データを保存し、ブラウザをすべて終了します。閲覧履歴・キャッシュ・拡張機能・同期設定を引き継がない、未使用のブラウザープロフィールを用意します。使用したブラウザのバージョンとプロフィールの作成方法を記録してください。
2. Wi-FiやLANの接続を切るなど、外部ネットへ到達できない状態にします。ローカルの`127.0.0.1`は使える状態を保ち、遮断方法を記録します。ブラウザの通信を一括停止する設定はローカル取得も止めるため、この確認には使いません。
3. 配布exeを同じ検証用データディレクトリで起動し、未使用プロフィールで初めてOverlay URLを開きます。開発者ツールのNetworkとConsoleを記録し、ローカル素材だけでGSとproxyが表示され、worker／WASMの起動エラーがないか確認します。ページを再読み込みし、通常／分割でも確認します。
4. 最初の読み込みと再読み込みを別々に記録します。空キャッシュでの結果には外部遮断前にそのプロフィールで表示した結果を混ぜません。ライブ接続を調べるときは、ここで外部ネット接続を戻します。

### OBSの新規ブラウザソースと再読み込みを確認する

1. OBSで検証用の新しいシーンを作り、新規のブラウザソースへ同じOverlay URLを登録します。幅・高さはまず1920×1080を基準にし、FPS、描画解像度、画質設定を記録します。
2. 1体と8種類、通常と分割で、顔、名札、色、机の遮蔽、影、反射、透明な領域を確認します。下に色付きの背景ソースを置くと、透明部分が黒く埋まっていないか比較できます。画面と録画を保存します。
3. ブラウザソースのプロパティからキャッシュを再読み込みします。続けてexeを終了・再起動し、同じソースが保存済みのGSとproxyを再表示するか確認します。
4. 外部ネットを遮断して`127.0.0.1`への接続を保ち、ソースの再読み込みを繰り返します。新規ソース、再読み込み、exe再起動、外部遮断の各結果を分けて記録します。OBSの結果は上のWindowsブラウザの空キャッシュ試験と区別します。

### Discordの切断・復旧でstaleを確認する

この確認には実際のDiscordデスクトップアプリとVC接続が必要です。[ライブ接続の説明](getting-started.md)を読み、StreamKit互換認証に同意して行います。デモをCtrl+Cで終了してから、別の検証用データディレクトリで起動します。

```powershell
.\ENTAKU-Overlay.exe --live --compat-auth --accept-streamkit-compat --no-open --data-dir .\data-3dgs-validation-live
```

1. Discordの認可を完了し、検証用VCへ接続します。Dockが`ready`になったら参加者へGSを割り当て、実際の発話開始・停止で人物の輪郭グローが点灯・消灯し、リングが表示されないことを確認します。
2. exeとOverlayは動かしたまま、Discordデスクトップアプリをタスクトレイも含めて完全に終了し、ENTAKUとのローカル接続を一時的に切ります。接続状態の変化、参加者の「在席確認待ち」、GSの減光、発話グローの消灯、安全な全景への切り替えを確認します。切断時刻と確認時刻を記録してください。
3. Discordを再起動し、必要な認可と同じVCへの接続を行います。Dockが`ready`へ戻り、参加者の明るさと表示が復帰し、その後の発話に人物の輪郭グローが追従するか確認します。人物や影が重複せず、古い発話状態が残らないかも記録します。
4. 接続が一度も切れていない場合はstaleの試験として合格にせず、行った操作と接続状態を記録します。VCからの退出・復帰は別途、入退室の確認として記録します。

### 条件と結果を記録する

WindowsブラウザとOBSで、次の4項目の組合せ16条件をそれぞれ記録します。1体はGS1体と2D7人、8種類は異なるGS8体とします。各GS構成内では素材の割り当てを固定し、画面・影・SSRの条件を変えても席配置・スタジオ・LoD総予算を揃えます。

| 条件 | 比較する値 |
|---|---|
| GS構成 | 1体／異なる8種類 |
| 画面 | 通常のWIDE／SPLIT |
| 影 | OFF／ON |
| SSR | OFF／ON |

構図を固定して測る場合は、WIDEまたはSPLITへ移った後に自動撮影をOFFにします。SPLITの左右の対象者と、実際に表示された構図も記録してください。各条件で素材の準備完了を待ち、同じ解像度と測定方法で比較します。合成サンプルの結果と実キャラクター素材の結果は分け、実素材を用意できない場合は未実施のまま残します。

| 記録項目 | 内容 |
|---|---|
| 実行物 | source commit、ZIPのSHA-256 |
| 環境 | OS、GPUとドライバー、実際のWebGLレンダラー名、ブラウザ／OBSのバージョン、電源設定 |
| 条件 | GS構成、通常／分割、左右の対象者、影・SSRのON／OFF、空キャッシュか再読込か、外部遮断の方法 |
| 表示 | 解像度、DPR、MSAA、描画解像度、影・SSR・postの全設定、OBSのFPS |
| 素材 | 各キャラクター名、Splat数、ファイルサイズ、proxyの有無、参加者との割り当て |
| 取得時間 | `loadMs`。GS本体と主proxy GLBを初回取得する時間 |
| 素材準備時間 | `decodeAndLodMs`。取得後のGS初期化とproxy準備が両方完了するまでの経過時間 |
| 取得サイズ | `sourceBytes`。初回取得したGS本体と主proxy GLBのArrayBufferバイト数 |
| 描画量 | `totalBudget`、元`inputSplats`、各viewの`active`・`selectedSplats`・`budget`・`displayedLodInstances` |
| LoD状態 | 各viewの`lodMatchesView`と`lodPending`。完了結果の一致と追加の再選択待ちを分ける |
| フレーム | フレーム間隔のp50・p95、測定秒数とサンプル数 |
| メモリ | 元データとLoD配列のCPU bytes、取得できるプロセス指標。GPU値が取れなければ取得不可 |
| 見た目・操作 | 同じ構図のPNG／動画、操作と時刻、各A条件の合格・不合格・未実施、失敗時のConsole・Network記録 |

`decodeAndLodMs`にはGSのデコード・LoD生成に加えて、proxyの外部依存ファイル取得・デコード・形状検査も含まれます。並行する準備処理が両方完了するまでの時間であり、純粋なLoD時間とは扱わず、内訳を推測で分割しません。

`sourceBytes`はGS本体と主proxy GLBのバイト数の合計です。GLBに埋め込まれたデータは含みますが、後から取得するGLTFの外部buffer／texture、manifest、preview、デコーダーのJS／WASMは含みません。総通信量や全素材のメモリ使用量として扱わず、[実装](../src/web/gaussian/assets.ts)の集計範囲を保って記録します。

`requestAnimationFrame`の間隔はGPUの描画時間ではありません。ソフトウェアWebGLのCI結果も実GPUの性能値として扱いません。現在の計測ではGPUメモリとLoD構築時の最大メモリを取得しておらず、診断は`null`です。

### フレーム間隔を測る

素材の準備が終わった映像ページの開発者コンソールで、次を実行します。最初の60フレームを除き、その後600フレームの間隔を測ります。測定中は映像ページを前面に置き、ウィンドウの寸法や画質を変更しないでください。1体／8種類、通常／分割、影・SSRの各条件を変えるたびに実行し、返されたJSONを記録します。

```js
await (async () => {
  const intervals = [];
  let previous;
  for (let i = 0; i < 661; i++) {
    const now = await new Promise(resolve => requestAnimationFrame(resolve));
    if (i > 60 && previous !== undefined) intervals.push(now - previous);
    previous = now;
  }
  const sorted = [...intervals].sort((a, b) => a - b);
  const canvas = document.querySelector('#scene');
  const gl = canvas.getContext('webgl2');
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    measurement: 'requestAnimationFrame interval, not GPU time',
    samples: intervals.length,
    durationMs: intervals.reduce((sum, value) => sum + value, 0),
    p50Ms: sorted[Math.floor(sorted.length * 0.50)],
    p95Ms: sorted[Math.floor(sorted.length * 0.95)],
    userAgent: navigator.userAgent,
    renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
    width: canvas.width,
    height: canvas.height,
    dpr: devicePixelRatio,
    gaussian: window.entakuGaussianDiagnostics()
  };
})()
```

この測定だけではOBSのブラウザソース内のフレーム間隔は分かりません。OBSでは統計と録画結果も併用し、ブラウザで測った値と区別します。公開APIから取得できる値だけを記録し、不明な指標は推定値で埋めません。
