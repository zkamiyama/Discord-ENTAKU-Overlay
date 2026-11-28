# ADR 0031: カードを各ビューの画面と平行にする

日付: 2026-11-28 JST

状態: `feat/misskey-hashtag-cards`で実装。[ADR 0030](0030-tilted-cards-and-phrase-moderation.md)の姿勢の判断を置き換える。共有PlaneGeometry、配置、資源の上限、受信と審査の規則は継続する。

## 課題

全景の司会側の奥で、カードの斜めの輪郭が目立つ。利用者はZだけでなく、小さなX/Yの傾きも不要としている。今回はカードの文字と輪郭を整列させ、空間内の配置と穏やかな上下動で浮遊感を出す。

装飾角をゼロにするだけでは、この要件を満たさない。カードごとの位置からカメラの位置へ向ける`lookAt`は、画面中央と端で異なる向きを作る。画面端に置いた面は画面と平行にならず、投影した辺が斜めになる。

## 決定

Three.js 0.187.0の標準`Mesh`と共有`PlaneGeometry(1,1)`を維持し、各drawでカードの面を画面と平行にする。XYZの装飾回転、回転の揺れ、カードごとの位置への`lookAt`を取り除く。

`Object3D.onBeforeRender`が受け取る実際のカメラに対し、`getWorldQuaternion`でworld回転を取得する。この回転、空間内の中心、既存の大きさから`Matrix4.compose`でカードのworld matrixを作る。cameraのlocal quaternionだけをコピーしないため、親を持つカメラにも対応する。

カメラのrollも含めて面を揃える。ここでゼロにするのは画面に対する装飾の傾きであり、カードのworld回転そのものではない。ビュー空間では面の四隅の奥行きが同じになり、投影した上下の辺は水平、左右の辺は垂直になる。SPLITの左右はそれぞれのカメラから求め、前の描画の姿勢を入力に使わない。

親の逆world matrixと完成したworld matrixの積を、そのままlocal matrixとして保持する。これをposition・quaternion・scaleへ再分解しない。非一様scaleのstageを打ち消すためのshearを失わないためである。対象はENTAKUの通常カメラとstage変換であり、反射や任意のshearを含むcamera rig全般の保証にはしない。

中心位置、10方向×3段の配置、距離による見かけの大きさ、近側の抑制、上下動、出入りのフェードは継続する。面の向きはビューごとに変わるので、複数カメラが同じ固定姿勢の板を撮る方式ではない。

### 描画順と資源

r187では視錐台カリングと透明物体のソートが`onBeforeRender`より前、`modelViewMatrix`の計算が後に行われる。既存の`frustumCulled=false`と、`prepare`でソート用の中心を先に更新する処理を維持する。hookでは中心を動かさず、完成した`matrixWorld`を同じdrawへ渡す。

共有geometryは1個、カードは最大30枚、1枚は2三角形と512×256のCanvasTextureである。姿勢の更新でCanvasを描き直さず、追加のgeometry・material・textureを作らない。`FrontSide`、`depthTest=true`、`depthWrite=false`、`renderOrder=-1`、display layer 1も維持する。

## 比較した代替案

| 案 | 判断 |
|---|---|
| 装飾角だけゼロにしてlookAtを残す | 画面端で面が斜めになるため採用しない |
| worldのXYZ回転をゼロに固定する | カメラが回ると端や裏を向く。画面内の整列を保てない |
| main cameraの回転だけを使う | SPLITのもう一方の画面で整列しない |
| Spriteへ戻す | 標準shaderで画面に平行にできるが、利用者が選んだ平面メッシュを維持する。姿勢の計算だけを標準APIへ簡略化できる |
| 専用shaderやInstancedMeshを導入する | 今回の姿勢は標準のworld回転と行列合成で扱える。描画方式の追加は不要 |

## 検証

単体試験とWebGL試験で、中央だけでなく画面端へカードを移す構図を含める。カメラの姿勢を実際に変えるため、装飾角を消して`lookAt`を残す実装も検出できる。ビュー空間の基底、四隅の深度差、投影した辺の水平・垂直、中心位置を検査する。

連続したカメラ移動、同じ位置でのroll変更、SPLITのAB/BA描画順、通常表示への復帰、親を持つカメラ、非一様scaleのstageも扱う。WebGLでは実際に描画した画素と、左右の順序を変えたときの各画面の一致を確認する。時間だけを進めた試験では、上下動は続く一方、姿勢は揺れないことを確認する。

描画の記録は[姿勢の測定](../measurements/misskey-upright-views.json)と[負荷の測定](../measurements/misskey-upright.json)に保存する。実Overlayの全景・SPLITと3DGS人物との描画順序も確認する。SwiftShaderの測定を実GPUやOBS/CEFの性能保証として扱わない。

## 公式資料

- [r187 Object3D](https://github.com/mrdoob/three.js/blob/r187/src/core/Object3D.js): `getWorldQuaternion`、`updateWorldMatrix`、`lookAt`。
- [r187 Camera](https://github.com/mrdoob/three.js/blob/r187/src/cameras/Camera.js): world回転とview matrix、scaleの除外。
- [r187 Matrix4](https://github.com/mrdoob/three.js/blob/r187/src/math/Matrix4.js): `compose`と、非一様scaleを含む行列の`decompose`の制約。
- [r187 WebGLRenderer](https://github.com/mrdoob/three.js/blob/r187/src/renderers/WebGLRenderer.js): culling、ソート、objectのhook、modelViewMatrix計算の順序。
- [r187 PlaneGeometry](https://github.com/mrdoob/three.js/blob/r187/src/geometries/PlaneGeometry.js)と[標準Sprite shader](https://github.com/mrdoob/three.js/blob/r187/src/renderers/shaders/ShaderLib/sprite.glsl.js): XY平面のメッシュとview空間で展開するSpriteの違い。
