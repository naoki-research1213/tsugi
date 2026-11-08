# ツギ

タスクと時間を並べると、音声と色で順番に案内するルーティンタイマー（PWA）。

- 公開ファイルは `docs/`、ソースは `src/app.html`
- `python3 build.py` で `docs/` を再生成する（要 fonttools, brotli, pillow）
- データは端末内の localStorage にのみ保存する
- 数字のフォントは Fredoka（SIL OFL、`fonts/FREDOKA-LICENSE.txt`）
