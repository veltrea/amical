# 文脈 biasing 作業 ハンドオーバー（次セッション再開用）

最終更新: 2026-06-07（同日、Phase 2「分野の見当づけ」アルゴリズムの設計を確定し反映）

## このファイルの使い方

新しいセッションで、下の「再開プロンプト」をそのまま貼れば、この作業を続けられる。
このファイル自体が引き継ぎ資料。あわせて `CONTEXTUAL_BIASING_PLAN.md`（全体計画）と
`CONTEXTUAL_BIASING_PHASE2.md`（次にやる Phase 2 の詳細）を読めば、現状と次の一手が分かる。

---

## 再開プロンプト（これをコピペして新セッションに貼る）

```
CONTEXTUAL_BIASING_HANDOVER.md と CONTEXTUAL_BIASING_FIELD_ESTIMATION.md を読んで、Qwen3-ASR の
文脈 biasing（辞書を「文字起こし後の校正」ではなく「聞き取り前のヒント」として使う）作業を続けたい。

これまで: Phase 0（配線）・Phase 1（トークン予算化）は完了済み（未コミット）。Phase 2 の
「分野の見当づけ」アルゴリズムは 2026-06-07 に設計を確定し、CONTEXTUAL_BIASING_FIELD_ESTIMATION.md
に保存ずみ（見当は録音をまたいで居座る／分からなければ前のまま・中立に戻さない／迷ったら
そのユーザーが一番多く話す分野へ寄せる）。辞書エディタは完成済み。

次にやること: 設計ファイルの §6「最初に作るもの」から。まず保存済みの文字起こしが何件・どんな
保存形式かを確認し、分野で分類して個人の記録（一番多い分野）を初日から作れるか見る。そのうえで、
分野の見当を立てる純関数（優先順位のはしご）と、録音ごとの記録（時刻・アプリ・見当の分野）を
小さく作る。古びる時間は仮置き（数分）でよい。

まず現状を3行で要約してから、最初の一歩（保存済み文字起こしの件数・保存形式の確認）を始めて。

注意:
- 応答テキストの直後にツールを置くとタグが壊れる現象があるので、テキストとツールは分ける。
- ドキュメントは平易な日本語で（矢印・英語変数名・無説明の専門用語を本文で使わない）。
- 未コミット変更が混在（Phase 0/1 の biasing と、完成した辞書エディタ）。コミットするなら別々に選ぶ。
- push 先は origin（veltrea/amical）。動作確認は install-dev.sh のみ（実行タイミングはユーザーに確認）。
```

---

## 何をやっているか（背景）

Amical（音声入力アプリ。Qwen3-ASR をローカル MLX で使用）で、辞書の語彙を
**「文字起こしの後で文字列を置換する（校正）」だけでなく「ASR が聞き取る前のヒント」としても使える**
ようにしている。特に日本語の同音異義語は、後からの置換では直せず（音が同じなので手がかりがない）、
**聞き取り段階でヒントを与えるしか解けない**。最終形は、その場の状況（使っているアプリ・カーソル前の
文章・分野）に応じて、効きそうな語だけを選んで渡すこと。

位置づけはメモリの `asr-differentiation-strategy`（モデルに依存しない「堀」を積む戦略）と一致。

---

## これまでに完了したこと

### Phase 0: 配線（完了・未コミット）
Qwen3-ASR にヒント語彙を渡す配線。土台モデル側（speech-swift、amical が固定している版 `4c927a6`）は
**すでにヒント入力に対応済み**で、amical 側が渡していなかっただけだった。

- 新規: `apps/desktop/src/pipeline/providers/transcription/qwen3-context.ts`（`buildQwen3Context`）
- 改修: 同 `qwen3-provider.ts` / `qwen3-helper-client.ts` / `packages/native-helpers/stt-helper/Sources/stt-helper/main.swift`
- テスト: `apps/desktop/tests/pipeline/qwen3-context.test.ts`
- 検証: 型チェック OK / vitest OK / `swift build` OK

### Phase 1: トークン予算化（完了・未コミット）
渡す語の量の上限を「バイト数」から「おおよそのトークン数」に変更。バイトだと日本語などが不利
（同じバイトでも消費トークンが多い）になるのを是正。

