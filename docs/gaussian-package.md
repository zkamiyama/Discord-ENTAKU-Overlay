# 3DGSキャラクターパッケージ仕様

ENTAKUの3DGSキャラクターは、`manifest.json` と素材をまとめた1個のZIPで持ち運びます。manifestにはキャラクターの座標、顔、体、画角の範囲を保存します。Discordの参加者IDは含めず、参加者への割り当てはローカルの `avatars.json` に保存します。

この文書は現在のインポーター、保存処理、座標変換の仕様です。Dockでの操作は [3DGSアバターの利用手順](gaussian-avatars.md) を参照してください。描画や実機の検証結果とは区別して扱ってください。

## ZIPの構成

ZIPの直下に `manifest.json` が必要です。素材は下位ディレクトリに置けます。外側にフォルダーを1つ付けたZIPは受け付けません。

| ZIP内のパス例 | 必須 | 内容 |
| --- | --- | --- |
| `manifest.json` | 必須 | UTF-8のキャラクター定義 |
| `avatar.spz` または `avatar.ply` | 必須 | manifestの `splat` が参照する3DGS素材1個 |
| `proxy.glb` | 任意 | manifestの `proxy` が参照する代理メッシュ |
| `preview.png` | 任意 | manifestの `preview` が参照する静止PNG |
| `textures/skin.png`、`buffers/body.bin` など | 参照時は必須 | GLBから参照する外部画像・バッファ |

manifestやGLBから参照されないファイルは拒否します。README、OSの管理ファイル、別キャラクターの素材などはZIPに入れません。配布用の説明文はZIPの外に置きます。

保存処理は [gaussian-store.ts](../src/assets/gaussian-store.ts) にあります。

## manifestの完全な例

次の例は配布サンプル `character-01.entaku.zip` のmanifestと一致します。[JSONファイル](../examples/gaussian/manifest.json)も参照できます。対応する `avatar.ply` と `proxy.glb` をZIPに含めてください。任意の `preview` と `placement` は省略しています。代理メッシュやプレビューがない場合は、該当キー自体を省略します。`null` は指定しません。

```json
{
  "schemaVersion": 1,
  "kind": "entaku-gaussian-avatar",
  "name": "合成キャラクター 1",
  "splat": "avatar.ply",
  "proxy": "proxy.glb",
  "coordinates": {
    "units": "m",
    "up": "+Y",
    "forward": "+Z"
  },
  "normalization": {
    "scale": 1,
    "rotation": [0, 0, 0],
    "translation": [0, 0, 0]
  },
  "faceAnchor": [0, 1.35, 0],
  "faceBounds": {
    "min": [-0.3, 1.05, -0.29],
    "max": [0.3, 1.65, 0.29]
  },
  "bodyBounds": {
    "min": [-0.38, -0.06, -0.29],
    "max": [0.38, 1.65, 0.29]
  },
  "framingBounds": {
    "min": [-0.38, -0.06, -0.29],
    "max": [0.38, 1.65, 0.29]
  }
}
```

合成サンプルの範囲は、PLY内の点中心だけでなくGaussianの広がりも含めています。

### キーと値

数値はすべて有限値です。配列の要素数は固定で、manifestと各オブジェクトに未定義のキーは追加できません。`userId`、`assetId`、アニメーション定義もmanifestには入りません。

| キー | 型・条件 |
| --- | --- |
| `schemaVersion` | 数値の `1` |
| `kind` | 文字列の `"entaku-gaussian-avatar"` |
| `name` | 空白だけではない文字列。JavaScriptの文字列長で80以内。制御文字不可。保存時に両端の空白を除去 |
| `splat` | ZIP内の `.spz` または `.ply` の相対パス |
| `proxy` | 任意。ZIP内の `.glb` の相対パス |
| `preview` | 任意。ZIP内の `.png` の相対パス |
| `coordinates.units` | `"m"`、`"cm"`、`"mm"` |
| `coordinates.up` / `forward` | `"+X"`、`"-X"`、`"+Y"`、`"-Y"`、`"+Z"`、`"-Z"`。異なる軸を指定。同じ軸の符号違いも不可 |
| `normalization.scale` | 一様倍率。`0.000001`〜`1000000` |
| `normalization.rotation` | `[x, y, z]` のXYZ Euler角。単位はrad。各値は `-2π`〜`2π` |
| `normalization.translation` | 正規化後の座標系での `[x, y, z]`。単位はm。各値は `-1000`〜`1000` |
| `faceAnchor` | 正規化後の顔基準点 `[x, y, z]`。単位はm。各値は `-20`〜`20` |
| 各 `Bounds.min` / `max` | 正規化後の軸に平行な箱の隅 `[x, y, z]`。単位はm。各値は `-20`〜`20` |
| `placement` | 任意。参加者へ初めて割り当てるときの倍率・位置・向き。指定する場合は5項目すべて必要 |

