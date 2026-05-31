# Misrecognition PoC

SPEC-misrecognition-v2.md の Phase 1 (Co-occurrence baseline) を実履歴で検証するためのスクリプト群。

## ねらい

v1 (`scanner-core.ts` 旧実装) が同読みグループの少数派を機械的に flag した結果、`ノード` が `ノート` の誤認識扱いされた問題を解決する。共起分布(左右1語の bi-gram)が dominant 語と一致しない少数派は「使い分け」として除外する。

## 検証ターゲット

- `ノード` (技術用語、12 回) と `ノート` (note、dominant) を **混同しない**こと
- `システムプロンプ` + 助詞 `と` の 2 トークン分割パターンを共起異常で**拾えるか**
- `誤変換` vs `ご返還` の同読み異綴を**読み単位で**捕捉できるか

## 実行

```bash
# 本番 DB を read-only snapshot にコピー (副作用ゼロ)
cp ~/Library/Application\ Support/Amical/amical.db \
   apps/desktop/scripts/misrec-poc/tmp/snapshot.db

# PoC を実行
cd apps/desktop
pnpm tsx scripts/misrec-poc/co-occurrence.ts
```

結果は `tmp/co-occurrence-result.json` に書き出される。