- `qwen3-context.ts` に `estimateQwen3Tokens` を追加、上限 `MAX_QWEN3_CONTEXT_TOKENS = 500`
- テスト 12/12 OK、型チェック OK

### Phase 2 設計: 分野の見当づけアルゴリズム（確定・2026-06-07）
辞書から「どの分野の語を厚くするか」を決める考え方を確定し、別ファイルに保存。要点:
- 分野の見当は録音をまたいで**居座る**。**分からない＝直前から変わっていない**とみなし、中立に戻さない。
- 優先順位のはしご（上から、無ければ下へ）: いまの中身の証拠／直前の見当（居座り）／そのユーザーが一番多く話す分野（個人の記録）／最前面のアプリ／中立。中身の証拠が出たら上書き、やわらかく寄せて他分野は消さない。
- アプリ切り替えではリセットしない（1つの作業が複数アプリをまたぐ）。引き金は時間の空き。
- 個人の記録は、既存の保存済み文字起こし（数万件）を分類すれば初日から濃く作れる。
- 保存先: `CONTEXTUAL_BIASING_FIELD_ESTIMATION.md`（PHASE2 §7/§11 もこの内容で更新済み）。

### 辞書エディタ: 完成済み（本作業とは別件・未コミット）
辞書ライブラリの編集画面が完成（`catalog.ts`, `dictionary-library.ts`, `detail.tsx`, `authoring.ts`, `serialize.ts`, `components/` ほか）。本作業（biasing）とは別の独立ユニット。Phase 2 で触る設定画面まわりの土台になる。

### ドキュメント（平易な日本語に整備済み）
- `CONTEXTUAL_BIASING_PLAN.md` … 全体計画（Phase 0〜4、関連論文の引用つき）
- `CONTEXTUAL_BIASING_PHASE2.md` … Phase 2 の詳細（§7/§11 を分野の見当づけ設計に合わせて更新）
- `CONTEXTUAL_BIASING_FIELD_ESTIMATION.md` … 分野の見当づけアルゴリズム（今日確定したもの）

---

## 次の実装の前提になる「分かっている事実」

1. **Qwen3-ASR は聞き取り前のヒント入力に対応済み**（土台モデルが system prompt にヒント語彙を入れる仕組みを持つ）。モデルの改造は不要。
2. **Amical は録音を始めた瞬間に、状況の材料をすでに全部取得している**（accessibility 経由）:
   - 使っているアプリの名前と識別子（例: VSCode、com.microsoft.VSCode）
   - 前面ウィンドウのタイトル、ブラウザなら開いている URL
   - カーソル前の文章
   - これらは録音開始時に1回読み取られ、その録音が終わるまで変わらない。
   - 定義: `packages/types/src/schemas/methods/get-accessibility-context.ts`、取得: `packages/native-helpers/swift-helper/...`
3. 辞書は2系統: **置換系**（文字起こし後に文字列を直す）と **ヒント系**（聞き取り前に渡す）。Phase 2 が扱うのは**ヒント系だけ**。確定的な言い換えは従来どおり後処理に残す（2段構え）。
4. ヒント語彙のリストは「1回の録音」ごとに固定（`buildContext`、`apps/desktop/src/services/transcription-service.ts:810`）。

---

## 次にやること: Phase 2 の最初の一歩（設計は確定済み）

分野の見当づけの設計は固まった（上の「Phase 2 設計」＋ `CONTEXTUAL_BIASING_FIELD_ESTIMATION.md`）。次は作り始める。
くわしくは設計ファイルの §6「最初に作るもの」と §7「確かめ方」。