`splat`、`proxy`、`preview` は互いに別のファイルを参照します。`manifest.json` を素材として参照することもできません。拡張子の大文字・小文字は区別しませんが、パスと参照先の名前は一致させます。

定義と検査条件は [gaussian-profile.ts](../src/assets/gaussian-profile.ts) にあります。

## 座標と顔基準点

### 元データからの正規化

`coordinates` はSPZ/PLYと代理メッシュの元データの座標系を表します。正規化後は右手系で、単位はm、上方向は `+Y`、正面は `+Z` です。

変換は次の順で行います。

1. `up` と `forward` から元データの上・正面方向を決めます。右方向は `up × forward` です。それぞれの方向成分を正規化後のX・Y・Z成分にします。
2. `units` に応じてmへ換算し、`normalization.scale` を一様に掛けます。換算係数は `m=1`、`cm=0.01`、`mm=0.001` です。
3. `normalization.rotation` を適用します。Three.jsの `Euler` の順序 `XYZ` を使用します。
4. `normalization.translation` を加えます。平行移動の値は元データの単位にかかわらずmです。

元の点を `p`、軸変換を `A`、単位換算係数を `u` とすると、正規化後の点は次の式になります。

```text
pNormalized = translation + rotationXYZ(normalization.scale × u × A(p))
```

例えば、元データがcm単位、上が `+Z`、正面が `-Y` の場合、`[10, -20, 150]` は軸変換とm換算で `[0.1, 1.5, 0.2]` になります。さらに `normalization.scale=2`、回転がゼロ、`translation=[0, -1, 0]` なら、結果は `[0.2, 2, 0.4]` です。

### anchorと範囲の座標

`faceAnchor`、`faceBounds`、`bodyBounds`、`framingBounds` は、すべて上記の正規化を適用した後のm座標で記述します。これらに `units`、`normalization.scale`、`normalization.rotation` をもう一度適用しません。元データや正規化を変更したときは、顔や範囲もその結果に合わせて調整します。

| 項目 | 用途・条件 |
| --- | --- |
| `faceAnchor` | 席に置く顔の基準点。`faceBounds` の内側または境界上にあること |
| `faceBounds` | 顔の画角計算に使う箱。`bodyBounds` と `framingBounds` の両方に含まれること |
| `bodyBounds` | 体の大きさと席間隔の計算に使う箱。幅と奥行きはそれぞれ2.8m以内、高さは4m以内 |
| `framingBounds` | カメラの画角に収める範囲。体全体と異なる範囲も指定可能 |

どの箱も各軸で `min < max` が必要です。厚みがゼロの箱は使えません。body全体がframingに含まれる条件はありませんが、顔は両方に含まれます。

範囲は作者が指定する値です。インポーターは箱の値と相互関係を検査しますが、元データのすべてのsplatが箱に含まれるかは検査しません。カメラに収めたい髪や衣装も含めて調整してください。

### 席への配置

描画時は正規化後の `faceAnchor` を原点に移し、参加者プロフィールの `scale` と `yawRad` を適用します。その後、席の向きと位置、参加者ごとのoffsetを適用します。

```text
pLocal = rotationY(yawRad) × scale × (pNormalized - faceAnchor)
```

offsetのXは席の右方向、Yは上方向、Zは席の正面方向です。世界座標で固定された左右・前後ではありません。SPZ/PLYと代理メッシュに同じ変換を適用し、カメラの向きによるビルボード回転は行いません。

座標変換は [transform.ts](../src/web/gaussian/transform.ts)、カメラへの反映は [camera-context.ts](../src/domain/camera-context.ts) にあります。

## 配置の持ち運び

`placement` は作者が設定した倍率、位置、向きを別環境へ渡すための任意項目です。Dockで素材を新しく選ぶと、ここから参加者プロフィールを初期化します。省略時は `scale=1`、offsetとyawはすべて `0` です。

