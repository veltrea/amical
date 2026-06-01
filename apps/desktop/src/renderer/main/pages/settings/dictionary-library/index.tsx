import { useMemo, useState } from "react";
import { Check, Loader2, Power, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

// Categories we surface as filter tabs. SPEC §3.2 enumerates the known
// values; anything else (e.g. "professional" once we ship it) is grouped
// under "all". Keep the order stable for muscle memory.
const FILTER_CATEGORIES = [
  "all",
  "general",
  "developer",
  "creator",
  "professional",
] as const;

type FilterCategory = (typeof FILTER_CATEGORIES)[number];

interface PendingDelete {
  id: string;
  name: string;
  count: number;
}

export default function DictionaryLibrarySettingsPage() {
  const { t, i18n } = useTranslation();
  const utils = api.useUtils();

  const [filter, setFilter] = useState<FilterCategory>("all");
  // Per-card busy state. We key by id so spamming clicks across two cards
  // shows independent spinners.
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(
    null,
  );

  const listQuery = api.dictionaryLibrary.list.useQuery();

  const invalidate = () => {
    utils.dictionaryLibrary.list.invalidate();
    // The vocabulary table is the source of truth for both this list and
    // the regular vocabulary settings page; invalidate that one too so the
    // user sees the new rows immediately if they navigate.
    utils.vocabulary.getVocabulary.invalidate();
  };

  const applyMutation = api.dictionaryLibrary.applyDictionary.useMutation({
    onSuccess: (res, vars) => {
      const meta = listQuery.data?.find((d) => d.id === vars.id);
      const name = meta ? localizedName(meta, i18n.language) : vars.id;
      toast.success(
        t("settings.dictionaryLibrary.toast.applied", {
          name,
          inserted: res.inserted,
          skipped: res.skipped,
        }),
      );
      invalidate();
    },
    onError: (e) =>
      toast.error(
        t("settings.dictionaryLibrary.toast.applyFailed", { message: e.message }),
      ),
    onSettled: () => setBusyId(null),
  });

  const removeMutation = api.dictionaryLibrary.remove.useMutation({
    onSuccess: (res, vars) => {
      const meta = listQuery.data?.find((d) => d.id === vars.id);
      const name = meta ? localizedName(meta, i18n.language) : vars.id;
      toast.success(
        t("settings.dictionaryLibrary.toast.removed", {
          name,
          deleted: res.deleted,
        }),
      );
      invalidate();
    },
    onError: (e) =>
      toast.error(
        t("settings.dictionaryLibrary.toast.removeFailed", {
          message: e.message,
        }),
      ),
    onSettled: () => setBusyId(null),
  });

  const setActiveMutation = api.dictionaryLibrary.setActive.useMutation({
    onSuccess: (res, vars) => {
      const meta = listQuery.data?.find((d) => d.id === vars.id);
      const name = meta ? localizedName(meta, i18n.language) : vars.id;
      const key = vars.isActive
        ? "settings.dictionaryLibrary.toast.activated"
        : "settings.dictionaryLibrary.toast.deactivated";
      toast.success(t(key, { name, count: res.updated }));
      invalidate();
    },
    onError: (e) =>
      toast.error(
        t("settings.dictionaryLibrary.toast.setActiveFailed", {
          message: e.message,
        }),
      ),
    onSettled: () => setBusyId(null),
  });

  const filtered = useMemo(() => {
    const all = listQuery.data ?? [];
    if (filter === "all") return all;
    return all.filter((d) => d.category === filter);
  }, [listQuery.data, filter]);

  const handleApply = (id: string) => {
    setBusyId(id);
    applyMutation.mutate({ id });
  };

  const handleToggleActive = (id: string, nextActive: boolean) => {
    setBusyId(id);
    setActiveMutation.mutate({ id, isActive: nextActive });
  };

  const handleRequestRemove = (id: string, name: string, count: number) => {
    setPendingDelete({ id, name, count });
  };

  const handleConfirmRemove = () => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    setBusyId(id);
    removeMutation.mutate({ id });
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold">
          {t("settings.dictionaryLibrary.title")}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("settings.dictionaryLibrary.description")}
        </p>
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
          {t("settings.dictionaryLibrary.empty")}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((d) => {
            const name = localizedName(d, i18n.language);
            const description = localizedDescription(d, i18n.language);
            const isBusy = busyId === d.id;

            // Active cards get a primary-tinted border + faint background.
            // Inactive cards are dimmed so the difference is obvious at a
            // glance without relying on the action button label.
            const cardCls = cn(
              "p-4 flex flex-col gap-3 transition-colors",
              d.state === "active" &&
                "border-primary/60 bg-primary/5",
              d.state === "mixed" &&
                "border-primary/40 bg-primary/[0.03]",
              d.state === "inactive" && "opacity-60",
            );

            return (
              <Card key={d.id} className={cardCls}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {t("settings.dictionaryLibrary.card.entryCount", {
                        count: d.entryCount,
                      })}
                      {d.state !== "not-installed" && (
                        <>
                          {" · "}
                          {t(
                            "settings.dictionaryLibrary.card.activeEntries",
                            {
                              active: d.activeEntries,
                              total: d.installedEntries,
                            },
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  <StateBadge state={d.state} />
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

                <div className="flex items-center justify-end gap-2 mt-auto pt-2">
                  {d.state === "not-installed" ? (
                    <Button
                      size="sm"
                      onClick={() => handleApply(d.id)}
                      disabled={isBusy}
                    >
                      {isBusy ? (
                        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                      ) : (
                        <Check className="w-4 h-4 mr-1" />
                      )}
                      {t("settings.dictionaryLibrary.card.action.activate")}
                    </Button>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          handleRequestRemove(
                            d.id,
                            name,
                            d.installedEntries,
                          )
                        }
                        disabled={isBusy}
                      >
                        <Trash2 className="w-4 h-4 mr-1" />
                        {t("settings.dictionaryLibrary.card.action.delete")}
                      </Button>
                      <Button
                        size="sm"
                        variant={
                          d.state === "inactive" ? "default" : "secondary"
                        }
                        onClick={() =>
                          handleToggleActive(
                            d.id,
                            d.state === "inactive",
                          )
                        }
                        disabled={isBusy}
                      >
                        {isBusy ? (
                          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        ) : (
                          <Power className="w-4 h-4 mr-1" />
                        )}
                        {d.state === "inactive"
                          ? t("settings.dictionaryLibrary.card.action.enable")
                          : t("settings.dictionaryLibrary.card.action.disable")}
                      </Button>
                    </>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings.dictionaryLibrary.confirmDelete.title", {
                name: pendingDelete?.name ?? "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings.dictionaryLibrary.confirmDelete.message", {
                count: pendingDelete?.count ?? 0,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("settings.dictionaryLibrary.confirmDelete.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmRemove}>
              {t("settings.dictionaryLibrary.confirmDelete.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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

interface StateBadgeProps {
  state: "not-installed" | "active" | "inactive" | "mixed";
}

function StateBadge({ state }: StateBadgeProps) {
  const { t } = useTranslation();
  const variant: "default" | "secondary" | "outline" =
    state === "active"
      ? "default"
      : state === "mixed"
        ? "secondary"
        : "outline";
  const labelKey =
    state === "not-installed"
      ? "settings.dictionaryLibrary.card.state.notInstalled"
      : state === "active"
        ? "settings.dictionaryLibrary.card.state.active"
        : state === "inactive"
          ? "settings.dictionaryLibrary.card.state.inactive"
          : "settings.dictionaryLibrary.card.state.mixed";
  return (
    <Badge variant={variant} className="shrink-0">
      {t(labelKey)}
    </Badge>
  );
}
