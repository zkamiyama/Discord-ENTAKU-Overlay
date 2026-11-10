# 静的3DGSアバターの検証記録

## 対象と判定の読み方

対象は`feature/static-3dgs`の実装です。開始HEADは`2ed355cfc2e753672c9340f0bdb3d58161330773`、指示書の参照コミットは`a00cdc2b4b9a656c2026f43bde0c59c011cd8c53`です。開始時の差分はADR 0023の追加だけでした。適用した規則と依存の判断は[ADR 0023](adr/0023-static-gaussian-avatars.md)にあります。

この記録は、コードの実装、実行したテスト、実機での確認を区別します。「テストを追加した」は「合格した」と同じではありません。総合判定が「未実施」の行でも、単体・結合テストで確認できた部分を併記します。

固定依存はBun 1.4.4、Three.js 0.187.0、Spark 2.4.0です。Sparkの公開配布物のgitHeadは`ffe210dc0a45d0515a06c9235878108112827d61`です。

## 実行環境と記録

ローカルの管理実行環境はLinuxです。型検査、GSの単体・結合テスト、Webビルド、Linuxコンパイル済み実行ファイルのHTTPスモークテストを実行しています。全体の`check`には既存のDiscord IPCテストも含まれます。この環境ではUnixドメインソケットを作れず、IPCテストは起動時に失敗します。

同じ制約でChromiumも起動できませんでした。システムChromiumの起動ログは`socket() failed: Operation not permitted (1)`です。ブラウザ内の描画処理に入る前の失敗なので、画質の合否を判断する証拠には使いません。既存のGitHub ActionsでLinux／Windows検査とブラウザテストを実行し、その結果をこの記録へ追記します。