| `placement` の項目 | 条件 |
| --- | --- |
| `scale` | `0.25`〜`3` |
| `offsetX` / `offsetY` / `offsetZ` | それぞれ `-0.5`〜`0.5` m |
| `yawRad` | `-2π`〜`2π` rad |

参加者へ保存する際には、倍率・yaw・offsetを反映した体の範囲も検査します。横位置の余白を含む幅は2.8m以内、体の高さは4m以内で、基準の顔高さ1.25mと縦offsetを加えた頭上端は3m以内です。manifestの数値が有効でも、この配置条件を超える割り当ては拒否します。

Dockの書き出しは編集したmanifestと現在の参加者配置を `placement` に入れてZIPに保存します。元のSPZ/PLYやGLBへ変換を焼き込まないため、再インポート後に正規化や倍率を二重適用しません。書き出したZIPには参加者ID、席番号、カメラ設定、スタジオ設定は入りません。

参加者プロフィールには `kind:"gaussian"`、`userId`、`assetId`、`manifest`、`scale`、`offsetX`、`offsetY`、`offsetZ`、`yawRad` を保存します。プロフィール側の値が描画に使われ、manifestの `placement` は初期値です。プロフィールの `offsetZ` と `yawRad` を省略した場合は保存時に `0` を補います。

## SPZとPLY

1素材の元データは1〜1,000,000 splatです。形式はファイル名の拡張子で選び、内容も検査します。一般のRGB点群を `.ply` に変更しただけでは取り込めません。

| 形式 | 受け付ける内容 |
| --- | --- |
| SPZ v1 | gzip内の `NGSP`。16byteヘッダー、float16座標 |
| SPZ v2 | gzip内の `NGSP`。16byteヘッダー、24bit座標 |
| SPZ v3 | gzip内の `NGSP`。16byteヘッダー、24bit座標、4byte回転 |
| SPZ v4 | gzipで包まない `NGSP`。32byteヘッダー、TOCとZSTD圧縮ストリーム |
| 3DGS PLY | PLY 1.0の `ascii` または `binary_little_endian` |

### SPZの制限

SPZはSH次数 `0`〜`3`、fractional bitsは `24` 以下を受け付けます。flagsはbit 0だけを許可します。既成LoDを表すbit `0x80` や、それ以外の未対応拡張は `GAUSSIAN_SPZ_EXTENSION_UNSUPPORTED` になります。描画用LoDは読み込み時にSparkで生成します。

gzipの展開結果は128MiB以下です。v4のストリーム数は1〜16で、TOCのサイズ、圧縮データの範囲、展開後の実サイズを検査します。全バージョンで、splat数・SH次数・バージョンから算出した必要データ長と実際の長さが一致する必要があります。展開後のデータに不足や余剰があれば拒否します。

座標は有限値で、各成分の絶対値は元データの単位で `1000000` 以下です。SPZの別バージョン、未知のpacking拡張、`.splat` や `.rad` などの別形式は、このインポーターの対象外です。

### PLYの制限

PLYのvertexには次の属性がすべて必要です。

```text
x y z
f_dc_0 f_dc_1 f_dc_2
opacity
scale_0 scale_1 scale_2
rot_0 rot_1 rot_2 rot_3
```

ヘッダーは64KiB以内、vertex属性は128個以内です。属性にはスカラー数値型を使います。vertexのlist型、big endian形式、複数のvertex要素、件数がゼロでない他の要素は受け付けません。頂点の行数・列数またはバイナリ長はヘッダーと一致させます。

全属性は有限値で、`x`、`y`、`z` の絶対値は `1000000` 以下、`scale_0`〜`scale_2` の絶対値は `30` 以下です。回転の4成分のノルムは `1e-12` 以上が必要です。ここでのscale属性は3DGS素材内の値で、manifestの `normalization.scale` とは別です。

形式検査は [gaussian-format.ts](../src/assets/gaussian-format.ts) にあります。

### 単体ファイルの取り込み

ZIPを使わずSPZ/PLYを取り込むと、インポーターが編集用のmanifestを作ります。初期値はm単位、上が `+Y`、正面が `+Z` です。検出した点の範囲から倍率・中心位置・顔の仮の範囲を設定します。

この処理は顔検出ではありません。元データの軸や単位は自動判定しないため、プレビューで正面、寸法、顔位置を調整してください。点の広がりがゼロの軸は仮の範囲を広げ、編集可能な箱を作ります。

## 代理メッシュと依存ファイル

