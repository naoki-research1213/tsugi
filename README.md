# ツギ

タスクと時間を並べると、音声と色で順番に案内するルーティンタイマー（PWA）。

- 公開ファイルは `docs/`、ソースは `src/app.html`
- `python3 build.py` で `docs/` を再生成する（要 fonttools, brotli, pillow）
- GitHub Pages版のデータは端末内の localStorage に保存する
- 数字のフォントは Fredoka（SIL OFL、`fonts/FREDOKA-LICENSE.txt`）

## GPT連携・同期版

本人専用のSitesアプリ。既存の画面を引き継ぎ、D1に予定・ルーティン・実行中タイマー・完了記録を保存する。同じChatGPTアカウントでログインした端末間で、表示中は約5秒ごとに同期する。API利用料やOpenAI APIキーは不要。

- `node scripts/build.mjs`: 既存の数字フォント・アイコンと画面を含むWorkerを `dist/server/index.js` に生成。Python依存は不要。
- `node --test tests/*.test.mjs`: サーバーと独立クライアントの同期・競合・完了確認を検証。
- `node scripts/preview.mjs`: ビルド後のローカル確認（Node 22のSQLiteを使用）。`127.0.0.1:4173` のみ。認証は本番Sitesが担当する。
- `.openai/hosting.json`: SitesのプロジェクトとD1 binding。`drizzle/` に本番DBのマイグレーション。
- `POST /mcp`: `get_day`, `write_day`, `get_routines`, `add_routines`, `get_completion`。
- `/openapi.json`: カスタムGPT Actions用定義。接続手順とGPT向け指示は `integrations/GPT-INSTRUCTIONS.md`。

端末の変更はlocalStorageにキューとして残し、オンライン復帰後に送信する。revisionによる楽観ロックで古い端末からの上書きを拒否し、競合時はどちらの変更を採用するか選べる。タイマーは最後に操作した画面が更新を担当し、他の画面は追従する。再開・一時停止などの操作で担当を引き継ぐ。

タイマー終了は `timer_finished`。終了画面の「完了を記録して戻る」を押すと `done` になる。中断は `stopped`。GPTは時間経過と本人の完了確認を区別して読み取る。

本番は**owner-private専用**。Sitesの認証境界で保護する単一所有者のデータモデルのため、アクセス範囲を公開・共有に拡大する際は所有者別データ分離を先に追加する。旧GitHub PagesとSitesは別オリジンであり、旧ブラウザー内データは自動移行されない。既存の `tsugi-data` も別のデータソースとして残る。
