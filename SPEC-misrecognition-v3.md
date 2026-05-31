# SPEC v3: 誤認識候補プール — 検出器カタログ + ユーザー駆動の選別

**ステータス:** 設計のみ(未実装)
**位置付け:** v1 (rule 積み上げ) と v2 (3 段 pipeline で auto verdict) の両方破棄。Phase 1 PoC で「verdict 自動判定は実データで成立しない」が確認されたため(後述)、抽出と判別を分離する。
**派生元:** `feat/mlx-proofreading`
**作業ルール:** 新規 branch を切らず、`feat/mlx-proofreading` 上で commit する

---

## 0. なぜ v2 を破棄したか

v2 は「Detector → Generator → Selector の 3 段で **auto verdict を出した候補プール**」を作る方針だった。

PoC (`apps/desktop/scripts/misrec-poc/co-occurrence.ts`) で Phase 1 (Detector = co-occurrence) を実履歴 31,899 件に当てた結果:

- v1 で起きた「ノード ≡ ノート 混同」は kuromoji の reading を採用することで構造的に解決した
- しかし `misrecognition-suspect` に分類された 91 件の大半が **ASR 誤認識ではなく、ユーザーの正常な表記揺れ**:
  - `いう(2352) / 言う(497)`、`時(1259) / とき(491)`、`欲しい(695) / ほしい(195)` …
- これは「Detector の精度の問題」ではない。**ASR の出力では「漢字書きする vs ひらがな書きする」と「誤認識」の境界自体が文脈依存**で、機械的に分離する手段がない
- `仕様 / 使用 / しよう` のように **本物の同音異義語**と表記揺れが**同じグループに混在**することが頻繁にある

結論: **「使い分けか誤認識か」の判定は、最終的にユーザー本人にしかできない**。機械にやらせると必ずノイズを正解と間違えるか、正解をノイズと捨てる。

---

## 1. 新方針

抽出と判別を分離する。

1. **抽出 (recall 重視)** — 既存研究で出てきた複数の検出器をそれぞれ独立に実装し、**ユーザーが UI で on/off する**
2. **判別 (precision)** — ユーザーが UI 上で検索・絞り込み・並び替えで掘り、本物の誤認識を見つけて「正解を入力 → vocabulary に登録」する

つまり Amical は **「誤認識を提案する AI」ではなく「履歴を多角的に切り出す検索ツール」を提供する**。

### 設計の核

- 各検出器 = `(id, label, category, requiresMlx, run(rows, vocab) → Candidate[])` の一様インターフェース
- 候補 = `{ word, normalizedKey, occurrenceCount, detectorIds: string[], ... }`
- 同じ surface が複数検出器で flag されたら `detectorIds` に複数 ID が付く(OR 統合、削除しない)
- UI は「検出器カタログ」と「候補リスト」の 2 段構成

---

## 2. 検出器カタログ

カテゴリは UI でグルーピング表示する。`requiresMlx` の検出器は MLX 校正モデル未設定なら disabled。

### 2.1 Rule 系(高速、外部依存ゼロ)

| ID | 説明 | 由来 |
|---|---|---|
| `katakana-variant` | 同 reading のカタカナ語で出現が複数あるもの全て(v1 の濁点剥がしは不採用、kuromoji reading 使用) | v1 ルール |
| `low-frequency-rare` | 全履歴で 1〜3 回しか出ない長さ ≥3 のカタカナ・英字トークン | v1 ルール |
| `mixed-script` | 同一トークン内に英字と日本語が混在 (`Apple果物`) | v1 ルール |
| `near-vocabulary` | 既存 vocabulary 行と編集距離 1 | v1 ルール |
| `trailing-omission` | 長音/促音の末尾欠落 (`コーヒ` vs `コーヒー`) | v1 改良 |

### 2.2 形態素解析系(高速、kuromoji 必要)

| ID | 説明 | 由来 |
|---|---|---|
| `same-reading-group` | kuromoji の reading で同読み複数 surface を持つ語(漢字/ひらがな含む) | Phase 1 PoC 流用 |
| `unknown-word` | kuromoji が未知語として処理した surface (reading が出ない) | UCorrect Detector の代用 |
| `boundary-anomaly` | 「複合語が分割された疑い」がある語(例: 直後に助詞 `と` が異常頻度) | `システムプロンプ + と` パターン |