`proxy` は任意のGLBです。形状による深度・法線などの描画処理に使用します。GLB内のノード変換を反映したモデルが、SPZ/PLYと同じ元座標・単位で重なるように作成します。両方に同じ正規化と参加者配置を適用するため、GLBだけ別の正規化値を指定する項目はありません。

サーバーはglTF 2.0のGLBを受け付けます。GLB本体は32MiB以下で、JSONはJavaScriptの文字列長で `4 × 1024 × 1024` 以下です。バッファや画像をGLB内に埋め込むか、ZIP内の相対パスで参照します。次の参照は有効です。

| GLBのパス | GLB内のURI | ZIP内の依存ファイル |
| --- | --- | --- |
| `proxy/body.glb` | `../textures/skin.png` | `textures/skin.png` |
| `proxy/body.glb` | `buffers/body.bin` | `proxy/buffers/body.bin` |

相対URIの `..` はZIPの内側に解決できる場合に限り使用できます。ZIPの外への移動、絶対パス、HTTPなどの外部URL、query、fragment、バックスラッシュは拒否します。PNG/JPEG/WebP/AVIF/KTX2画像とoctet-stream/gltf-bufferのbase64 data URIも受け付けます。

ZIPで受け付ける拡張子は `json`、`spz`、`ply`、`glb`、`bin`、`png`、`jpg`、`jpeg`、`webp`、`avif`、`ktx2` です。拡張子が有効でも未参照ファイルは拒否します。単体SPZ/PLYのAPIに添付できるファイルは `proxy` と `preview` のみです。任意の依存ファイル一式を送る欄はないため、GLBを自己完結させるかZIPを使います。

ブラウザはThree.jsの `GLTFLoader` とDraco・KTX2・Meshoptのデコーダーで読み込みます。プロキシのメッシュ数は1〜5000、三角形数は2,000,000以下で、有限かつ空でない範囲が必要です。この形状検査はブラウザの読み込み時に行います。サーバーでのインポート成功だけではGLBの全拡張や描画成功までは確認できません。

プレビュー画像は静止PNGに限り、20MiB以下、各辺1〜4096pxです。代理メッシュのテクスチャに適用する制限とは別です。

参照解決の検査は [gltf.ts](../src/studio/gltf.ts)、ブラウザの読み込みは [assets.ts](../src/web/gaussian/assets.ts) にあります。

## パスと容量

ZIP内のファイル名は相対パスです。パス全体は256文字以内、各要素は120文字以内で、空要素、`.`、`..`、末尾の空白やドットを含めません。制御文字、`\`、`:`、`?`、`#`、および `%2e`、`%2f`、`%5c`、`%00` の符号化表記も拒否します。

容量のMiB/KiBはそれぞれ `1024 × 1024` byte、`1024` byteです。

| 対象 | 上限 |
| --- | --- |
| ZIP圧縮後 | 192MiB |
| ZIP展開後の合計 | 256MiB |
| ZIPのエントリー数 | 64。ディレクトリーも数える |
| 通常の1ファイル | 128MiB。manifest・GLB・previewには下記の個別制限も適用 |
| `manifest.json` | 64KiB |
| 代理GLB / そのJSON | 32MiB / JavaScriptの文字列長で `4 × 1024 × 1024` |
| preview PNG | 20MiB、各辺4096px |
| 1素材の元データ | 1,000,000 splat |
| 保存できるキャラクター | 128パッケージ、ファイル合計1GiB |
| 参加者プロフィール | 画像とGaussianを合わせて256件 |
| 全保存プロフィールのGaussian元データ | 合計8,000,000 splat |
| importのHTTP `Content-Length` | multipartの境界を含め193MiB |

ZIPは宣言サイズだけでなく、実際に展開したバイト数も検査します。重複パス、壊れた終端、参照の欠損、ハッシュ不一致なども拒否します。

8,000,000 splatの上限は、接続中かどうかに関係なく保存対象の全プロフィールに適用します。同じ素材を複数人に割り当てた場合も、参加者ごとに元データ数を加算します。例えば1,000,000 splatの同じ素材を8人へ割り当てると上限に達し、9人目の保存は失敗します。割り当ての変更とプリセット適用の両方で、保存前に検査します。

描画時のLoD予算はこの元データ上限とは別です。`studio.gaussian.lodSplatCount` は `1000`〜`8000000` の整数で、省略時は `500000` です。SPLITでは全体予算を左右のビューに分けます。この値を下げても、保存時の元データ合計上限は変わりません。

