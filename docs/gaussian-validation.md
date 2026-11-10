# 静的3DGSアバターの検証記録

## 対象と判定の読み方

対象は`feature/static-3dgs`の実装です。開始HEADは`2ed355cfc2e753672c9340f0bdb3d58161330773`、指示書の参照コミットは`a00cdc2b4b9a656c2026f43bde0c59c011cd8c53`です。開始時の差分はADR 0023の追加だけでした。適用した規則と依存の判断は[ADR 0023](adr/0023-static-gaussian-avatars.md)にあります。

この記録は、コードの実装、実行したテスト、実機での確認を区別します。「テストを追加した」は「合格した」と同じではありません。総合判定が「未実施」の行でも、単体・結合テストで確認できた部分を併記します。

固定依存はBun 1.4.4、Three.js 0.187.0、Spark 2.4.0です。Sparkの公開配布物のgitHeadは`ffe210dc0a45d0515a06c9235878108112827d61`です。

## 実行環境と記録

ローカルの管理実行環境はLinuxです。型検査、GSの単体・結合テスト、Webビルド、Linuxコンパイル済み実行ファイルのHTTPスモークテストを実行しています。全体の`check`には既存のDiscord IPCテストも含まれます。この環境ではUnixドメインソケットを作れず、IPCテストは起動時に失敗します。

同じ制約でChromiumも起動できませんでした。システムChromiumの起動ログは`socket() failed: Operation not permitted (1)`です。ブラウザ内の描画処理に入る前の失敗なので、画質の合否を判断する証拠には使いません。既存のGitHub ActionsでLinux／Windows検査とブラウザテストを実行し、その結果をこの記録へ追記します。

