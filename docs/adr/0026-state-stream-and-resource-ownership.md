# ADR 0026：状態同期・描画資源・処理の責務を分ける

実装済み・検証中（Draft PR #6）。実装対象のコミット、CIの失敗と残作業は[2026-11-27 改修の引き継ぎ](../handoff-2026-11-27.md)に記録する。

## 目的

入退室、発話、カメラの切り替え、素材の変更を繰り返す配信で、不要なロードや描画を減らす。障害時も有効なシーンを残し、メモリの増加と処理時間を観測できる構造にする。

## 決定

- AppEngine は参加者、座席、設定、演出判断を管理する。設定の revision と wire frame を分ける。HTTP の小さな読み取りには全状態の複製を使わない。
- StatePublisher は同じ状態のシリアライズを全クライアントで共用する。プロトコル v2 は初回と再同期で全量を送信し、以後は変更された項目と削除された任意項目を送る。StateReceiver は世代と連番が一致する場合だけ差分を適用する。
- OverlayScene はスナップショットを描画オブジェクトへ反映する。AvatarRoster は席のある参加者だけに描画資源を割り当て、退出時のフェードが終われば破棄する。席予約と描画資源の寿命は独立させる。
- ResourceCache はロード中も含めて素材の参照を管理する。GaussianAssetCache と StudioModelRegistry が同じ仕組みを使う。GLB のソースがジオメトリとテクスチャを所有し、各インスタンスが変更可能なマテリアル、骨格、インスタンス配列を所有する。候補シーンを完成させてから置換し、旧シーンと候補の参照が重複する間は素材を再読込しない。
- ProgramRenderer は通常表示と分割表示を選ぶ。世界座標の影と反射対象を共用し、カメラごとの描画ターゲットと LoD 選択は独立させる。Gaussian の追加では既存ビューを維持し、削除では旧データを描かないためビューを破棄する。
- HTTP の変更操作は同時受付を8件に制限し、コマンド本文は256 KiB以内とする。終了時は実行中の操作を完了させ、待機中の操作を中止する。
- 診断はフレーム間隔の P50/P95/P99、CPU準備時間、描画コマンド送信時間を固定長の標本から計算する。対応する WebGL2 GPU では非同期タイマークエリを使う。未対応の端末では GPU 時間を出さない。

## Three.js と Spark

Three.js r187 の [SkeletonUtils.clone](https://github.com/mrdoob/three.js/blob/r187/examples/jsm/utils/SkeletonUtils.js) を使い、骨格やノードの複製を独自実装しない。GLTFLoader、Draco、KTX2、Meshopt は既存の公式ローダーを使う。

[LightShadow.dispose](https://github.com/mrdoob/three.js/blob/r187/src/lights/LightShadow.js) と needsUpdate を使用する。選択から外れた影のターゲットは解放する。[GTAOPass r187](https://github.com/mrdoob/three.js/blob/r187/examples/jsm/postprocessing/GTAOPass.js) の dispose が破棄しない gtaoMaterial と blendMaterial は既存の addon アダプターで補う。

[SparkRenderer 2.4.0](https://github.com/sparkjsdev/spark/blob/v2.4.0/src/SparkRenderer.ts) の mappingVersion と setDirty を使う。削除時に古いマッピングが表示される可能性があるため、ソートの独自実装や共有ビューの無条件再利用は採用しない。

GPU時間の取得には WebGL2 の EXT_disjoint_timer_query_webgl2 を使用する。依存パッケージは追加しない。新しい状態管理フレームワークを導入しなくても、このアプリの単一サーバーと少数のビューに必要な状態同期と所有権を実装できる。

## 互換性と検証

旧ブラウザ通信プロトコルとの互換層を作らない。保存済み素材と設定は今回の変更のために削除しない。

`bun run check`、全ブラウザ試験、`bun run bench:state` で確認する。合成通信ベンチマークは転送前のJSONバイト数と復元の一致を測る。実GPUの速度、GPUメモリ使用量、OBSの長時間安定性は別の検証である。既存のGaussianリソース試験および発話グロー試験の上限は緩めない。
