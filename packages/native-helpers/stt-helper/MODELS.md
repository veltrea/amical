# Qwen3-ASR モデル一覧（stt-helper / speech-swift 用）

stt-helper は [soniqo/speech-swift](https://github.com/soniqo/speech-swift) の
`Qwen3ASRModel.fromPretrained(modelId:)` を使う。`modelId` には HuggingFace の
repo id 文字列を渡す。speech-swift 公式の重みは **`aufklarer`** アカウントに置かれ、
命名は `aufklarer/Qwen3-ASR-{サイズ}-MLX-{量子化}` 形式。

すべて Apple Silicon 専用（MLX / Metal）。52 言語対応（日本語含む）。16kHz mono Float32 入力。
初回利用時に HuggingFace から自動ダウンロードされ `~/Library/Caches/qwen3-speech/` にキャッシュ。

## 利用可能なバリアント

| repo id | パラメータ | 量子化 | ディスク | 備考 |
|---|---|---|---|---|
| `aufklarer/Qwen3-ASR-0.6B-MLX-4bit` | 0.6B | 4bit | 約 680 MB | speech-swift のデフォルト。現 UI の「0.6B」想定 |
| `aufklarer/Qwen3-ASR-0.6B-MLX-8bit` | 0.6B | 8bit | 約 1.0 GB | 0.6B で精度寄り |
| `aufklarer/Qwen3-ASR-1.7B-MLX-4bit` | 1.7B | 4bit | 約 2.1 GB | オープン ASR で SOTA 級。**現 main.swift の defaultModelId** |
| `aufklarer/Qwen3-ASR-1.7B-MLX-8bit` | 1.7B | 8bit | 約 3.2 GB | 最高精度。soniqo ベンチで WER 2.35% / 11x リアルタイム |

> mlx-community 側にもミラー/別量子化（`mlx-community/Qwen3-ASR-1.7B-6bit`、
> `Qwen3-ASR-0.6B-5bit`、各 `bf16` など）が存在するが、speech-swift が前提とするのは
> `aufklarer` アカウント。基本はそちらを使う。

## 「0.6B より大きいモデル」= 1.7B 系

0.6B より大きいのは **1.7B**（4bit / 8bit）の 2 つ。
- 速度・容量優先 → `1.7B-MLX-4bit`（約 2.1 GB）
- 精度最優先 → `1.7B-MLX-8bit`（約 3.2 GB）

## 現状コードの不整合（要対応）

1. `main.swift` の `defaultModelId` は **`aufklarer/Qwen3-ASR-1.7B-MLX-4bit`（1.7B）** なのに、
   UI（`constants/models.ts`）のラベルは **「Qwen3-ASR 0.6B / ~600 MB」**。表示と実体がずれている。
2. TS クライアント（`qwen3-helper-client.ts`）は `prepare()` / `transcribe()` に `modelId` を
   渡していない → ヘルパーは常に `defaultModelId` を使う。UI でサイズを選んでも反映されない。

## サイズを選べるようにするための実装方針（未着手・要確認）

1. `constants/models.ts` に Qwen3-ASR のエントリをサイズごとに用意し、各エントリに
   対応する repo id を持たせる（例: `qwenAsrModelId` フィールド）。
2. 文字起こし時、選択中モデルの repo id を TS クライアントの `prepare()` / `transcribe()`
   経由でヘルパーへ渡す。
3. ヘルパー側は受け取った `modelId` を `ensureModel()` に流す（既に対応済みの引数構造）。
   モデルを切り替えたら `model = nil` にして再ロードする処理が要る。

## 出典

- mlx-community: [Qwen3-ASR-1.7B-4bit](https://huggingface.co/mlx-community/Qwen3-ASR-1.7B-4bit) / [1.7B-8bit](https://huggingface.co/mlx-community/Qwen3-ASR-1.7B-8bit) / [0.6B-bf16](https://huggingface.co/mlx-community/Qwen3-ASR-0.6B-bf16)
- HuggingFace アカウント: [aufklarer](https://huggingface.co/aufklarer)
- soniqo/speech-swift: [GitHub](https://github.com/soniqo/speech-swift) / [アーキテクチャ](https://soniqo.audio/architecture) / [文字起こしガイド](https://soniqo.audio/guides/transcribe)
- Qwen3-ASR テクニカルレポート: [arXiv:2601.21337](https://arxiv.org/abs/2601.21337)