### 2.3 統計系(中速)

| ID | 説明 | 由来 |
|---|---|---|
| `cooccurrence-divergence` | 同 reading グループ内、dominant と minority で左右1語 bi-gram の JS divergence が小さいもの(=表記揺れ寄り) | Phase 1 PoC 流用、ただし verdict は出さない、スコアだけ提示 |
| `rare-ngram-context` | 低頻度語が「特定の固定文脈にしか出ない」か「文脈分布が極端に偏る」 | Lexical Co-occurrence (SPEC v2 §1.3) |

### 2.4 音韻系(中速)

| ID | 説明 | 由来 |
|---|---|---|
| `phonetic-near` | kuromoji reading が完全一致または編集距離 1 の異綴ペア(漢字混じり含む) | Phonetic Similarity (SPEC v2 §1.4) |

### 2.5 LLM 系(低速、MLX 校正モデル必要)

| ID | 説明 | 由来 |
|---|---|---|
| `mlx-rare-word-judgement` | 他検出器が flag した rare word について、文脈付きで MLX LLM に「これは誤認識?」二択判定させる | LLM-based GER for Rare Words (SPEC v2 §1.5) |
| `mlx-homonym-judgement` | 同読みグループの各 surface について、出現文脈ごとに「他の同音語が正しかったか」を MLX LLM に判定させる | MPA GER (SPEC v2 §1.2) |

これらは **絞り込み後の候補**にのみ走らせる(全履歴に走らせない)。UI は「LLM 検査」ボタンを別途出す。

---

## 3. データモデル

### 既存テーブルを流用

`misrecognition_candidates` (v1 で作成済み) を流用。**新カラム追加**:

```ts
detectorIds: text("detector_ids").notNull(),  // JSON array: ["katakana-variant","low-frequency-rare"]
contextSample: text("context_sample"),         // JSON: 出現文脈の最大 3 件サンプル ({left, right, transcriptionId})
detectorScores: text("detector_scores"),       // JSON object: { "cooccurrence-divergence": 0.12, ... }
```

`misrecognition_scan_state` も流用。各検出器ごとの最終スキャン id を JSON で持つ。

### マイグレーション

`0007_misrec_detector_metadata.sql` を `drizzle-kit generate` で生成。

---

## 4. tRPC API

既存 router を拡張:

```ts
listDetectors(): DetectorDescriptor[]
  // { id, label, category, requiresMlx, estimatedDuration, isEnabled }

scanNow({ detectorIds: string[], fullRescan?: boolean }): ScanReport
  // 選択された検出器のみ走らせる
  // ScanReport = { perDetector: { id: { found, addedTags, durationMs } } }

listCandidates({
  limit, offset,
  sortBy: "occurrenceCount" | "lastSeenAt" | "word",
  sortOrder: "asc" | "desc",
  filterDetectors?: string[],    // AND/OR は当面 OR 固定
  searchWord?: string,           // surface/reading の前方一致
  searchReading?: string,
  groupByNormalizedKey?: boolean,
}): Candidate[] | CandidateGroup[]

// 既存:
dismissCandidate / dismissCandidates / registerCandidate / bulkRegisterCandidates
countCandidates / getScanStatus
```

---

## 5. UI