## 保存と失敗時の動作

各パッケージは内容から求めたSHA-256の `assetId` で保存します。ファイルは `data/assets/gaussians/<assetId>/<fileHash>` に置き、元の相対パスとハッシュの対応を `asset.json` で管理します。ZIP内の名前をそのままディスクの保存パスにしません。

全素材の検査後、一時ディレクトリーに書き込み、最後に公開用ディレクトリーへ移動します。同じ内容の再インポートは既存パッケージを再利用します。manifestは正規化したJSONとして保存されるため、入力ZIPと書き出したZIPのバイト列が同一になることは前提にしません。

参加者割り当ては素材とは別に保存します。インポートだけでは現在の割り当てを変更しません。manifestや配置を編集しても元の素材は変更せず、書き出したZIPを再インポートすると編集内容に対応した `assetId` になります。

割り当て変更は検証とファイル保存後にruntimeへ反映します。プリセット適用時も必要な素材と元データ合計を先に検査します。設定の保存失敗時は以前の設定へ戻す処理を行います。これはプロセス内の補償処理で、複数ファイルをまとめたクラッシュ復旧トランザクションではありません。補償自体の失敗は `SETTINGS_ROLLBACK_FAILED` または `PRESET_ROLLBACK_FAILED` として返します。

起動時のプロフィール読み込みは、欠損素材があっても表示側で代替表示できるよう素材の存在検査を行いません。元データ合計の検査は設定更新・プリセット適用時に行います。`avatars.json` を手で編集して上限を回避する運用には対応しません。

現在のHTTP APIにはパッケージ削除操作はなく、割り当て解除でも素材の保存容量は減りません。利用中の素材ディレクトリーを手で削除すると、その素材を参照する割り当てやプリセットが読み込めなくなります。

設定処理は [store.ts](../src/assets/store.ts) と [settings-service.ts](../src/server/settings-service.ts) にあります。

## HTTP API

サーバーは `http://127.0.0.1:<port>` で利用します。変更を伴うPOSTには同じ値の `Origin` が必要です。ポートは起動時の表示を使用します。

| メソッド・パス | 入力 | 成功時 |
| --- | --- | --- |
| `GET /api/gaussian-assets` | なし | `200`、パッケージメタデータの配列 |
| `POST /api/gaussian-assets/import` | multipart。`archive` にZIP、または `splat` にSPZ/PLY | `201`、登録したパッケージメタデータ |
| `GET /api/gaussian-assets/:id` | SHA-256のassetId | `200`、メタデータ |
| `GET /api/gaussian-assets/:id/file?path=...` | URLエンコードしたパッケージ内パス | `200`、ハッシュを検査した素材バイト列 |
| `GET /api/gaussian-assets/:id/export` | なし | `200`、登録時のmanifestを含む `application/zip` |
| `POST /api/gaussian-assets/:id/export` | JSONの `{ "manifest": ... }` | `200`、指定したmanifestを含む `application/zip` |

単体ファイルのimportには任意で `proxy`、`preview` の各Fileと、`manifest` のJSON文字列を付けられます。ZIPと単体ファイルを同時に送るとZIPを使用します。POSTによるexportでは、`splat`、`proxy`、`preview` の参照を登録済みパッケージと一致させます。exportリクエストは64KiB以内です。

メタデータは次の型です。`byteLength` は格納ファイル合計で、ZIP圧縮後のサイズではありません。

```ts
interface StoredGaussianAsset {
  schemaVersion: 1;
  assetId: string;
  manifest: GaussianAvatarManifest;
  files: Array<{
    path: string;
    hash: string;
    byteLength: number;
    mime: string;
  }>;
  byteLength: number;
  splatCount: number;
  format: 'ply' | 'spz';
}
```

参加者へ割り当てる操作は既存の `POST /api/commands` の `avatar-set` を使います。`profile` にGaussianプロフィール、`requestId` に一意なID、`expectedRevision` に現在のrevisionを指定します。割り当て解除は `avatar-reset`、プリセットの復元は `preset-apply` です。キャラクターZIPは素材を含みますが、通常の設定プリセットは素材IDへの参照を保持します。別環境へプリセットだけをコピーしても素材は移りません。

### エラー

APIはJSONの `{ "error": "コード" }` を返します。Originの拒否は `403`、容量やZIPエントリー数の超過はimportで `413`、内容や割り当ての検証失敗はPOSTで `422` です。GETで素材を取得できない場合は `404`、一覧を読み出せない場合は `500` です。revisionが競合したコマンドは `409` になります。

