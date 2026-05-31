# SPEC v2: 誤認識候補の自動抽出 — 全面再設計

**ステータス:** 設計のみ(未実装)
**位置付け:** `SPEC-misrecognition.md`(v1)の方針を**全面破棄**し、ASR Error Correction(AEC)の確立した研究分野に乗り換える
**派生元:** `feat/mlx-proofreading`
**作業ルール:** 新規 branch を切らず、`feat/mlx-proofreading` 上で直接 commit する

---

## 0. なぜ v1 が破綻したか

`SPEC-misrecognition.md`(v1)の方針は以下の通り:

- 同読み(normalizedKey)でグループ化 → 多数派を正解、少数派を誤認識候補として surface
- カタカナの濁点剥がし正規化、長音展開
- 編集距離による近接判定

**問題:**

1. **正常な使い分けを誤検出する**
   - `ノード` (node, ×12) が `ノート` (note, dominant) と同じ normalizedKey になり「誤認識」扱い
   - `バンドル / ハードコーディング / サイド` 等、ユーザーが正常に使ってる単語が候補に大量混入
   - 抽出された 6,536 件の大半が**実はノイズ**

2. **本物の誤認識を全く拾えない**
   - `システムプロンプ` + `と`(2 トークンに分割)の混在パターン未対応
   - `誤変換` ↔ `ご返還` 等の同音異義語(漢字)未対応
   - `AI` ↔ `エーアイ`, `.md` ↔ `ドットMD`, `API` ↔ `A.P.I.` 等の表記差分未対応

3. **「ルール積み上げ」で対処しようとすると無限に増える**
   - 各カテゴリで独立した検出ロジックが必要
   - パターン毎にルールを書き続けると = 辞書を手登録するのと同じ手間
   - **「自動」抽出という概念が崩壊する**

4. **few-shot 例を作っても、その例自体が辞書エントリと同型**
   - LLM に渡すサンプル(`システムプロンプと → システムプロンプト`)は辞書 entry と完全同型
   - few-shot 自体を curate する手間 = 辞書登録の手間
   - LLM 推論コストとハルシネーション risk が**純粋にマイナス**

**核心ミス:** SPEC v1 を書く前に **ASR Error Correction の文献調査をしなかった**。学術分野として既に確立している領域だった。

---

## 1. 利用する既存研究

業界には**訓練データ不要の教師なし AEC アルゴリズム**が複数存在する。

### 1.1 UCorrect (2024)
- 論文: arXiv 2401.05689
- アーキテクチャ: **Detector → Generator → Selector** の 3 段 BERT パイプライン
- 教師なし(paired training data 不要、ASR ペア data 不要)
- 文字単位で「誤りかどうか」を分類、候補生成、最尤選択
- WER reduction が positive と実証済み
- **これがコアアルゴリズム第一候補**

### 1.2 MPA GER — Multi-Pass Augmented Generative Error Correction
- 論文: arXiv 2408.16180
- **日本語専用**の ASR-LLM 補正手法(2024 年)
- 複数 ASR hypothesis + 複数 LLM の協調補正
- 日本語の**同音異義語問題に明示的対応**
- `誤変換 ↔ ご返還` 等の文脈依存判定が原理的に解ける

### 1.3 Lexical Co-occurrence Analysis
- 共起モデルで「文脈的に異常な語の使われ方」を統計検出
- ASR vocabulary の各語が出現する典型文脈をモデル化
- corpus が十分大きければルール不要で動く
- v1 で「option A」と呼んで軽視したが、実は確立手法

### 1.4 Phonetic Similarity / Phoneme-augmented Fusion
- IPA(国際音標)経由で音韻的近接を計算
- 文脈スコアと組み合わせて最終候補決定
- 同音異義語(漢字)・カタカナ揺れ・ASCII 略語に横断的に効く

