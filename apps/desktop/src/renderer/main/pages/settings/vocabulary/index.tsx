import { useRef, useState } from "react";
import {
  Plus,
  Edit,
  Trash2,
  Info,
  MoveRight,
  Upload,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

type ImportMode = "skip" | "overwrite";

interface ExportEntry {
  word: string;
  replacementWord?: string | null;
  isReplacement?: boolean;
}

interface ImportResult {
  inserted: number;
  updated: number;
  skipped: ExportEntry[];
}

const EXPORT_VERSION = 1;

function downloadJsonBlob(data: unknown, filename: string) {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

type VocabularyItem = {
  id: number;
  word: string;
  replacementWord?: string | null;
  isReplacement: boolean | null;
  dateAdded: Date;
  usageCount: number | null;
  createdAt: Date;
  updatedAt: Date;
};

// Add/Edit Dialog Component
interface VocabularyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "add" | "edit";
  formData: {
    word: string;
    replacementWord: string;
    isReplacement: boolean;
  };
  onFormDataChange: (data: {
    word: string;
    replacementWord: string;
    isReplacement: boolean;
  }) => void;
  onSubmit: () => void;
  isLoading?: boolean;
}

function VocabularyDialog({
  open,
  onOpenChange,
  mode,
  formData,
  onFormDataChange,
  onSubmit,
  isLoading = false,
}: VocabularyDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === "add"
              ? t("settings.vocabulary.dialog.addTitle")
              : t("settings.vocabulary.dialog.editTitle")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Label htmlFor="replacement-toggle">
                {t("settings.vocabulary.dialog.replacementLabel")}
              </Label>
              <Info className="w-4 h-4 text-muted-foreground" />
            </div>
            <Switch
              id="replacement-toggle"
              checked={formData.isReplacement}
              onCheckedChange={(checked) =>
                onFormDataChange({ ...formData, isReplacement: checked })
              }
            />
          </div>

          {formData.isReplacement ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Input
                  placeholder={t(
                    "settings.vocabulary.dialog.misspellingPlaceholder",
                  )}
                  value={formData.word}
                  onChange={(e) =>
                    onFormDataChange({ ...formData, word: e.target.value })
                  }
                />
                <span className="text-muted-foreground">→</span>
                <Input
                  placeholder={t(
                    "settings.vocabulary.dialog.correctSpellingPlaceholder",
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
            </div>
          ) : (
            <Input
              placeholder={t("settings.vocabulary.dialog.newWordPlaceholder")}
              value={formData.word}
              onChange={(e) =>
                onFormDataChange({ ...formData, word: e.target.value })
              }
            />
          )}

          <DialogFooter className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("settings.vocabulary.dialog.cancel")}
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
                ? t("settings.vocabulary.dialog.saving")
                : mode === "add"
                  ? t("settings.vocabulary.dialog.addWord")
                  : t("settings.vocabulary.dialog.saveChanges")}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Delete Confirmation Dialog Component
interface DeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deletingItem: VocabularyItem | null;
  onConfirm: () => void;
  isLoading?: boolean;
}