最初の一歩（この順で）:
1. **保存済みの文字起こしを調べる**。Amical が端末にためている文字起こしが何件・どんな保存形式かを確認し、それを分野で分類して「そのユーザーが一番多く話す分野（個人の記録）」を初日から作れるか見る。これができれば「生まれて初めて記録ゼロ」の弱点はほぼ消える。
2. **分野の見当を立てる純関数**を `apps/desktop/src/utils/contextual-hints.ts` に作る。中身は設計ファイル §2 の優先順位のはしご（いまの中身の証拠・直前の見当・個人の記録・アプリ・中立）。画面や DB に依存させない。
3. **録音ごとの記録**（時刻・アプリ・見当の分野）を文字起こしサービス側（`transcription-service.ts`）に小さく貯め始める。これが個人の記録と「古びる時間」の調整の両方の元データになる。古びる時間は仮置き（数分）でよい。
4. 立てた分野を、`CONTEXTUAL_BIASING_PHASE2.md` §7 の点数づけ（分野に合う語を高くする）に渡して語を選ぶ。語の量の打ち切りは Phase 1 の `buildQwen3Context` が担当。辞書から「分野つき」で語を取り出す土台作業（`operations.ts`）も §9 のとおり要る。

純関数なので `apps/desktop/tests/utils/contextual-hints.test.ts` で vitest 確認（アプリ全体の起動は不要）。確かめる挙動は設計ファイル §7（Word は中身次第・コードエディタは開発寄り・手がかり空でも直近があれば前のまま・生まれて初めてだけアプリか中立・手動登録語は必ず残る）。

開いている論点（設計ファイル §8）: 古びる時間の値／個人の記録の数え方／同音異義語に Phase 2 で足りるか（読み辞書の Phase 3 を先に出すか）／アプリと分野の対応を設定画面で編集可能にするか。

---

## 関連ファイル一覧

- 実装（Phase 0/1）: `apps/desktop/src/pipeline/providers/transcription/qwen3-context.ts`, `qwen3-provider.ts`, `qwen3-helper-client.ts`, `packages/native-helpers/stt-helper/Sources/stt-helper/main.swift`
- テスト: `apps/desktop/tests/pipeline/qwen3-context.test.ts`
- 計画: `CONTEXTUAL_BIASING_PLAN.md`, `CONTEXTUAL_BIASING_PHASE2.md`, `CONTEXTUAL_BIASING_FIELD_ESTIMATION.md`（分野の見当づけ設計）
- メモリ（`~/.claude/projects/-Volumes-2TB-USB-dev-amical/memory/`）: `contextual-biasing-field-estimation.md`（今日の設計）, `qwen3-asr-context-input.md`, `plain-language-design-docs.md`, `asr-differentiation-strategy.md`, `misrecognition-homophone-v4.md`, `dictionary-library-authoring.md`

---

## 注意点（必ず守る）

- **ツールのタグが壊れる現象**: このセッションでは、応答テキストの直後にツール呼び出しを置くと、内部の
  タグが平文として表に出てしまい、コマンドがまともに動かなくなることが何度か起きた。**ツールを呼ぶ前の
  テキストは短くし、テキストとツールをはっきり分ける**こと（メモリ `tool-call-format-count-bug` 参照）。
  新セッションで仕切り直すのは、これをリセットするため。
- **ドキュメントは平易な日本語で**: 矢印（→）・英語のコード変数名・説明なしの専門用語を本文で使わない。
  難しい語は「定義して使う」のではなく「使わず平易な言葉に置き換える」（メモリ `plain-language-design-docs`）。
- **未コミット変更の切り分け**: まだ何もコミットしていない。作業ツリーには3種類が混在する。
  (1) Phase 0/1 の biasing 実装（`qwen3-context.ts`, `qwen3-provider.ts`, `qwen3-helper-client.ts`,
  `main.swift`, `tests/pipeline/qwen3-context.test.ts`, 計画書類）、(2) **完成した辞書エディタ**
  （`catalog.ts`, `dictionary-library.ts`, `detail.tsx`, `authoring.ts`, `serialize.ts`, `components/` ほか。
  本作業とは別件・完成済みの独立ユニット）、(3) その他無関係（`whisper.cpp`/`dev.sh` 削除、`.db.bak`、
  `note-*.md` など）。コミットするなら、この3種を混ぜず別々に選ぶこと。
- **push 先は origin（veltrea/amical）**。upstream（amicalhq）には出さない。
- **動作確認は `scripts/install-dev.sh` のみ**。これは普段使いの Amical の権限を一時的に無効化するので、
  実行のタイミングはユーザーに確認する。dev ビルド前に `/Applications/Amical.app` を終了させる。
- **コミットメッセージに AI の著作権表記（Co-Authored-By 等）を入れない**。