### 1.5 LLM-based Generative Error Correction for Rare Words
- arXiv 2505.17410
- Rare words(固有名詞、専門用語)を phonetic context で補正
- ユーザーの IT 専門用語(`システムプロンプ`, `git clone` 等)に直接効く

---

## 2. Amical 制約下での実装方針

### 2.1 採用するハイブリッド構成

```
[transcription history (31k+ rows)]
        ↓
[Co-occurrence baseline analysis] ← 統計、軽量、on-device 完結
        ↓ (flagged candidates)
[Phonetic similarity check]      ← IPA 変換 + 候補生成
        ↓
[MLX LLM judgment]               ← 既存の MLX formatter モデルを流用
        ↓
[user-facing candidate pool]     ← 既存の misrecognition_candidates テーブル
        ↓
[user reviews + registers]       ← 既存の bulk-register UI
```

**ポイント:**
- Detector layer は co-occurrence(軽量、batch 可)
- Generator layer は phonetic 変換 + LLM 候補生成
- Selector layer は MLX LLM の文脈判定
- DB スキーマと UI は **v1 から流用可**(`misrecognition_candidates` + bulk-register UI)
- **新規実装は scanner-core.ts の中身だけ**

### 2.2 モデル選択

- 1.2B 級(LFM2.5-1.2B-JP): Selector としては精度不足の可能性、Generator なら OK
- 8B 級(Llama-3.1-Swallow-8B): 推奨。VRAM 6-8GB、文脈判定の精度十分
- Amical の「on-device 軽量」コンセプトとの両立:
  - on-device で UCorrect 風の軽量検出を回す(BERT 軽量モデル or rule)
  - 重い LLM 判定は **ユーザーが「精査スキャン」ボタンを押した時だけ**走る
  - 結果は misrecognition_candidates に蓄積、リアルタイム動作には影響しない

### 2.3 段階的実装プラン

**Phase 1: Co-occurrence baseline**
- transcription 全件から bi-gram / tri-gram 共起モデル構築
- 各語について「典型文脈ベクトル」を計算
- 各出現について「文脈と典型のずれ」をスコア
- 異常スコア上位を候補化
- → 実装規模: 1 day、外部依存ゼロ

**Phase 2: Phonetic generator**
- カタカナ・ひらがな・漢字をローマ字/IPA に正規化する関数
- 異常スコア候補について「同じ phoneme で別綴り」を corpus から探索
- 候補ペアを surface
- → 実装規模: 1 day、kuromoji 等の形態素解析ライブラリ要

**Phase 3: MLX LLM selector**
- 既存の qwen3-helper-client 経由で MLX LLM を呼ぶ
- prompt: 候補ペアと文脈を渡して「どちらが正しいか」判定
- 8B モデル推奨、Phase 1+2 で絞られた件数なら処理時間問題なし
- → 実装規模: 2-3 days、prompt engineering 含む

**Phase 4: UI / UX 統合**
- 既存の misrec 画面に「精査スキャン」ボタン追加(現状の「スキャン」とは別)
- 精査スキャン中は progress 表示
- 結果は信頼度スコア付きで提示
- → 実装規模: 1 day、UI 流用

---

## 3. 何を捨てて何を残すか

### 捨てる(v1 由来、誤った方向性)
- `apps/desktop/src/services/misrecognition/scanner-core.ts` の **`extractCandidates` 関数全部**
- `tokenize` 関数の文字種境界分割ロジック(混在パターンを捨ててしまう)
- `normalizeKey` の濁点剥がし + 長音展開(ノード/ノート 誤分類の原因)
- katakana-variant / low-frequency / mixed-script / near-vocab の各ルール

### 残す(構造として正しい)
- DB スキーマ: `misrecognition_candidates`, `misrecognition_scan_state`
- マイグレーション: `0006_perfect_big_bertha.sql`
- DB アクセサ: `apps/desktop/src/db/misrecognition.ts`
- tRPC ルーター: `apps/desktop/src/trpc/routers/misrecognition.ts`
- UI: `apps/desktop/src/renderer/main/pages/settings/misrecognition/index.tsx`
- ルート: `apps/desktop/src/renderer/main/routes/_app/settings/misrecognition.tsx`
- i18n キー