最初の実装コミット`1641de12733e1191f206b2af5381337e61a85f77`の[CI実行](https://github.com/zkamiyama/Discord-ENTAKU-Overlay/actions/runs/42741629729)では、LinuxとWindowsの型検査・全276テストが合格しました。両OSでコンパイルと隔離した実行ファイルのスモークテストも合格し、Windows ZIPは419ファイルとSHA-256の検査を通過しました。ローカルで失敗した既存IPCテストは、CIの両OSで合格しています。

最初のブラウザ実行は52件合格、7件不合格でした。非表示欄のHTMLフォーム検証、SparkとThreeの暗色変換、影の測定範囲、遠距離LoDの測定条件を修正しました。

続く`73058653f78aeb166458dce7d246bbdce2b71d8e`の[CI実行](https://github.com/zkamiyama/Discord-ENTAKU-Overlay/actions/runs/42744137384)では、Linux／Windows各277テスト、両OSのコンパイル・実行ファイルスモーク、Windows配布ZIPの428ファイル検査が合格しました。ブラウザは61件合格、2件不合格です。保存、直描画とtarget経由の色、影、SSR、後処理、空キャッシュのLinux実行ファイル描画は合格しました。不合格は、分割LoDで追加要求が続く場合の完了待ちと、資源計測テストが省略された露出設定の既定値を補っていなかった問題です。

追加監査で、GSの実際の奥行きと低い顔位置がカメラ計算へ十分に反映されないケースも再現しました。座席ローカルの前後境界と顔の8頂点をカメラ計画へ渡す修正を加え、実ショットの投影を検証しています。8体の個別識別、連続CUT、机の前後移動、通常／分割を含む資源解放の検証とともに、次のCI対象です。実GPU、OBS本体、実キャラクター素材での性能評価は未実施です。

## 受け入れ条件 A01〜A16

| 条件 | 判定と根拠 | 次の確認 |
|---|---|---|
| A01 旧2D・旧プリセット | 合格（CI2）：旧schema1、前面／背面、顔矩形・crop、名札、発話、カメラの既存テスト | 実GPU／OBSでの目視は未実施 |
| A02 取り込み・割り当て・調整 | 合格（CI2）：取り込み、プレビュー、倍率・yaw・前後位置の保存、別参加者への書き出し／再取込 | 実キャラクターでの校正は未実施 |
| A03 異なる8体・2D混在 | 未実施（強化後）：旧CIでは総有彩画素だけを確認。PNG監査で奥の顔が他のGSの縁と重なることを確認 | fixtureの実表示範囲を修正し、8色それぞれの顔枠・交換対照・机遮蔽を次CIで検査 |
| A04 発話・stale・入退室・席移動 | 合格（単体＋CI2）：発話だけで取得・LoD生成を繰り返さず、共有資産を維持。実AvatarからGSのopacity・ring・proxyへ各状態と席座標が届くことも単体確認 | staleを含む実機の連続画素・動画評価は未実施 |
| A05 遅い読込・交換・退出・破損 | 合格（単体＋CI2）：遅いAからBへの交換、古い結果の破棄、最後のlease解放、破損した1人と他の表示の分離 | 実GPUでの長時間運用は未実施 |
| A06 顔位置・身長・幅・ショット | 合格（単体）：6変形プロフィールの実顔8頂点を全SINGLE、TWO_SHOT、WIDE、8:9 SPLITへ投影。席幅、身体遮蔽、固定yawも検査 | 奥行きと低い顔の修正後の全CI・実機画像は未実施 |
| A07 分割・CUT・解像度 | 合格（CI2の基本経路）：逆方向2カメラの赤／青、通常／分割、resize、透明領域、view上限 | 同じ2カメラを3回入れ替える追加CUT検査は次CI |
| A08 距離・共通LoD予算 | 不合格（CI2の待機）：左右988点ずつ・合計1976点で予算2000内だが、追加要求のpendingを未完了とみなして待機が失敗 | 完了済みの視点・投影・予算と実表示数を照合する修正を次CIで検査 |
| A09 代理形状の影 | 合格（CI2）：人物とライトの移動による影の変化、ライトのみの変更でscene revisionを維持 | 退出・proxy除去の全画面比較を次CIで追加検査 |
| A10 GS外観のSSR | 合格（CI2）：赤／青それぞれのSSR ON／OFF差から、反射成分がGSの色へ追従することを検査 | 実素材と実GPUでの品質評価は未実施 |
| A11 環境遮蔽と自己遮蔽防止 | 合格（CI2の基本経路）：world遮蔽物で赤画素が減少し、proxy ON／OFFの主画面差分は0 | 同じGSを遮蔽物の前後へ動かす対照を次CIで追加検査 |
| A12 効果・色・透過 | 合格（CI2）：直描画／target色一致、露出からの保護、人物除外、灰色化と復帰、SSR・AO・DoF・Bloomの同時描画 | 同時効果状態の透明画素assertを次CIで追加検査。実GPU／OBSは未実施 |
| A13 保存・再起動・プリセット・持ち運び | 合格（単体・結合＋CI2）：プリセット、校正ZIP、別参加者への割当、Linux配布binary再起動後のGS／proxy再読込と描画 | Windows実ブラウザでの再起動後の描画は未実施 |
| A14 不正素材の拒否 | 合格（単体・結合＋CI2）：manifest・参照・ZIP展開・パス・PLY／SPZ・保存上限の拒否。通常点群PLYのUI説明と既存状態の保持 | 実素材の独自拡張は対応範囲外 |
| A15 資源の解放・共有 | 不合格（CI2の試験準備）：露出設定の既定値不足により422となり、実資源計測に到達しなかった | 設定を修正。交換・エディタ開閉・通常／分割の3反復でworker／WebGL handle／cacheを次CIで測定 |
| A16 配布exe・空キャッシュ・外部遮断 | 未実施（総合）：Linux配布binary、空キャッシュの新規Chromium、外部HTTP／WS遮断、blob worker、WASM、実画素はCI2で合格 | OBS本体とWindows実ブラウザは未実施 |

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
