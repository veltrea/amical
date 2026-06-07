# 文脈認識型 Contextual Biasing 計画

**Qwen3-ASR への、文脈・言語に応じた動的な語彙注入（特に日本語の同音異義語解消）**

作成: 2026-06-07 / 対象: `apps/desktop`（Qwen3-ASR ローカル経路）

---

## 0. 要約（TL;DR）

Qwen3-ASR は音声エンコーダ + **LLM デコーダ**構成で、system prompt に語彙・背景知識（context）を入れて認識を bias できる。amical はこの口を 2026-06-07 に配線した（[qwen3-context.ts](apps/desktop/src/pipeline/providers/transcription/qwen3-context.ts)）。

しかし現状の注入内容は **「最近追加した語 200 件 + 固定 1500 バイト予算」** という素朴なもので、

- **文脈非依存**（今書いている文書・分野を見ていない）
- **言語非依存で日本語に不利**（バイト固定予算はトークン効率の言語差を無視。同じ予算で日本語は英語の約半分の語数しか入らない）

という弱点がある。

本計画は、これを **「文脈と言語に応じて、その発話に効く語だけを動的に選抜して注入する」** 仕組みへ育てる。狙いは特に **日本語の同音異義語解消** — これは後処理の文字列置換では原理的に解けず、認識段階の context 注入だけが主役になれる領域。これは amical の「モデル非依存の堀」（[asr-differentiation-strategy](#)）の中核になる。

---

## 1. 背景と問題の構造

### 1.1 現状（実装済み）

```
辞書/手動語彙/スニペット
   └ buildContext()  (transcription-service.ts:810)
        ├ 置換系(isReplacement=true) → replacements Map → 後処理 applyTextReplacements（校正側・確定変換）
        └ ヒント系(isReplacement=false) → vocabulary[] (最大200語, selectVocabularyHintsFromMixed)
                                            └→ Qwen3: buildQwen3Context() で ", " 連結・1500B 予算 → system context  ← 今ここ
                                            └→ Whisper: initial_prompt（既存）
```

- 配線箇所: [qwen3-provider.ts](apps/desktop/src/pipeline/providers/transcription/qwen3-provider.ts) `doTranscription` → [qwen3-helper-client.ts](apps/desktop/src/pipeline/providers/transcription/qwen3-helper-client.ts) `transcribe(context)` → [main.swift](packages/native-helpers/stt-helper/Sources/stt-helper/main.swift) `RPCParams.context` → `Qwen3DecodingOptions.context`。
- **チャンク単位で `buildQwen3Context` を呼び直す構造になっている** ＝「発話の区切りごとに context を組み直す」器は既にある。足りないのは中身を選ぶ知恵だけ。

### 1.2 問題1: トークン予算の最適値は言語依存

- context は **プレフィル**（音声を聞く前に system prompt を全部デコーダに通す）。コストは**トークン数**で決まる。レイテンシ・KV キャッシュに直結。
- 「同じ情報に何トークン要るか」は言語で大きく違う:
  - Petrov et al. 2023 (NeurIPS, arXiv:2305.15425): 同一内容でトークン長が**最大15倍**差。多言語 tokenizer でも残る。論文は「**context に与えられる量**・コスト・レイテンシの不公平」を明示。
  - Ahia et al. 2023 (EMNLP, arXiv:2305.13707): 同一内容で日本語22 / ヒンディー56 / タミル86 トークン → 最大7倍コスト差（"token premium"）。**日本語は非英語の中では比較的効率は良い方**だが、英語よりは確実に重い。
- 帰結: **バイト固定予算は二重に粗い代理**。(a) 実コストはトークンなのにバイトで測る (b) バイト⇔トークン比が言語依存。
  - 実測感: `1500B` で英語 ≈187語 / 日本語 ≈107語（「機械学習」級1語≈14B）。**日本語は語数で不利**で、200語 cap に届く前にバイト予算で切れる。

### 1.3 問題2: 「何を入れるか」が効果を決める（サイズより選抜）

- 長すぎる bias list は**逆効果**: LLM ベース ASR で幻覚誘発・計算効率低下・精度ドロップ（arXiv:2509.05908 ほか）。
- 解は **retrieval-based biasing**（音声/文脈に関連する候補だけ動的選抜）:
  - BR-ASR (arXiv:2505.19179): 20万エントリでも WER 劣化0.3%、99.99% 枝刈り、20ms/query。
  - Retrieve and Copy (arXiv:2311.08402): FAISS(ANN) で関連エンティティだけ選ぶ。
- 効果は**ソフト**（トークン確率を傾けるだけ、強制ではない）。だからこそ「当たりの語を入れる」選抜精度が効く。

### 1.4 問題3: 日本語の同音異義語 — context 注入が主役になる唯一の領域

- 日本語の同音異義語の多さは構造的: **漢語(音読み)を狭い音韻体系(モーラ)に押し込めた**ため別字が同音に潰れる（「こうしょう」=交渉/公証/工匠/考証/口承…20以上）。**明治の翻訳語**で激増し、**戦後〜現代の専門分化**（各学会・省庁が術語を別々に整備＝調整不足）でさらに積層。
- **後処理の文字列置換では原理的に解けない**: 誤変換後はキー（音）が同じで引きどころがない。
- **唯一の解法は認識段階で「今は○○分野だから△△」とモデルに教える** ＝ context 注入。⇒ 日本語では context は「あれば便利」ではなく**曖昧性解消の主役**。英語（同音異義が少ない）と重みが違う。

---

## 2. 設計の核心: 文脈依存の動的 context 注入

### 2.1 すでに手元にある「文脈の材料」

| 材料 | 取得元（既存） | 使い道 |
|---|---|---|
| 今書いている文書（カーソル前） | `accessibilityContext.context.textSelection.preSelectionText` | 分野・話題の推定、関連語 retrieve のクエリ |
| 直前に認識した発話 | `aggregatedTranscription` / `previousChunk` | 同上（会話の流れ） |
| アクティブ辞書の分野 | `getActiveDictionaryEntries()` + index.json の category | 分野でフィルタ／重み付け |
| 入力先アプリ種別 | accessibilityContext（アプリ情報） | コードエディタ→programming 厚く 等 |

### 2.2 やること

「最近追加200語を素朴に入れる」を、

> **その発話の文脈（preSelectionText・直前発話・分野・アプリ）に関連する語を retrieve し、言語に応じたトークン予算内で注入。チャンクごとに引き直す。**

に差し替える。器（チャンクごとの `buildQwen3Context` 呼び出し）は既にあるので、**選抜ロジックの差し替え**が主作業。

---

## 3. 実装ロードマップ（段階的・各段で効果検証）

各フェーズは独立に価値を出せる粒度。テスタビリティ最優先（純関数 + vitest/tsx、システム全体起動なしで検証）。

### Phase 0 — 基本配線 ✅ 済（2026-06-07）
- `buildQwen3Context` 新設、provider/client/main.swift 配線、型check・test(7/7)・swift build 通過。
- 現状: vocabulary(最近200語) を ", " 連結・1500B 予算で注入。

### Phase 1 — 予算をトークン基準＋言語考慮に（基盤の正確化）
- **目的**: 言語不公平の解消。バイト→トークンの近似改善。
- **案A（軽量・TS内）**: 言語別のバイト係数を入れる（日本語は予算 or 係数を上げる）。`MAX_QWEN3_CONTEXT_BYTES` を言語別 or トークン概算（CJK は ÷ 小さい係数）に。純関数のまま。
- **案B（正確・helper側）**: helper(Swift)は Qwen tokenizer を持つので、`transcribe` 前に `countTokens` RPC を足し、TS は語を足しながらトークン実数で打ち切る。正確だが RPC 往復が増える → チャンク先頭で一括見積りする等で緩和。
- **まず案A**で不公平を消し、効果が見えたら案B。
- 検証: 言語別に「予算内に入る語数」を単体テスト。

### Phase 2 — 文脈フィルタ（最小 retrieval、最も費用対効果が高い）
- **目的**: 「今の文脈に関係ある語」だけ入れる第一歩。
- 内容:
  1. アプリ種別／アクティブ辞書 category で**分野を推定**。
  2. preSelectionText・直前発話に**表層一致/部分一致する辞書エントリを優先**（素朴な語彙オーバーラップで十分な初手）。
  3. 上位 N 語を予算内で注入。残り枠を従来の「最近語」で埋める。
- 純関数 `selectContextualHints(candidates, contextText, fieldHint, budget)` として切り出し、vitest。
- 検証: 文脈テキスト固定で「選抜結果」がスナップショット一致。PoC で context あり/なしの認識差。

### Phase 3 — 読みキーの同音異義グループ辞書（日本語の本丸）
- **目的**: 同音異義語を文脈で出し分ける。
- データ構造案（新規 JSON、辞書ライブラリと同居・非破壊で追加可能）:
  ```jsonc
  // homophones/<id>.json
  {
    "version": 1,
    "groups": [
      {
        "reading": "こうしょう",          // かな(キー)
        "candidates": [
          { "surface": "交渉", "fields": ["business", "law", "general"] },
          { "surface": "公証", "fields": ["law"] },
          { "surface": "工匠", "fields": ["manufacturing", "craft"] },
          { "surface": "考証", "fields": ["academic", "history"] }
        ]
      }
    ]
  }
  ```
- ロジック: 文脈から分野/語彙を見て、各グループの**今らしい表記だけ**を context に入れる（全表記を入れると逆 bias になるため絞る）。
- 検証: 「文脈→選ばれた表記」の純関数テスト。代表的同音異義語セットで正解率。
- 補足: 読み付与は辞書オーサリング時（[dictionary-library-authoring](#)）に手で or 形態素解析（kuromoji 等）で。要検討。

### Phase 4 — 意味的 retrieval（将来・BR-ASR 的）
- preSelectionText/直前発話の**埋め込み**で、辞書エントリ（説明文付き）を ANN 検索して関連語を選抜。
- オンデバイス埋め込みの重さと要相談。Phase 2/3 の表層手法で頭打ちになってから。

---

## 4. 評価方法（テスタビリティ重視）

- **単体（純関数）**: 選抜ロジック（Phase1 予算、Phase2 文脈フィルタ、Phase3 同音異義選抜）はすべて純関数に切り出し vitest。`tsx` で対話確認。
- **PoC（副作用なし・推奨）**: 少数の日本語音声サンプル（同音異義語・専門用語を含む）に対し、helper を単体で叩いて context あり/なし・予算違い・文脈フィルタ有無で出力比較。`.app` フルビルド不要。
- **指標**: 全体 WER、**同音異義語の表記正解率**（本命指標）、固有名詞/専門用語の認識率、プレフィルによる追加レイテンシ。
- `.app` 実機確認は最後（install-dev.sh は /Applications 入替で常用 Amical の TCC を silent revoke するため、タイミングはユーザー判断 [no_dev_launch](#)）。

---

## 5. リスク・制約・設計上の約束

- **効果はソフト**: context は確率を傾けるだけ。**確定的な表記統一は後処理の `applyTextReplacements` に残す**（context で代替しない）。二層（ソフト=認識bias / ハード=後処理置換）を維持。
- **プレフィルレイテンシ**: 小型(0.6B/1.7B)オンデバイス。context を増やすほど認識開始が遅れる。選抜で「少なく的確に」が鉄則。
- **逆 bias / ノイズ化**: 無関係語・同音異義の全表記を入れるとかえって悪化。Phase が進むほど「入れない語を増やす」設計。
- **本家非接触**: 辞書・同音異義データは JSON アセット追加で本家コードに触れない方針を継続。
- **silent revoke**: 実機検証は配布シミュレーション（install-dev.sh）の制約下。

---

## 6. 参考文献

- Petrov et al., *Language Model Tokenizers Introduce Unfairness Between Languages*, NeurIPS 2023. https://arxiv.org/abs/2305.15425
- Ahia et al., *Do All Languages Cost the Same? Tokenization in the Era of Commercial Language Models*, EMNLP 2023. https://arxiv.org/abs/2305.13707
- *BR-ASR: Efficient and Scalable Bias Retrieval Framework for Contextual Biasing ASR in Speech LLM*, 2025. https://arxiv.org/abs/2505.19179
- *Retrieve and Copy: Scaling ASR Personalization to Large Catalogs*, 2023. https://arxiv.org/pdf/2311.08402
- *Enhancing the Robustness of Contextual ASR to Varying Biasing Information Volumes…*, 2025. https://arxiv.org/pdf/2509.05908

---

## 7. 関連実装（足場）

| 役割 | ファイル |
|---|---|
| Qwen3 context 構築（今回の起点） | [qwen3-context.ts](apps/desktop/src/pipeline/providers/transcription/qwen3-context.ts) |
| 語彙ヒント選抜（差し替え対象） | [vocabulary-hints.ts](apps/desktop/src/utils/vocabulary-hints.ts) |
| 文脈構築（vocabulary/replacements 分離） | [transcription-service.ts:810](apps/desktop/src/services/transcription-service.ts:810) |
| Qwen3 呼び出し（チャンク毎の組み直し点） | [qwen3-provider.ts](apps/desktop/src/pipeline/providers/transcription/qwen3-provider.ts) |
| helper RPC / デコードオプション | [qwen3-helper-client.ts](apps/desktop/src/pipeline/providers/transcription/qwen3-helper-client.ts), [main.swift](packages/native-helpers/stt-helper/Sources/stt-helper/main.swift) |
| 後処理置換（ハード変換・役割分担の相手） | [text-replacement.ts](apps/desktop/src/utils/text-replacement.ts) |
| 辞書ライブラリ（同音異義データの追加先） | [dictionary-library/](apps/desktop/src/services/dictionary-library/) |
| Whisper 版（対称の先行実装・参考） | [whisper-prompt.ts](apps/desktop/src/pipeline/providers/transcription/whisper-prompt.ts) |