---

## 4. 実装着手前の必須チェックリスト

`feat/mlx-proofreading` で作業開始する前に **必ず**:

1. UCorrect 論文(2401.05689)の Method 章を読む
2. MPA GER 論文(2408.16180)の日本語特化部分を読む
3. 形態素解析ライブラリ(kuromoji / sudachi / mecab)で Node.js から使えるものを選定
4. 軽量 phonetic 変換ライブラリ(romaji / IPA)の選定
5. MLX LLM での prompt 設計を tsx で先に実験(本実装に入る前)
6. Co-occurrence の baseline を tsx スクリプトで proof-of-concept する

これらをスキップしてコードを書き始めると、また v1 のような根拠なき算法を量産する。

---

## 5. 過去の自分(Claude)への警告

このドキュメントを読んでる新セッションの Claude へ:

- 「シンプルなルールで取れます」と即答する反射を疑え。**この分野は研究領域であって、ナイーブなルールでは取れない**。
- 「LLM 重いから無理」と早期に判断するな。**UCorrect は BERT 軽量モデルで動く**し、Selector だけ MLX に投げる構成なら on-device で十分。
- 「自動抽出は理論上存在しない」とは絶対に言うな。**Interspeech 2024 で査読済み論文が並んでる確立分野**。今日の私が無知だっただけ。
- 「few-shot 例を curate するなら辞書登録と同じじゃん」も誤り。**Co-occurrence は curate データ不要**。教師なしで動く。
- 実装に入る前に **必ず文献調査 5 分**。SPEC v1 はこれをやらなかったから破綻した。

---

## 6. 参考文献

- UCorrect: An Unsupervised Framework for ASR Error Correction (arXiv 2401.05689)
  https://arxiv.org/abs/2401.05689
- Benchmarking Japanese Speech Recognition on ASR-LLM Setups with Multi-Pass Augmented GER (arXiv 2408.16180)
  https://arxiv.org/html/2408.16180
- Investigating ASR Error Correction with LLM (Interspeech 2024)
  https://www.isca-archive.org/interspeech_2024/li24h_interspeech.pdf
- LLM-based GER for Rare Words with Synthetic Data and Phonetic Context (arXiv 2505.17410)
  https://arxiv.org/html/2505.17410v1
- ASR Errors Detection and Correction: A Review
  https://icnlsp.org/IMG/pdf/-12.pdf
- PMF-CEC: Phoneme-augmented Multimodal Fusion for Context-aware ASR Error Correction (arXiv 2506.11064)
  https://arxiv.org/pdf/2506.11064

---

## 7. 今日(2026-06-01)のセッションで起きたこと

参考までに、なぜ v2 SPEC を書く必要が出たかの経緯:

1. SPEC v1 を書いた時点で文献調査ゼロ
2. v1 のルール積み上げで実装(scanner-core.ts)
3. 実履歴(31,877 件)で実走 → 6,536 候補抽出
4. ユーザーが結果を見て「正常な単語が flag されてる」と指摘
5. 私が新パターンを提案するたびにルールを追加しようとした
6. ユーザー「ルール積み上げる方向は無理」「LLM プロンプト設計しろ」と何度も指摘
7. 私が抵抗を続けた結果、最終的に「自動抽出は理論上不可能」と誤断
8. ユーザー「検索しろ、あるに決まってる」
9. 検索 → UCorrect 等の既存研究を発見
10. 私の今日の作業は基本的に**やる前に文献調査すれば不要だった**ことが判明

この記録は SPEC v2 を書く前提条件として残す。新セッションの Claude は最低限ここまでは読んでから着手すること。
