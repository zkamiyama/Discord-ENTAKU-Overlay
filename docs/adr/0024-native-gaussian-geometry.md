# ADR 0024: 3DGSから生成する深度・法線と落影

日付: 2026-11-10
状態: 実装。実測と制約は[検証記録](../gaussian-native-geometry.md)。
基点: main `4de147b643fedb212af597c08a44961b8e6a45ac`。適用指示はルートのAGENTS.md。
依存: Spark 2.4.0 / Three.js 0.187.0 / Bun 1.4.4。依存追加・更新なし。

## 目的

proxy.glbがないSPZ/3DGS PLYでも、人物のSSR用深度・法線と、机・床へ落ちる影を作る。既存のカラー、発話グロー、保存形式を維持する。利用者が提供したproxyがある場合は既存経路を優先する。

## 調査と比較

| 方法 | 一次資料で確認した内容 | 今回の判断 |
|---|---|---|
| アルファ閾値を使う深度・影パス | PlayCanvasはGSplatの落影とalphaClipを提供。閾値による細部と影の濃さの違いを説明 | ソート不要のZテストで処理でき、再学習も不要なため採用 |
| 不透明度で加重した深度と深度勾配の法線 | gsplatのD/ED、Andrew ChanのWebGL実装。離れた層の間に深度が現れる場合と、法線ノイズを報告 | 人物の重なりで表面位置が平均化されるため、今回の第一候補にはしない |
| レイ方向で深度を評価する手法 | RaDe-GSなどで深度・法線のラスタライズを扱う | 精度改善候補。今回そのアルゴリズムを移植したとは扱わない |
| メッシュの標準深度・法線描画 | ThreeのMeshDepthMaterial/MeshNormalMaterialは通常の頂点形状を扱う | Gaussianの投影・不透明度を評価できないため、Gaussian部分だけ専用シェーダーを使う |

参照した原文はPlayCanvasの[影](https://developer.playcanvas.com/user-manual/gaussian-splatting/building/shadows/)、[GSplatParams](https://api.playcanvas.com/engine/classes/GSplatParams.html)、[gsplat rasterization](https://docs.gsplat.studio/main/apis/rasterization.html)、[Andrew Chan](https://andrewkchan.dev/posts/lit-splat)、[RaDe-GS](https://baowenz.github.io/radegs/)にある。PlayCanvasの各文書には版による説明の違いがあるため、WebGL2での動作はENTAKUのコードと描画試験で別に確認した。

## 採用した深度と法線

`GaussianSurface`は元のPackedSplatsの位置・回転・スケール・不透明度をGPUで読み、各Gaussianの投影楕円を描く。共有する4頂点のquadはラスタライズ用であり、人物を近似したポリゴンモデルではない。メッシュ生成や学習は行わない。

各画素でGaussianの不透明度が閾値を超えた場合だけ深度を書く。Zテストが最前面を選ぶのでソートは不要。深度値はそのGaussianの中心を投影した値で、楕円体との正確なレイ交点ではない。複数Splatのアルファを積算した表面でもない。

法線は最短軸から作り、normalMatrixによる逆転置変換と視点側への向き合わせを行う。最短軸と中間軸の長さが近いGaussianでは法線が不安定なので、視線に向く法線へ連続的に近づける。球状・針状のGaussianで真の面の向きを復元したとは扱わない。

元Splatを使用するため、カラーのLoD切替で影の形や法線が直接変わらず、カメラの視界外の影も計算できる。一方、幾何用の処理数は元データの数に比例し、カラー用LoD予算では減らない。大規模素材に対する効率は制約として公開する。

## Three.jsとSparkへの接続

Sparkの公開ShaderMaterialから、固定バージョンの投影・共分散処理を取得する。変更箇所を検査するadapterで、ソート済みaccumulator参照を元データの直接参照へ置き換える。元データとaccumulatorのアルファ符号化の違いも明示する。原文は[Spark頂点シェーダー](https://github.com/sparkjsdev/spark/blob/v2.4.0/src/shaders/splatVertex.glsl)。独自ソーターや別のGSライブラリは追加しない。

影は[Object3DのcustomDepthMaterial / onBeforeShadow](https://threejs.org/docs/pages/Object3D.html)へ接続する。r187の[WebGLShadowMap](https://github.com/mrdoob/three.js/blob/r187/src/renderers/webgl/WebGLShadowMap.js)のPCFはDepthTextureを使用するため、深度書き込みだけを追加し、ライト選択・シャドウマップ・フィルターは既存機能を使う。対応ライトは既存ENTAKUと同じDirectionalLightとSpotLight。PointLightの距離マップとVSMは今回の対応外。

| 経路 | native Gaussianの扱い |
|---|---|
| 主画面・測光 | 色も深度も書かない。カラーは既存Sparkが描画 |
| SSR beauty | worldとGSの色を描いた後にだけnative深度を書く |
| SSR normal | world/proxyのMeshNormal描画後に、同じ視点からnative法線を追加 |
| SSR反射面マスク | nativeを反射面として選ばない |
| 人物を含むDoF | カラー後にnative深度を追加 |
| 影 | ライト視点のGaussian深度をPCFマップへ書く |

SSRの探索・反射面選択・減衰は[公式r187 SSRShader](https://github.com/mrdoob/three.js/blob/r187/examples/jsm/shaders/SSRShader.js)のまま。既存入力adapterへ法線描画の完了処理を追加した。主画面の環境深度へ人物自身の深度を書かず、自己遮蔽を防ぐ。

## 資源と更新

元テクスチャはアセットの共有キャッシュに属する。native表示はそのテクスチャを借り、専用のマテリアルと、参照数管理した小さなquadだけを所有する。追加のソートworker・LoD階層・人物別のrender targetは作らない。

影は人物の変換・表示・素材、ライト、閾値、画質設定が変わると更新する。カメラCUTと発話グローだけでは静的な影を再描画しない。分割では各カメラのdepth/normalへ独立に描く。退出・素材交換ではnative表示を破棄してから共有アセットを解放する。

## 対応しないこと

GS本体への物理的な再照明・影の受け取り、透明体の透過率に応じた濃淡の影、画面外を含む完全な鏡像は実装しない。薄いGaussianの積層、浮遊Gaussian、学習された不正確な形状は閾値だけでは修正できない。SSRと中心深度近似の制約は残る。
