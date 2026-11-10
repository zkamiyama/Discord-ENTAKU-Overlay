# ADR 0025: 3D Meshの発話輪郭を画面上で描く

日付: 2026-11-10
状態: 実装・検証中
基点: main `0e63e768006d02abcd39172d0fe39c19d3a9d790`
依存: Three.js 0.187.0、Bun 1.4.4、Spark 2.4.0（追加依存なし）

## 問題

3DGSの発話グローは、人物の投影高さから画面上の半径を決め、拡張されたGaussianのアルファを合成する。Three.jsのGLB/GLTFモデルにはSplatのアルファ楕円がないため、そのシェーダーを直接適用できない。

現在のアバター用のプロフィールは画像と3DGSだけであり、GLB/GLTFはスタジオのモデルとして保存・読み込み可能。モデルを参加者と関連付ければ、既存の素材保存とGLTFLoaderを利用しつつ、メッシュをアバターとして表示できる。

## 候補の比較

| 方式 | 利点 | 採用判断 |
|---|---|---|
| Three.js公式OutlinePass | シルエットと遮蔽をレンダーターゲットで処理。薄い板にも使える | 新たな画面全体の複数パスが必要。既存QualityRenderer、PostRenderer、分割描画との順序・対象管理が複雑になるため現段階では保留 |
| 裏面メッシュを世界座標で押し出す | 専用RTなし、既存深度テスト使用 | カメラ距離で太さが変わるため不採用 |
| Three.js MeshBasicMaterial＋スクリーン空間の裏面シェル | 標準メッシュ描画、深度テスト、スキニング・モーフ・インスタンス対応。画面上の幅を指定できる | 採用 |
| 3DGSの直接アルファ拡張 | Gaussianに適する | 三角形メッシュには適用できない |

参照： [OutlinePass公式](https://threejs.org/docs/pages/OutlinePass.html)、[Material.onBeforeCompile公式](https://threejs.org/docs/pages/Material.html)、[three.js r187 MeshBasicMaterialシェーダー](https://github.com/mrdoob/three.js/blob/r187/src/renderers/shaders/ShaderLib/meshbasic.glsl.js)。

## 実装

`StudioObject.kind:'model'`へ任意の`speakerUserId`を追加。Dockで保存する。同じモデルをGLTFLoaderで読み込み、モデルごとに`MeshSpeechGlow`を取り付ける。発話の強度は既存Avatarの時間減衰・stale判定をそのまま使用。人物の平面アイコンと3DGSは関連付け中に非表示にし、名前プレートは継続する。モデルの位置はスタジオのtransformを維持する。

元モデルを複製するのではなく、元Meshの子として同じジオメトリを参照する裏面描画オブジェクトを2層置く。`MeshBasicMaterial.onBeforeCompile`で頂点を投影した後に、view-space normalのxy方向へ設定した画素幅を加える。既存のシェーダーチャンク（スキニング、モーフ等）は残す。

発光幅は3DGSと共通の`projectedObjectHeightPixels`と`speechScreenGlowRadius`で計算。描画先の高さ、カメラ投影、オブジェクトのworld行列を更新してから、各ビューの`onBeforeRender`でuniformを決める。世界のメッシュ自体は標準レイヤーに残し、発光シェルだけ`DISPLAY_LAYER=1`で描画する。世界の深度・法線・シャドウと独立し、机などの不透明物によって遮蔽される。

## 不変条件と制約

- 元GLBの形状とマテリアル・テクスチャ・サーバー保存を変更しない。stale時に必要な透明度変更は退場・再配置・破棄時に戻す。
- シェルのジオメトリ・スキニング・インスタンスデータは元Meshが所有する。破棄時はシェル材質のみ解放する。
- 本体の通常マテリアル・物理的な影・SSRの深度と法線は元のまま。発光層そのものはSSRへ映り込まない。
- 追加シェルは元Mesh1個につき2層。大量のMeshを含むGLBでは描画負荷が増える。
- 薄い板、透過テクスチャのマスク、複雑な二重面では完璧な外周を保証しない。キャラクターGLBで実GPU・OBS検証が必要。

確認内容と再実行手順は[メッシュ発話グロー](../mesh-avatar-speech.md)に記載する。