最初の実装コミット`1641de12733e1191f206b2af5381337e61a85f77`の[CI実行](https://github.com/zkamiyama/Discord-ENTAKU-Overlay/actions/runs/42741629729)では、LinuxとWindowsの型検査・全276テストが合格しました。両OSでコンパイルと隔離した実行ファイルのスモークテストも合格し、Windows ZIPは419ファイルとSHA-256の検査を通過しました。ローカルで失敗した既存IPCテストは、CIの両OSで合格しています。

最初のブラウザ実行は52件合格、7件不合格でした。非表示欄のHTMLフォーム検証による画像／GS保存の失敗、直描画とrender targetの暗色の差、影の測定範囲、遠距離LoDの想定値を修正・再検証中です。この初回結果だけで全受け入れ条件を合格にはしません。実GPU、OBS本体、実キャラクター素材での性能評価は未実施です。

## 受け入れ条件 A01〜A16

| 条件 | 実装と検証コード | 総合判定・残る確認 |
|---|---|---|
| A01 旧2D・旧プリセット | 画像／GSのunion、kind省略の画像読込、旧schema1読込。旧画像・カメラテストと`gaussian-store.test.ts` | 未実施：データ回帰は合格。ブラウザで前面・背面・名札・発話・カメラを確認する |
| A02 取り込み・割り当て・調整 | API、キャッシュ、プレビュー、単位・軸・正規化・顔アンカー。`gaussian-avatars.spec.ts` | 未実施：変換とAPIのテストは合格。プレビューと本番の画像を確認する |
| A03 異なる8体・2D混在 | 異なる8パッケージ、共有renderer、2D切替。`gaussian-avatars.spec.ts`と描画probe | 未実施：8種類の元データ検査は合格。8体の識別・遮蔽・前後関係の画像を確認する |
| A04 発話・stale・入退室・席移動 | リング、不透明度、世代管理、席座標。`gaussian-lifecycle.test.ts`と8体のe2e | 未実施：発話や変換で再ロードしない単体テストは合格。実描画で状態変化を確認する |
| A05 遅い読込・交換・退出・破損 | 参照数付き非同期キャッシュ、古い結果の破棄、個別フォールバック | 未実施：非同期競合と共有資産の単体テストは合格。遅延HTTPとエラー時の実描画を確認する |
| A06 顔位置・身長・幅・ショット | 3D境界のカメラ入力、座席固定yaw。`gaussian-profile.test.ts`と既存shot planner回帰 | 未実施：各plannerの幾何テストは合格。各ショットの顔の収まりを実機で確認する |
| A07 分割・CUT・解像度 | 視点ごとのSparkRenderer、最大3視点、主／左／右のLoDとsort。`gaussian-render.spec.ts` | 未実施：逆方向2カメラ、通常／分割の往復、resizeの画素検査を実行する |
| A08 距離・共通LoD予算 | 全体予算と視点への配分、元データと選択数の診断。密な9,216点のprobe | 未実施：設定・配分の実装あり。実際の選択数が距離と予算で変わることを確認する |
| A09 代理形状の影 | proxy専用レイヤー、avatarとlight変更の影更新。`gaussian-rendering.test.ts`と描画probe | 未実施：無効化条件の単体テストは合格。影の移動・除去を画素で確認する |
| A10 GS外観のSSR | 公式SSRPassへGSカラーとworld＋proxy幾何を供給。赤／青それぞれのSSR ON／OFF差分 | 未実施：入力順のテストは合格。反射成分の色がGSへ追従することを画素で確認する |
| A11 環境遮蔽と自己遮蔽防止 | 環境深度でGS描画後、必要なパスだけproxy深度を追加 | 未実施：主world targetを変更しない単体テストは合格。遮蔽物とproxy ON／OFFの画像を比較する |
| A12 効果・色・透過 | 既存quality/post経路との統合。直描画／target経由、SSR／AO／DoF／Bloom等のprobe | 未実施：既存設定検査は合格。効果の組合せと透過・色を画素で確認する |
| A13 保存・再起動・プリセット・持ち運び | 新schema2保存、旧schema1読込、共有素材参照、placement付きZIP。API／storeの結合テスト | 未実施：ディスク再読込・プリセット・別参加者へのZIP再取込は合格。配布binary再起動後の描画を確認する |
| A14 不正素材の拒否 | パス、ZIP終端・展開量、manifest、SPZ／PLY、欠損、保存上限を検査。失敗前後の保存状態を比較 | 合格（単体・結合）：不正入力で既存の素材と設定を変更しない。UI説明はブラウザ確認待ち |
| A15 資源の解放・共有 | アセットlease、世代、view破棄、preview終了。キャッシュとproxy共有の単体テスト | 未実施：所有権の単体テストは合格。実worker・texture・render targetの反復測定を実行する |
| A16 配布exe・空キャッシュ・外部遮断 | worker／WASMをバンドル、配布サンプルとライセンス同梱、compiled smoke | 未実施：Linux binaryの起動と組込みHTTP配信は合格。空キャッシュのブラウザとOBSでGS描画を確認する |

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

Windows配布物の検査は、変更のないGit作業ツリーで実行します。

```sh
bun run package:windows
bun run verify:package
```

検査対象はWindows x64 baselineのexe、組込みWeb素材、同梱ソース、文書、Sparkのライセンス、8種類のサンプル、各ファイルとZIPのSHA-256です。`BUILD-INFO.json`へ元コミットを記録します。配布ZIPはCIの`entaku-windows-development`に保存します。

## 実GPUとOBSでの確認手順

この環境にはユーザーの実GPUとOBS本体、評価対象の実キャラクター素材がありません。このため、次の検証は実施済みとして扱いません。

1. CIのWindows ZIPを展開し、`BUILD-INFO.json`のコミットを記録します。既存データへ影響させないよう、検証専用の`--data-dir`で`--demo --no-open`を起動します。
2. 1体を割り当てたあと、異なるサンプル8体を割り当てます。続けて1体を2D画像へ切り替え、各参加者の識別、机による遮蔽、GS同士の前後関係を確認します。
3. 発話、退出、復帰、席移動、素材交換を繰り返します。`entakuGaussianDiagnostics()`のロード／LoD時間が発話だけで変わらず、削除した人物が遅れて戻らないことを確認します。
4. SINGLE、TWO、WIDE、SPLITを切り替えます。顔位置・身長・横幅を変え、顔が収まり、カメラへGS本体が勝手に回らないことを確認します。通常／分割の往復、連続CUT、解像度変更も行います。
5. 影とSSRをそれぞれON／OFFにします。人物とライトを移動し、退出後の影が消えることを確認します。GSの色を変え、机や床に映る反射の色も変わることを比較します。
6. SSR、AO、DoF、Bloom、自動露出、人物除外、画質プリセットを切り替えます。透明背景、人物の色、黒画面、効果の残留を比較します。
7. 保存後にexeを再起動し、プリセットと書き出したZIPを読み戻します。ZIPは別の参加者へ割り当てます。
8. ブラウザを終了して空の新規プロファイルを使い、外部ネット接続を遮断します。ローカルの`127.0.0.1`への接続は許可し、配布exeから3DGSが表示されるか確認します。
9. 同じOverlay URLをOBSの新しいブラウザソースへ登録し、同じ解像度・画質で確認します。ブラウザソースのキャッシュを再読み込みし、外部ネットを遮断した状態でも表示されるか確認します。

実機での1体／8種類、通常／分割、影OFF／ON、SSR OFF／ONの各条件で、以下を記録してください。

| 記録項目 | 内容 |
|---|---|
| 実行物 | source commit、ZIPのSHA-256 |
| 環境 | OS、GPUとドライバー、ブラウザ／OBSの版 |
| 表示 | 解像度、DPR、MSAA、描画解像度、影・SSR・postの全設定 |
| 素材 | 各キャラクターのSplat数、ファイルサイズ、proxyの有無 |
| 準備時間 | `loadMs`、`decodeAndLodMs`。後者をデコードとLoDへ推測で分割しない |
| 描画量 | 各viewの`selectedSplats`と`budget`、元`inputSplats` |
| フレーム | フレーム間隔のp50・p95、測定秒数とサンプル数 |
| メモリ | 元データとLoD配列のCPU bytes、取得できるプロセス指標。GPU値が取れなければ取得不可 |
| 見た目 | 同じ構図のPNG／動画、各A条件の合格・不合格・未実施 |

`requestAnimationFrame`の間隔はGPUの描画時間ではありません。ソフトウェアWebGLのCI結果も実GPUの性能値として扱いません。GPUメモリとLoD構築時の最大メモリは、現行の公開APIでは取得できず、診断は`null`です。

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
