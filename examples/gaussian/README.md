# 3DGSサンプル

このディレクトリーの `manifest.json` は合成キャラクター1の記述例です。manifestだけではインポートできません。対応するPLYとGLBを含むZIPは次のコマンドで生成します。

```sh
bun run fixtures:gaussian
```

生成先は `.generated/gaussian-fixtures/` です。`character-01.entaku.zip`〜`character-08.entaku.zip` と、件数・色・SHA-256を記録した `fixtures.json` を出力します。Windows配布ZIPでは同じ素材を `examples/gaussian/` に収録します。

8個のキャラクターは色、寸法、点の位置、splat数が異なります。splat数は順に384、448、512、576、640、704、768、832です。各ZIPに3DGS PLY、顔と体を箱で表した自己完結GLB、manifestを含めます。

素材は [tests/helpers/gaussian.ts](../../tests/helpers/gaussian.ts) で再現可能な合成データとして生成し、CC0-1.0で提供します。実在人物のスキャンや利用者データは含みません。これらは少数splatの機能確認用で、実際のスキャンキャラクターの性能や画質を代表する素材ではありません。

パッケージのフィールドと制限は [パッケージ仕様](../../docs/gaussian-package.md)、Dockの操作は [利用手順](../../docs/gaussian-avatars.md) を参照してください。