function DeleteDialog({
  open,
  onOpenChange,
  deletingItem,
  onConfirm,
  isLoading = false,
}: DeleteDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("settings.vocabulary.delete.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("settings.vocabulary.delete.description", {
              item: deletingItem?.isReplacement
                ? `${deletingItem?.word} → ${deletingItem?.replacementWord}`
                : deletingItem?.word,
            })}
          </p>
        </div>

        <DialogFooter className="flex justify-end gap-2 pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("settings.vocabulary.delete.cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isLoading}
          >
            {isLoading
              ? t("settings.vocabulary.delete.deleting")
              : t("settings.vocabulary.delete.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function VocabularySettingsPage() {
  const { t } = useTranslation();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<VocabularyItem | null>(null);
  const [deletingItem, setDeletingItem] = useState<VocabularyItem | null>(null);
  const [formData, setFormData] = useState({
    word: "",
    replacementWord: "",
    isReplacement: false,
  });
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [importMode, setImportMode] = useState<ImportMode>("skip");
  const [pendingEntries, setPendingEntries] = useState<ExportEntry[] | null>(
    null,
  );
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const vocabularyQuery = api.vocabulary.getVocabulary.useQuery({
    limit: 200,
    offset: 0,
    sortBy: "dateAdded",
    sortOrder: "desc",
  });

  const vocabularyItems = vocabularyQuery.data || [];
  const vocabularyLoading = vocabularyQuery.isLoading;

  // tRPC mutations
  const utils = api.useUtils();
  const createVocabularyMutation =
    api.vocabulary.createVocabularyWord.useMutation({
      onSuccess: () => {
        utils.vocabulary.getVocabulary.invalidate();
        toast.success(t("settings.vocabulary.toast.added"));
      },
      onError: (error) => {
        toast.error(
          t("settings.vocabulary.toast.addFailed", { message: error.message }),
        );
      },
    });

  const updateVocabularyMutation = api.vocabulary.updateVocabulary.useMutation({
    onSuccess: () => {
      utils.vocabulary.getVocabulary.invalidate();
      toast.success(t("settings.vocabulary.toast.updated"));
    },
    onError: (error) => {
      toast.error(
        t("settings.vocabulary.toast.updateFailed", { message: error.message }),
      );
    },
  });

  const deleteVocabularyMutation = api.vocabulary.deleteVocabulary.useMutation({
    onSuccess: () => {
      utils.vocabulary.getVocabulary.invalidate();
      toast.success(t("settings.vocabulary.toast.deleted"));
    },
    onError: (error) => {
      toast.error(
        t("settings.vocabulary.toast.deleteFailed", {
          message: error.message,
        }),
      );
    },
  });

  const importMutation = api.vocabulary.importJson.useMutation({
    onSuccess: (res) => {
      utils.vocabulary.getVocabulary.invalidate();
      setImportResult(res);
      setPendingEntries(null);
    },
    onError: (error) => {
      toast.error(
        t("settings.vocabulary.toast.importFailed", {
          message: error.message,
        }),
      );
    },
  });

  const handleExport = async () => {
    try {
      const data = await utils.vocabulary.exportAll.fetch();
      downloadJsonBlob(data, `amical-vocabulary-${todayStamp()}.json`);
      toast.success(
        t("settings.vocabulary.toast.exportSuccess", {
          count: data.entries.length,
        }),
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      toast.error(t("settings.vocabulary.toast.exportFailed", { message }));
    }
  };

  const handleFileSelected = async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as {
        version?: number;
        entries?: ExportEntry[];
      };
      if (!parsed.entries || !Array.isArray(parsed.entries)) {
        throw new Error("entries[] missing");
      }
      setPendingEntries(parsed.entries);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      toast.error(
        t("settings.vocabulary.toast.invalidJson", { message }),
      );
      setPendingEntries(null);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleImportSubmit = () => {
    if (!pendingEntries || pendingEntries.length === 0) return;
    importMutation.mutate({ entries: pendingEntries, mode: importMode });
  };

  const handleDownloadSkipped = () => {
    if (!importResult || importResult.skipped.length === 0) return;
    downloadJsonBlob(
      {
        version: EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        entries: importResult.skipped,
      },
      `amical-vocabulary-skipped-${todayStamp()}.json`,
    );
  };

  const closeImportFlow = () => {
    setIsImportDialogOpen(false);
    setPendingEntries(null);
    setImportResult(null);
    setImportMode("skip");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleAddWord = async () => {
    try {
      await createVocabularyMutation.mutateAsync({
        word: formData.word,
        isReplacement: formData.isReplacement,
        replacementWord: formData.isReplacement
          ? formData.replacementWord
          : undefined,
      });
      setFormData({ word: "", replacementWord: "", isReplacement: false });
      setIsAddDialogOpen(false);
    } catch {
      // Error is handled by the mutation's onError callback
      // Keep dialog open so user can retry
    }
  };

  const handleEditWord = async () => {
    if (!editingItem) return;

    try {
      await updateVocabularyMutation.mutateAsync({
        id: editingItem.id,
        data: {
          word: formData.word,
          isReplacement: formData.isReplacement,
          replacementWord: formData.isReplacement
            ? formData.replacementWord
            : undefined,
        },
      });
      setFormData({ word: "", replacementWord: "", isReplacement: false });
      setEditingItem(null);
      setIsEditDialogOpen(false);
    } catch {
      // Error is handled by the mutation's onError callback
      // Keep dialog open so user can retry
    }
  };

  const handleDeleteWord = async () => {
    if (!deletingItem) return;

    try {
      await deleteVocabularyMutation.mutateAsync({
        id: deletingItem.id,
      });
      setDeletingItem(null);
      setIsDeleteDialogOpen(false);
    } catch {
      // Error is handled by the mutation's onError callback
      // Keep dialog open so user can retry
    }
  };

  const openEditDialog = (item: VocabularyItem) => {
    setEditingItem(item);
    setFormData({
      word: item.word,
      replacementWord: item.replacementWord || "",
      isReplacement: item.isReplacement || false,
    });
    setIsEditDialogOpen(true);
  };

  const openDeleteDialog = (item: VocabularyItem) => {
    setDeletingItem(item);
    setIsDeleteDialogOpen(true);
  };

  const resetForm = () => {
    setFormData({ word: "", replacementWord: "", isReplacement: false });
    setEditingItem(null);
  };

  return (
    <div>
      {/* Header Section */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-bold">
            {t("settings.vocabulary.title")}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t("settings.vocabulary.description")}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleExport}
            className="flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            {t("settings.vocabulary.exportButton")}
          </Button>
          <Button
            variant="outline"
            onClick={() => setIsImportDialogOpen(true)}
            className="flex items-center gap-2"
          >
            <Upload className="w-4 h-4" />
            {t("settings.vocabulary.importButton")}
          </Button>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button
                onClick={() => resetForm()}
                className="flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                {t("settings.vocabulary.addButton")}
              </Button>
            </DialogTrigger>
          </Dialog>
        </div>
      </div>

      {/* Vocabulary List */}
      <Card className="p-0 overflow-clip">
        <CardContent className="p-0">
          {vocabularyLoading ? (
            <div className="p-8 text-center text-muted-foreground">
              {t("settings.vocabulary.loading")}
            </div>
          ) : vocabularyItems.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              {t("settings.vocabulary.empty")}
            </div>
          ) : (
            <div className="space-y-0">
              {vocabularyItems.map((item, index) => (
                <div
                  className="hover:bg-muted/50 transition-colors"
                  key={item.id}
                >
                  <div className="flex items-center justify-between py-3 px-4 group">
                    <span className="text-sm flex items-center gap-1">
                      {item.isReplacement ? (
                        <>
                          <span>{item.word}</span>
                          <MoveRight className="w-4 h-4 mx-2" />
                          <span>{item.replacementWord}</span>
                        </>
                      ) : (
                        item.word
                      )}
                    </span>
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditDialog(item)}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openDeleteDialog(item)}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                  {index < vocabularyItems.length - 1 && (
                    <div className="border-t border-border" />
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog Components */}
      <VocabularyDialog
        open={isAddDialogOpen}
        onOpenChange={setIsAddDialogOpen}
        mode="add"
        formData={formData}
        onFormDataChange={setFormData}
        onSubmit={handleAddWord}
        isLoading={createVocabularyMutation.isPending}
      />

      <VocabularyDialog
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        mode="edit"
        formData={formData}
        onFormDataChange={setFormData}
        onSubmit={handleEditWord}
        isLoading={updateVocabularyMutation.isPending}
      />

      <DeleteDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        deletingItem={deletingItem}
        onConfirm={handleDeleteWord}
        isLoading={deleteVocabularyMutation.isPending}
      />

      <Dialog
        open={isImportDialogOpen && !importResult}
        onOpenChange={(open) => {
          if (!open) closeImportFlow();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("settings.vocabulary.importDialog.title")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-sm">
                {t("settings.vocabulary.importDialog.modeLabel")}
              </Label>
              <RadioGroup
                value={importMode}
                onValueChange={(v) => setImportMode(v as ImportMode)}
                className="mt-2 space-y-2"
              >
                <div className="flex items-start gap-2">
                  <RadioGroupItem value="skip" id="import-mode-skip" />
                  <Label
                    htmlFor="import-mode-skip"
                    className="text-sm font-normal cursor-pointer leading-tight"
                  >
                    {t("settings.vocabulary.importDialog.modeSkip")}
                  </Label>
                </div>
                <div className="flex items-start gap-2">
                  <RadioGroupItem value="overwrite" id="import-mode-overwrite" />
                  <Label
                    htmlFor="import-mode-overwrite"
                    className="text-sm font-normal cursor-pointer leading-tight"
                  >
                    {t("settings.vocabulary.importDialog.modeOverwrite")}
                  </Label>
                </div>
              </RadioGroup>
            </div>
            <div>
              <Label htmlFor="vocabulary-import-file" className="text-sm">
                {t("settings.vocabulary.importDialog.fileLabel")}
              </Label>
              <Input
                ref={fileInputRef}
                id="vocabulary-import-file"
                type="file"
                accept="application/json,.json"
                onChange={(e) =>
                  handleFileSelected(e.target.files?.[0] ?? null)
                }
                className="mt-2"
              />
              {pendingEntries ? (
                <p className="text-xs text-muted-foreground mt-2">
                  {t("settings.vocabulary.importDialog.pendingCount", {
                    count: pendingEntries.length,
                  })}
                </p>
              ) : null}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeImportFlow}>
              {t("settings.vocabulary.importDialog.cancel")}
            </Button>
            <Button
              onClick={handleImportSubmit}
              disabled={
                !pendingEntries ||
                pendingEntries.length === 0 ||
                importMutation.isPending
              }
            >
              {t("settings.vocabulary.importDialog.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!importResult}
        onOpenChange={(open) => {
          if (!open) closeImportFlow();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("settings.vocabulary.importResult.title")}
            </DialogTitle>
          </DialogHeader>
          {importResult ? (
            <div className="space-y-3">
              <p className="text-sm">
                {t("settings.vocabulary.importResult.summary", {
                  inserted: importResult.inserted,
                  updated: importResult.updated,
                  skipped: importResult.skipped.length,
                })}
              </p>
              {importResult.skipped.length > 0 ? (
                <Button
                  variant="outline"
                  onClick={handleDownloadSkipped}
                  className="flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  {t("settings.vocabulary.importResult.downloadSkipped", {
                    count: importResult.skipped.length,
                  })}
                </Button>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button onClick={closeImportFlow}>
              {t("settings.vocabulary.importResult.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