```
┌─ 誤認識候補 ──────────────────────────────────────────┐
│ 履歴から「誤認識かも」を多角的に抽出します。               │
│                                                       │
│ ▼ 検出器を選ぶ                                        │
│ ┌─ Rule ────────────────────────────────────────────┐ │
│ │ ☑ カタカナ表記揺れ        ☐ 低頻度カナ・英字     │ │
│ │ ☑ 英日混在トークン       ☐ vocab ニアミス        │ │
│ │ ☐ 末尾欠落               (高速)                  │ │
│ └────────────────────────────────────────────────────┘ │
│ ┌─ 形態素解析 ─────────────────────────────────────┐ │
│ │ ☑ 同読みグループ          ☐ 未知語              │ │
│ │ ☐ 形態素境界異常          (高速)                  │ │
│ └────────────────────────────────────────────────────┘ │
│ ┌─ 統計 ────────────────────────────────────────────┐ │
│ │ ☐ 共起分布の差            ☐ 低頻度語の文脈偏り    │ │
│ │                          (中速)                  │ │
│ └────────────────────────────────────────────────────┘ │
│ ┌─ 音韻 ────────────────────────────────────────────┐ │
│ │ ☐ 同読み異綴 (漢字混じり) (中速)                  │ │
│ └────────────────────────────────────────────────────┘ │
│ ┌─ LLM 判定 (MLX 校正モデル必要) ───────────────────┐ │
│ │ ☐ rare word を LLM に判定させる                   │ │
│ │ ☐ 同音語を LLM に判定させる        (低速)        │ │
│ └────────────────────────────────────────────────────┘ │
│ [ スキャン開始 ]                                       │
│                                                       │
│ ─── 結果 ───                                          │
│ [検索: ___] [タグ: 全部 ▼] [並び: 頻度↓ ▼] [☐同読みで畳む] │
│ ┌──┬───────────┬────────────────────────┬───────────┐ │
│ │☐│ システムプロンプ(10)│ #未知語 #境界異常 │ [正解__][登録][🗑] │ │
│ │☐│ ノード(15)        │ #同読み (with ノート) │ [正解__][登録][🗑] │ │
│ │☐│ Apple果物(2)     │ #英日混在          │ [正解__][登録][🗑] │ │
│ └──┴───────────┴────────────────────────┴───────────┘ │
└────────────────────────────────────────────────────────┘
```

主な操作:
- 検出器選択 → スキャン
- タグでフィルタ、検索で絞る
- 同読みでグループ化 ON にすれば bulk-register が効く
- 1 候補ずつ登録 or 選択して bulk-register
- ゴミ箱に入れた候補は再浮上しない

---

## 6. 実装の最小立ち上げ (Phase A)

**全部一度に実装しない**。最小セットで動かして UI 体験を確かめてから検出器を増やす。

### Phase A — 最小セット (commit 単位 5〜6 個)

1. **schema migration** — `detectorIds / contextSample / detectorScores` カラム追加
2. **detector framework** — `apps/desktop/src/services/misrecognition/detectors/` ディレクトリ作成、`Detector` interface とレジストリ
3. **Rule 系 4 検出器を新 framework に移植** — v1 で動いてたロジックを `katakana-variant / low-frequency-rare / mixed-script / near-vocabulary` の 4 ファイルに分割
4. **形態素解析系 2 検出器** — `same-reading-group / unknown-word` を kuromoji で実装
5. **tRPC + UI** — `listDetectors`、`scanNow({detectorIds})`、UI に検出器チェックリスト追加、タグ表示・タグフィルタ
6. **v1 scanner-core の旧 extractCandidates を削除** — 新 framework から呼ぶ形にすべて置き換え

### Phase B — 統計・音韻

7. `cooccurrence-divergence` (Phase 1 PoC コードを framework に移植)
8. `phonetic-near` / `boundary-anomaly` / `trailing-omission` / `rare-ngram-context`

### Phase C — LLM

9. `mlx-rare-word-judgement` / `mlx-homonym-judgement` — MLX 校正モデル経由
10. UI に「選択した候補を LLM に判定させる」ボタン追加

### kuromoji の同梱

`apps/desktop/package.json` の **devDependency から dependency に昇格** が必要。Electron で kuromoji の辞書ファイルを同梱する手段(`extraResource`)を確認。

---

## 7. SPEC v2 から残すもの / 捨てるもの

### 残す
- DB スキーマ (`misrecognition_candidates`, `misrecognition_scan_state`) — カラム追加のみ
- tRPC ルーターと UI ルートの骨格
- PoC コード (`apps/desktop/scripts/misrec-poc/`) は **Phase B の参考実装として残す**

### 捨てる
- SPEC v2 §2.1 の「Detector → Generator → Selector で 1 つの verdict を出す」流れ
- SPEC v1 の `scanner-core.ts` の `extractCandidates` 一本化ロジック → 検出器分割で置き換え

---

## 8. オープン質問

1. 検出器のデフォルト on/off は何にするか(`katakana-variant` と `same-reading-group` のみ on 推奨)
2. `unknown-word` 検出器が出す件数は数千件規模になる可能性大。長さ閾値や頻度閾値を入れるか
3. LLM 判定は「全部選択された候補に一括で走らせる」か「1 件ずつボタンを押す」か
4. Phase A から始めて全 Phase 終わるまでの commit 数の目安: 概ね 10〜15 commit
