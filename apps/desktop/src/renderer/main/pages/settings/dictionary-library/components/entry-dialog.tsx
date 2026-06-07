import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTranslation } from "react-i18next";

export interface EntryFormData {
  word: string;
  replacementWord: string;
  isReplacement: boolean;
}

interface EntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "add" | "edit";
  formData: EntryFormData;
  onFormDataChange: (data: EntryFormData) => void;
  onSubmit: () => void;
  isLoading?: boolean;
}

/**
 * Add/edit dialog for a single dictionary entry. Mirrors the vocabulary
 * VocabularyDialog UX (a replacement toggle that swaps between a single word
 * field and a "reading → correct spelling" pair) but is scoped to the bundled
 * dictionary editor and reads its own i18n namespace.
 */
export function EntryDialog({
  open,
  onOpenChange,
  mode,
  formData,
  onFormDataChange,
  onSubmit,
  isLoading = false,
}: EntryDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === "add"
              ? t("settings.dictionaryLibrary.editor.addEntryTitle")
              : t("settings.dictionaryLibrary.editor.editEntryTitle")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="dict-entry-replacement-toggle">
              {t("settings.dictionaryLibrary.editor.isReplacementLabel")}
            </Label>
            <Switch
              id="dict-entry-replacement-toggle"
              checked={formData.isReplacement}
              onCheckedChange={(checked) =>
                onFormDataChange({ ...formData, isReplacement: checked })
              }
            />
          </div>

          {formData.isReplacement ? (
            <div className="flex items-center gap-2">
              <Input
                placeholder={t(
                  "settings.dictionaryLibrary.editor.wordPlaceholder",
                )}
                value={formData.word}
                onChange={(e) =>
                  onFormDataChange({ ...formData, word: e.target.value })
                }
              />
              <span className="text-muted-foreground">→</span>
              <Input
                placeholder={t(
                  "settings.dictionaryLibrary.editor.replacementPlaceholder",
                )}
                value={formData.replacementWord}
                onChange={(e) =>
                  onFormDataChange({
                    ...formData,
                    replacementWord: e.target.value,
                  })
                }
              />
            </div>
          ) : (
            <Input
              placeholder={t(
                "settings.dictionaryLibrary.editor.wordPlaceholder",
              )}
              value={formData.word}
              onChange={(e) =>
                onFormDataChange({ ...formData, word: e.target.value })
              }
            />
          )}

          <DialogFooter className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("settings.dictionaryLibrary.editor.cancel")}
            </Button>
            <Button
              onClick={onSubmit}
              disabled={
                !formData.word.trim() ||
                (formData.isReplacement && !formData.replacementWord.trim()) ||
                isLoading
              }
            >
              {isLoading
                ? t("settings.dictionaryLibrary.editor.saving")
                : t("settings.dictionaryLibrary.editor.save")}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
