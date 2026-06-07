import { useMemo, useState } from "react";
import {
  ArrowLeft,
  Plus,
  Edit,
  Trash2,
  MoveRight,
  Loader2,
  Settings2,
} from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { EntryDialog, type EntryFormData } from "./components/entry-dialog";
import {
  DictionaryMetaDialog,
  type MetaFormData,
} from "./components/dictionary-meta-dialog";

interface DictionaryDetailPageProps {
  dictionaryId: string;
}

const EMPTY_ENTRY: EntryFormData = {
  word: "",
  replacementWord: "",
  isReplacement: false,
};

const EMPTY_META: MetaFormData = {
  id: "",
  name: "",
  name_ja: "",
  description: "",
  description_ja: "",
  category: "general",
  tags: "",
};

export default function DictionaryDetailPage({
  dictionaryId,
}: DictionaryDetailPageProps) {
  const { t, i18n } = useTranslation();
  const utils = api.useUtils();
  const navigate = useNavigate();

  const entriesQuery = api.dictionaryLibrary.getEntries.useQuery({
    id: dictionaryId,
  });
  const editableQuery = api.dictionaryLibrary.editable.useQuery();
  const editable = editableQuery.data === true;

  const [search, setSearch] = useState("");

  // Entry add/edit dialog state.
  const [entryDialogOpen, setEntryDialogOpen] = useState(false);
  const [entryMode, setEntryMode] = useState<"add" | "edit">("add");
  const [entryForm, setEntryForm] = useState<EntryFormData>(EMPTY_ENTRY);
  const [editingOriginalWord, setEditingOriginalWord] = useState<string | null>(
    null,
  );
  const [deletingWord, setDeletingWord] = useState<string | null>(null);

  // Meta edit + delete-dictionary dialog state.
  const [metaOpen, setMetaOpen] = useState(false);
  const [metaForm, setMetaForm] = useState<MetaFormData>(EMPTY_META);
  const [deleteDictOpen, setDeleteDictOpen] = useState(false);

  const meta = entriesQuery.data?.meta;
  const entries = useMemo(
    () => entriesQuery.data?.entries ?? [],
    [entriesQuery.data],
  );

  const localizedName = (m: { name: string; name_ja?: string }) =>
    i18n.language.startsWith("ja") && m.name_ja ? m.name_ja : m.name;
  const localizedDescription = (m: {
    description: string;
    description_ja?: string;
  }) =>
    i18n.language.startsWith("ja") && m.description_ja
      ? m.description_ja
      : m.description;

  const invalidate = () => {
    utils.dictionaryLibrary.getEntries.invalidate({ id: dictionaryId });
    utils.dictionaryLibrary.list.invalidate();
  };

  const fail = (e: { message: string }) =>
    toast.error(
      t("settings.dictionaryLibrary.editor.toast.failed", {
        message: e.message,
      }),
    );

  const addMutation = api.dictionaryLibrary.addEntry.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success(t("settings.dictionaryLibrary.editor.toast.entryAdded"));
      setEntryDialogOpen(false);
    },
    onError: fail,
  });
  const updateMutation = api.dictionaryLibrary.updateEntry.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success(t("settings.dictionaryLibrary.editor.toast.entryUpdated"));
      setEntryDialogOpen(false);
    },
    onError: fail,
  });
  const deleteMutation = api.dictionaryLibrary.deleteEntry.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success(t("settings.dictionaryLibrary.editor.toast.entryDeleted"));
      setDeletingWord(null);
    },
    onError: fail,
  });
  const updateMetaMutation = api.dictionaryLibrary.updateMeta.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success(t("settings.dictionaryLibrary.editor.toast.metaUpdated"));
      setMetaOpen(false);
    },
    onError: fail,
  });
  const removeDictMutation = api.dictionaryLibrary.removeDictionary.useMutation({
    onSuccess: () => {
      utils.dictionaryLibrary.list.invalidate();
      toast.success(
        t("settings.dictionaryLibrary.editor.toast.dictionaryDeleted"),
      );
      navigate({ to: "/settings/dictionary-library" });
    },
    onError: fail,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        e.word.toLowerCase().includes(q) ||
        (e.replacementWord ?? "").toLowerCase().includes(q),
    );
  }, [entries, search]);

  const openAdd = () => {
    setEntryMode("add");
    setEntryForm(EMPTY_ENTRY);
    setEditingOriginalWord(null);
    setEntryDialogOpen(true);
  };

  const openEdit = (entry: {
    word: string;
    replacementWord: string | null;
    isReplacement: boolean;
  }) => {
    setEntryMode("edit");
    setEntryForm({
      word: entry.word,
      replacementWord: entry.replacementWord ?? "",
      isReplacement: entry.isReplacement,
    });
    setEditingOriginalWord(entry.word);
    setEntryDialogOpen(true);
  };

  const submitEntry = () => {
    const entry = {
      word: entryForm.word.trim(),
      replacementWord: entryForm.isReplacement
        ? entryForm.replacementWord.trim()
        : null,
      isReplacement: entryForm.isReplacement,
    };
    if (entryMode === "add") {
      addMutation.mutate({ id: dictionaryId, entry });
    } else if (editingOriginalWord != null) {
      updateMutation.mutate({
        id: dictionaryId,
        originalWord: editingOriginalWord,
        entry,
      });
    }
  };

  const openMeta = () => {
    if (!meta) return;
    setMetaForm({
      id: meta.id,
      name: meta.name,
      name_ja: meta.name_ja ?? "",
      description: meta.description,
      description_ja: meta.description_ja ?? "",
      category: meta.category,
      tags: meta.tags.join(", "),
    });
    setMetaOpen(true);
  };

  const submitMeta = () => {
    updateMetaMutation.mutate({
      id: dictionaryId,
      patch: {
        name: metaForm.name.trim(),
        name_ja: metaForm.name_ja.trim() || undefined,
        description: metaForm.description.trim(),
        description_ja: metaForm.description_ja.trim() || undefined,
        category: metaForm.category,
        tags: metaForm.tags
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      },
    });
  };

  const deletingEntry =
    deletingWord != null
      ? entries.find((e) => e.word === deletingWord)
      : undefined;

  return (
    <div>
      <div className="mb-6">
        <Link
          to="/settings/dictionary-library"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          {t("settings.dictionaryLibrary.detail.back")}
        </Link>

        <div className="flex items-start justify-between gap-2 mt-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold">
              {meta ? localizedName(meta) : dictionaryId}
            </h1>
            {meta ? (
              <p className="text-muted-foreground mt-1 text-sm">
                {localizedDescription(meta)}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              {meta?.tags.map((tag) => (
                <Badge key={tag} variant="outline" className="text-[10px]">
                  {tag}
                </Badge>
              ))}
            </div>
          </div>

          {editable && meta ? (
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="outline" size="sm" onClick={openMeta}>
                <Settings2 className="w-4 h-4 mr-1" />
                {t("settings.dictionaryLibrary.editor.editMeta")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDeleteDictOpen(true)}
              >
                <Trash2 className="w-4 h-4 mr-1 text-destructive" />
                {t("settings.dictionaryLibrary.editor.deleteDictionary")}
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      {!editable ? (
        <p className="text-muted-foreground text-xs mb-4">
          {t("settings.dictionaryLibrary.detail.readOnlyNote")}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-2 mb-4">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("settings.dictionaryLibrary.detail.searchPlaceholder")}
          className="max-w-sm"
        />
        {editable ? (
          <Button onClick={openAdd}>
            <Plus className="w-4 h-4 mr-1" />
            {t("settings.dictionaryLibrary.editor.addEntry")}
          </Button>
        ) : null}
      </div>

      <Card className="p-0 overflow-clip">
        <CardContent className="p-0">
          {entriesQuery.isLoading ? (
            <div className="p-8 text-center text-muted-foreground flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t("settings.dictionaryLibrary.detail.loading")}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              {t(
                search.trim()
                  ? "settings.dictionaryLibrary.detail.noResults"
                  : "settings.dictionaryLibrary.detail.empty",
              )}
            </div>
          ) : (
            <div className="space-y-0">
              {filtered.map((entry, index) => (
                <div
                  key={entry.word}
                  className="hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center justify-between py-3 px-4 group">
                    <span className="text-sm flex items-center gap-1 min-w-0">
                      {entry.isReplacement ? (
                        <>
                          <span className="truncate">{entry.word}</span>
                          <MoveRight className="w-4 h-4 mx-2 shrink-0" />
                          <span className="truncate">
                            {entry.replacementWord}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="truncate">{entry.word}</span>
                          <Badge
                            variant="outline"
                            className="ml-2 text-[10px] shrink-0"
                          >
                            {t(
                              "settings.dictionaryLibrary.detail.registeredWord",
                            )}
                          </Badge>
                        </>
                      )}
                    </span>
                    {editable ? (
                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEdit(entry)}
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeletingWord(entry.word)}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  {index < filtered.length - 1 && (
                    <div className="border-t border-border" />
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <EntryDialog
        open={entryDialogOpen}
        onOpenChange={setEntryDialogOpen}
        mode={entryMode}
        formData={entryForm}
        onFormDataChange={setEntryForm}
        onSubmit={submitEntry}
        isLoading={addMutation.isPending || updateMutation.isPending}
      />

      <Dialog
        open={deletingWord != null}
        onOpenChange={(open) => {
          if (!open) setDeletingWord(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("settings.dictionaryLibrary.editor.deleteConfirmTitle")}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t("settings.dictionaryLibrary.editor.deleteConfirmBody", {
              item: deletingEntry?.isReplacement
                ? `${deletingEntry?.word} → ${deletingEntry?.replacementWord}`
                : deletingEntry?.word,
            })}
          </p>
          <DialogFooter className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setDeletingWord(null)}>
              {t("settings.dictionaryLibrary.editor.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                deletingWord != null &&
                deleteMutation.mutate({ id: dictionaryId, word: deletingWord })
              }
              disabled={deleteMutation.isPending}
            >
              {t("settings.dictionaryLibrary.editor.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DictionaryMetaDialog
        open={metaOpen}
        onOpenChange={setMetaOpen}
        mode="edit"
        formData={metaForm}
        onFormDataChange={setMetaForm}
        onSubmit={submitMeta}
        isLoading={updateMetaMutation.isPending}
      />

      <Dialog open={deleteDictOpen} onOpenChange={setDeleteDictOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("settings.dictionaryLibrary.editor.deleteDictionaryTitle")}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t("settings.dictionaryLibrary.editor.deleteDictionaryBody", {
              name: meta ? localizedName(meta) : dictionaryId,
            })}
          </p>
          <DialogFooter className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setDeleteDictOpen(false)}>
              {t("settings.dictionaryLibrary.editor.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => removeDictMutation.mutate({ id: dictionaryId })}
              disabled={removeDictMutation.isPending}
            >
              {t("settings.dictionaryLibrary.editor.deleteDictionary")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