| 主なコード | 原因・確認箇所 |
| --- | --- |
| `GAUSSIAN_MANIFEST_MISSING` / `GAUSSIAN_MANIFEST_INVALID` | ZIP直下のmanifest、JSON、キーや必須値 |
| `GAUSSIAN_SCHEMA_UNSUPPORTED` | schemaVersionまたはkind |
| `GAUSSIAN_PATH_REJECTED` / `GAUSSIAN_DUPLICATE_PATH` | パスの禁止文字・移動・重複 |
| `GAUSSIAN_REFERENCE_MISSING` / `GAUSSIAN_REFERENCE_INVALID` | 素材の欠落、重複参照、編集時の参照先変更 |
| `GAUSSIAN_UNREFERENCED_FILE` | ZIP内の未使用ファイル |
| `GAUSSIAN_COORDINATES_INVALID` / `GAUSSIAN_TRANSFORM_INVALID` | 単位・軸・変換値 |
| `GAUSSIAN_BOUNDS_INVALID` / `GAUSSIAN_FACE_OUTSIDE_BOUNDS` | 箱の厚み、顔の包含関係 |
| `GAUSSIAN_BOUNDS_TOO_LARGE` / `AVATAR_TOO_WIDE` / `AVATAR_TOO_TALL` | 元の箱または配置後の大きさ |
| `GAUSSIAN_PLY_NOT_3DGS` | PLYに必須のGaussian属性がない |
| `GAUSSIAN_PLY_DATA_INVALID` / `GAUSSIAN_SPZ_INVALID` | データ長・値・圧縮データなどが不正 |
| `GAUSSIAN_SPZ_VERSION_UNSUPPORTED` / `GAUSSIAN_SPZ_EXTENSION_UNSUPPORTED` | 対応外のSPZバージョンまたはpacking拡張 |
| `GAUSSIAN_PROXY_INVALID` / `GAUSSIAN_PREVIEW_INVALID` | GLBまたはPNGの検査失敗 |
| `GAUSSIAN_FILE_TOO_LARGE` / `GAUSSIAN_ARCHIVE_TOO_LARGE` / `GAUSSIAN_FILE_LIMIT` | ファイル・ZIP容量または件数の超過 |
| `GAUSSIAN_SPLAT_LIMIT` | 1素材の元データ数の超過、またはSPZの件数がゼロ |
| `GAUSSIAN_ACTIVE_SPLAT_LIMIT` | 保存対象プロフィールの元データ合計が8,000,000を超過 |
| `GAUSSIAN_STORE_FULL` | 保存数または保存容量の上限 |
| `GAUSSIAN_ASSET_NOT_FOUND` / `GAUSSIAN_FILE_CORRUPT` | 登録情報やファイルの欠落・破損 |
| `AVATAR_SETTINGS_WRITE_FAILED` | 参加者設定の保存失敗 |

ルートとHTTPステータスは [assets.ts](../src/server/routes/assets.ts) と [commands.ts](../src/server/routes/commands.ts) にあります。

## 画像プロフィールとの互換性

既存の画像プロフィールは `kind` がなくても画像として読み込みます。画像の表面・裏面、`faceRect`、`framingRect`、倍率、位置を維持します。画像をGaussianとして解釈したり、Gaussianへダミーの画像寸法を付けたりしません。

`avatars.json` は従来の `schemaVersion:1` と新しい `schemaVersion:2` を読み込み、新しく保存するときは `2` を使用します。通常の設定プリセットのschemaVersionは `1` のまま、画像とGaussianのプロフィールを混在させます。旧バージョンのアプリでGaussianプロフィールを読み込む互換性は提供しません。

互換処理は [avatar-profile.ts](../src/assets/avatar-profile.ts) と [presets/schema.ts](../src/presets/schema.ts) にあります。

## テストとサンプル

パッケージ・形式・APIの自動テストは次のコマンドで実行します。

```sh
bun test tests/unit/gaussian-profile.test.ts tests/unit/gaussian-format.test.ts tests/integration/gaussian-store.test.ts tests/integration/gaussian-api.test.ts
```

合成キャラクターの生成方法と記述例は [examples/gaussian](../examples/gaussian/README.md) にあります。小さな合成素材の動作確認と、実際のキャラクター・GPU・OBS/CEFでの性能や画質確認は別に実施してください。
