import { useMemo, useState } from "react";
import { Loader2, Power, Plus } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  DictionaryMetaDialog,
  type MetaFormData,
} from "./components/dictionary-meta-dialog";

// Categories we surface as filter tabs. Anything not listed is grouped
// under "all". Keep the order stable for muscle memory.
const FILTER_CATEGORIES = [
  "all",
  "general",
  "developer",
  "creator",
  "professional",
] as const;

type FilterCategory = (typeof FILTER_CATEGORIES)[number];

const EMPTY_META: MetaFormData = {
  id: "",
  name: "",
  name_ja: "",
  description: "",
  description_ja: "",
  category: "general",
  tags: "",
};

export default function DictionaryLibrarySettingsPage() {
  const { t, i18n } = useTranslation();
  const utils = api.useUtils();
  const navigate = useNavigate();

  const [filter, setFilter] = useState<FilterCategory>("all");
  const [search, setSearch] = useState("");
  // Per-card busy state keyed by id, so clicks on two cards show
  // independent spinners.
  const [busyId, setBusyId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<MetaFormData>(EMPTY_META);

  const listQuery = api.dictionaryLibrary.list.useQuery();
  const editableQuery = api.dictionaryLibrary.editable.useQuery();
  const editable = editableQuery.data === true;

  // Activating/deactivating only flips an id in app_settings; the dictionary
  // contents are unioned into the ASR pipeline at dictation time. Nothing is
  // written to the vocabulary table, so only the library list needs refresh.
  const invalidate = () => {
    utils.dictionaryLibrary.list.invalidate();
  };

  const activateMutation = api.dictionaryLibrary.activateDictionary.useMutation(
    {
      onSuccess: (_res, vars) => {
        const meta = listQuery.data?.find((d) => d.id === vars.id);
        const name = meta ? localizedName(meta, i18n.language) : vars.id;
        toast.success(
          t("settings.dictionaryLibrary.toast.activated", { name }),
        );
        invalidate();
      },
      onError: (e) =>
        toast.error(
          t("settings.dictionaryLibrary.toast.failed", { message: e.message }),
        ),
      onSettled: () => setBusyId(null),
    },
  );

  const deactivateMutation =
    api.dictionaryLibrary.deactivateDictionary.useMutation({
      onSuccess: (_res, vars) => {
        const meta = listQuery.data?.find((d) => d.id === vars.id);
        const name = meta ? localizedName(meta, i18n.language) : vars.id;
        toast.success(
          t("settings.dictionaryLibrary.toast.deactivated", { name }),
        );
        invalidate();
      },
      onError: (e) =>
        toast.error(
          t("settings.dictionaryLibrary.toast.failed", { message: e.message }),
        ),
      onSettled: () => setBusyId(null),
    });

  const createMutation = api.dictionaryLibrary.createDictionary.useMutation({
    onSuccess: (meta) => {
      utils.dictionaryLibrary.list.invalidate();
      toast.success(
        t("settings.dictionaryLibrary.editor.toast.dictionaryCreated", {
          name: meta.name,
        }),
      );
      setCreateOpen(false);
      setCreateForm(EMPTY_META);
      navigate({
        to: "/settings/dictionary-library/$dictionaryId",
        params: { dictionaryId: meta.id },
      });
    },
    onError: (e) =>
      toast.error(
        t("settings.dictionaryLibrary.editor.toast.failed", {
          message: e.message,
        }),
      ),
  });

  const filtered = useMemo(() => {
    let all = listQuery.data ?? [];
    if (filter !== "all") all = all.filter((d) => d.category === filter);
    const q = search.trim().toLowerCase();
    if (q) {
      all = all.filter(
        (d) =>
          localizedName(d, i18n.language).toLowerCase().includes(q) ||
          d.name.toLowerCase().includes(q) ||
          d.tags.some((tag) => tag.toLowerCase().includes(q)),
      );
    }
    return all;
  }, [listQuery.data, filter, search, i18n.language]);

  const handleToggle = (id: string, currentlyActive: boolean) => {
    setBusyId(id);
    if (currentlyActive) {
      deactivateMutation.mutate({ id });
    } else {
      activateMutation.mutate({ id });
    }
  };

  const openDetail = (id: string) => {
    navigate({
      to: "/settings/dictionary-library/$dictionaryId",
      params: { dictionaryId: id },
    });
  };

  const handleCreate = () => {
    createMutation.mutate({
      id: createForm.id.trim(),
      name: createForm.name.trim(),
      name_ja: createForm.name_ja.trim() || undefined,
      description: createForm.description.trim(),
      description_ja: createForm.description_ja.trim() || undefined,
      category: createForm.category,
      language: "ja",
      tags: createForm.tags
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    });
  };

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">
            {t("settings.dictionaryLibrary.title")}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t("settings.dictionaryLibrary.description")}
          </p>
        </div>
        {editable ? (
          <Button
            className="shrink-0"
            onClick={() => {
              setCreateForm(EMPTY_META);
              setCreateOpen(true);
            }}
          >
            <Plus className="w-4 h-4 mr-1" />
            {t("settings.dictionaryLibrary.editor.createDictionary")}
          </Button>
        ) : null}
      </div>

      <div className="mb-4">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("settings.dictionaryLibrary.searchPlaceholder")}
          className="max-w-sm"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-6">
        {FILTER_CATEGORIES.map((c) => (
          <Button
            key={c}
            size="sm"
            variant={filter === c ? "default" : "outline"}
            onClick={() => setFilter(c)}
          >
            {t(`settings.dictionaryLibrary.filter.${c}`)}
          </Button>
        ))}
      </div>

      {listQuery.isLoading ? (
        <div className="text-muted-foreground text-sm flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          {t("settings.dictionaryLibrary.loading")}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-muted-foreground text-sm">
          {t(
            search.trim()
              ? "settings.dictionaryLibrary.noResults"
              : "settings.dictionaryLibrary.empty",
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((d) => {
            const name = localizedName(d, i18n.language);
            const description = localizedDescription(d, i18n.language);
            const isBusy = busyId === d.id;
            const isActive = d.state === "active";

            // Active cards get a primary-tinted border + faint background;
            // inactive cards are dimmed so the difference reads at a glance.
            // The whole card is clickable to open the detail/editor page.
            const cardCls = cn(
              "p-4 flex flex-col gap-3 transition-colors cursor-pointer hover:border-primary/40",
              isActive ? "border-primary/60 bg-primary/5" : "opacity-70",
            );

            return (
              <Card
                key={d.id}
                className={cardCls}
                onClick={() => openDetail(d.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {t("settings.dictionaryLibrary.card.entryCount", {
                        count: d.entryCount,
                      })}
                    </div>
                  </div>
                  <Badge
                    variant={isActive ? "default" : "outline"}
                    className="shrink-0"
                  >
                    {t(
                      isActive
                        ? "settings.dictionaryLibrary.card.state.active"
                        : "settings.dictionaryLibrary.card.state.inactive",
                    )}
                  </Badge>
                </div>

                <p className="text-xs text-muted-foreground line-clamp-3">
                  {description}
                </p>

                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                  {d.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="text-[10px]">
                      {tag}
                    </Badge>
                  ))}
                </div>

                <div className="flex items-center justify-end mt-auto pt-2">
                  <Button
                    size="sm"
                    variant={isActive ? "secondary" : "default"}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggle(d.id, isActive);
                    }}
                    disabled={isBusy}
                  >
                    {isBusy ? (
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    ) : (
                      <Power className="w-4 h-4 mr-1" />
                    )}
                    {t(
                      isActive
                        ? "settings.dictionaryLibrary.card.action.deactivate"
                        : "settings.dictionaryLibrary.card.action.activate",
                    )}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <DictionaryMetaDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        formData={createForm}
        onFormDataChange={setCreateForm}
        onSubmit={handleCreate}
        isLoading={createMutation.isPending}
      />
    </div>
  );
}

interface NameDescriptionRow {
  name: string;
  name_ja?: string;
  description: string;
  description_ja?: string;
}

function localizedName(d: NameDescriptionRow, locale: string): string {
  if (locale.startsWith("ja") && d.name_ja) return d.name_ja;
  return d.name;
}

function localizedDescription(d: NameDescriptionRow, locale: string): string {
  if (locale.startsWith("ja") && d.description_ja) return d.description_ja;
  return d.description;
}
