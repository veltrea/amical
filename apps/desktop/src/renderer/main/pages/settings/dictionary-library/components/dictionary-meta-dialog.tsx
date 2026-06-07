import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "react-i18next";

export interface MetaFormData {
  id: string;
  name: string;
  name_ja: string;
  description: string;
  description_ja: string;
  category: string;
  tags: string; // comma-separated in the form
}

// Mirror of FILTER_CATEGORIES minus "all" — the categories a dictionary can be
// filed under. Kept in sync with pages/settings/dictionary-library/index.tsx.
const CATEGORIES = ["general", "developer", "creator", "professional"] as const;

interface MetaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  formData: MetaFormData;
  onFormDataChange: (data: MetaFormData) => void;
  onSubmit: () => void;
  isLoading?: boolean;
}

/**
 * Create/edit dialog for a dictionary's metadata (the index.json block). On
 * create the id is editable; on edit the id is fixed (renaming would require a
 * file rename — see DICTIONARY_EDITOR_PLAN §8).
 */
export function DictionaryMetaDialog({
  open,
  onOpenChange,
  mode,
  formData,
  onFormDataChange,
  onSubmit,
  isLoading = false,
}: MetaDialogProps) {
  const { t } = useTranslation();
  const set = (patch: Partial<MetaFormData>) =>
    onFormDataChange({ ...formData, ...patch });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === "create"
              ? t("settings.dictionaryLibrary.editor.createDictionaryTitle")
              : t("settings.dictionaryLibrary.editor.editMetaTitle")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          {mode === "create" && (
            <div className="space-y-1">
              <Label htmlFor="dict-meta-id">
                {t("settings.dictionaryLibrary.editor.fieldId")}
              </Label>
              <Input
                id="dict-meta-id"
                value={formData.id}
                onChange={(e) => set({ id: e.target.value })}
                placeholder="my-dictionary"
              />
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="dict-meta-name">
              {t("settings.dictionaryLibrary.editor.fieldName")}
            </Label>
            <Input
              id="dict-meta-name"
              value={formData.name}
              onChange={(e) => set({ name: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="dict-meta-name-ja">
              {t("settings.dictionaryLibrary.editor.fieldNameJa")}
            </Label>
            <Input
              id="dict-meta-name-ja"
              value={formData.name_ja}
              onChange={(e) => set({ name_ja: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="dict-meta-desc">
              {t("settings.dictionaryLibrary.editor.fieldDescription")}
            </Label>
            <Textarea
              id="dict-meta-desc"
              value={formData.description}
              onChange={(e) => set({ description: e.target.value })}
              rows={2}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="dict-meta-desc-ja">
              {t("settings.dictionaryLibrary.editor.fieldDescriptionJa")}
            </Label>
            <Textarea
              id="dict-meta-desc-ja"
              value={formData.description_ja}
              onChange={(e) => set({ description_ja: e.target.value })}
              rows={2}
            />
          </div>
          <div className="space-y-1">
            <Label>{t("settings.dictionaryLibrary.editor.fieldCategory")}</Label>
            <Select
              value={formData.category}
              onValueChange={(v) => set({ category: v })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {t(`settings.dictionaryLibrary.filter.${c}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="dict-meta-tags">
              {t("settings.dictionaryLibrary.editor.fieldTags")}
            </Label>
            <Input
              id="dict-meta-tags"
              value={formData.tags}
              onChange={(e) => set({ tags: e.target.value })}
              placeholder="tag1, tag2, tag3"
            />
          </div>
        </div>
        <DialogFooter className="flex justify-end gap-2 pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("settings.dictionaryLibrary.editor.cancel")}
          </Button>
          <Button
            onClick={onSubmit}
            disabled={
              !formData.name.trim() ||
              (mode === "create" && !formData.id.trim()) ||
              isLoading
            }
          >
            {isLoading
              ? t("settings.dictionaryLibrary.editor.saving")
              : mode === "create"
                ? t("settings.dictionaryLibrary.editor.create")
                : t("settings.dictionaryLibrary.editor.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
