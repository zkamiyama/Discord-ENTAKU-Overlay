# ADR 0023：静的3DGSアバターと代理形状

## 基準と依存

作業開始時はユーザー指定のfeature/static-3dgsブランチ、HEADは2ed355cfc2e753672c9340f0bdb3d58161330773だった。実装指示の参照版a00cdc2b4b9a656c2026f43bde0c59c011cd8c53との差分は、このADRの追加45行だけで、実装コードの差分はなかった。このブランチを継続した。ルートAGENTS.mdが適用され、追加のAGENTS.mdはなかった。コミット作成とリモートブランチ更新にはGitHub Pluginを使用する。

公開npmパッケージの@sparkjsdev/spark 2.4.0を固定する。公開配布物のgitHeadは指定コミットffe210dc0a45d0515a06c9235878108112827d61と一致する。threeは0.187.0を維持する。Sparkのpeer dependencyはthree >=0.180.0だが、接続の判断には実際の型検査・ビルド・描画試験を使う。raw sourceのVite用importではなくdist/spark.module.jsをBunで束ねる。固定コミットの文書と公開配布物が異なる部分は、配布物の型と実行結果を優先する。

## データと配置

画像プロフィールは従来形式を受け入れ、GSはkind:gaussianで区別する。画像用faceRectをGSへ流用しない。GSの顔・身体・撮影範囲は、正規化後の右手系・Y-up・+Z-front・メートルで指定する。モデルの単位と軸を変換してから正規化を一度適用し、顔アンカーを原点へ移し、ユーザー倍率と席の変換を一度ずつ適用する。

[A06の構図計算](../../tests/unit/gaussian-camera-framing.test.ts)では、GSの顔・身体・撮影範囲の前後境界も、scaleとyawRad適用後の座席ローカルZとしてCameraContextからカメラ計画へ渡す。奥行きを画像用の近似に置き換えると顔が安全枠を外れるため、ThreeのPerspectiveCamera・Vector3.project・Box3に実際の境界を渡し、構図と遮蔽を判定する。身体の範囲を机の高さで切り詰めても、GSの顔の範囲はWIDEの構図計算に残す。奥行き未指定の旧画像では、従来の近似とカメラ追従を維持する。

キャラクターパッケージはアプリ固有のZIP形式とし、manifest.json、SPZまたは3DGS PLY、任意のproxy.glb・preview.pngを含む。ユーザーIDはパッケージに入れない。ローカル保存は内容ハッシュによる不変アセット、参加者との対応はavatars.jsonで管理する。旧プリセットと設定の読み込みは回帰試験へ残す。

画像とは別に、1素材100万Splat、ファイル128MiB、ZIP192MiB、展開256MiB・64ファイル、保存128素材・1GiB、同時元データ800万Splatを上限とする。通常の点群PLYと非対応SPZ版を明示的に拒否する。GLBの解釈は公式GLTFLoaderと既存のローカル参照解決を使う。

## 描画経路

既存のWebGLRendererを共用する。SparkRendererの描画用ノードはSceneへ一つだけ追加し、追加視点のSparkRendererはSceneへ追加せず、公式renderによる一時的な描画オーバーライドを使う。元データは参照数付きで共用し、視点ごとのソート・LoDの作業状態は別に持つ。通常と左右分割の予算をアプリ全体で割り当てる。

Spark 2.4.0ではLoD更新が共有SplatMeshの版番号も進めるため、分割視点では位置・向き・投影・予算に一致する完了結果があっても、追加の再選択が続く場合がある。診断ではlodPending、完了済みの選択結果、実際の表示個数を分けて示す。追加の再選択が実GPU負荷へ及ぼす影響は未測定である。

GSカラーはDISPLAY_LAYERとGS専用レイヤー、proxyは別の幾何レイヤーとする。親Groupだけのレイヤー設定に依存しない。Sparkは一般Meshの影設定とnormal overrideから除外する。GS本体は座席方向に固定し、2D用のカメラ追従を行わない。

主画面は環境の深度でGSを遮蔽する。proxyは先に主画面へ深度を書かない。影はライト視点からproxyを描き、SSRはGSのカラーとworld＋proxyの深度・法線を別々に用意する。人物をDoFへ含める場合はカラーを描いた後でproxy深度を使う。

r187 SSRPass.renderはreadBufferを読まずbeautyを再描画するため、単にカラー画像を渡す設計にはしない。公式のSSRレイ追跡・ぼかし・反射面マスクを維持し、入力作成だけを版固定のアダプターへ分離する。selectsは反射を受ける面であり、人物の登録リストには使わない。

GSの取得済みカラーを物理再照明とは扱わない。既存のworld・2D用MSAAと露出保護を維持し、色空間、深度、透過は画素試験で確認する。proxyなしは表示を許可するが、影とSSR幾何の不足を表示する。

初回CIで直描画のRGBが[255,6,6]、render target経由が[255,1,1]となった。Spark 2.4.0のpow(rgb,2.2)と、Three r187のIEC sRGB変換が対にならないことが原因だった。color-space.tsで各SparkRendererの公開ShaderMaterial.fragmentShaderにある変換呼び出しを、Three標準のsRGBTransferEOTFへ合わせる。共有ShaderChunkやSDKソース、ソート、alpha、falloffは変更しない。依存更新で対象呼び出しが変わる場合はguard testで検出する。直描画とtargetの画素許容差3は維持する。

## 寿命・検証・配布

素材ごとのロードとLoD生成はアセット変更時だけ行う。世代判定、共有データの参照数、個別失敗時のアイコン復帰、終了時の解放を検証する。発話にはリングと不透明度を使い、音量・音声・口形情報があるとは仮定しない。

公開2.4.0のinitializedはデコードとLoD生成を合わせて完了する。初期化途中の元データを表示できるとは仮定せず、取得、デコードとLoD生成、準備完了、失敗の状態を表示する。時間計測はloadMsとdecodeAndLodMsに分ける。GPUメモリとLoD構築時の最大メモリは取得できないためnullとする。元データの保持量と現在の選択Splat数を混同しない。

SplatMesh.disposeは共有PackedSplatsも破棄するため、表示インスタンスの解放時は共有参照を外す。最後の参照がなくなったときにだけ、キャッシュが所有データを破棄する。各視点のSparkRendererは最大3つとし、実際の素材追加・削除時には視点資源を更新する。使用を中断していた分割視点へ戻るときも、退出済み素材の描画結果を持ち越さない。

A01〜A16へ対応する合成fixtureと自動試験を追加する。8種類は色だけでなく形状・Splat数も異なる元データで作る。既存の2D・カメラ・画素回帰を維持する。workerとWASMは公開配布物に含まれるものをローカルJSへ束ね、外部CDNや広いunsafe-evalを追加しない。空キャッシュ・ネット遮断・コンパイル済みデモで確認する。

実キャラクター素材とOBS実機は未提供であり、ソフトウェアWebGLの結果を実GPU性能へ置き換えない。最終記録には実装、機能試験、実機試験を分け、未実施項目の再現手順を残す。

利用手順は[3DGSキャラクター](../gaussian-avatars.md)、形式は[パッケージ仕様](../gaussian-package.md)、受け入れ条件の結果は[検証記録](../gaussian-validation.md)に記載する。

## 一次資料

- Spark 2.4.0公開パッケージ：https://registry.npmjs.org/@sparkjsdev%2fspark
- Spark固定実装：https://github.com/sparkjsdev/spark/tree/ffe210dc0a45d0515a06c9235878108112827d61
- 複数視点：https://sparkjs.dev/docs/spark-renderer/
- LoD生成：https://sparkjs.dev/docs/lod-getting-started/
- SSR入力：https://github.com/mrdoob/three.js/blob/r187/examples/jsm/postprocessing/SSRPass.js
- 影の更新：https://threejs.org/docs/pages/LightShadow.html
- 色空間：https://threejs.org/manual/en/color-management.html
