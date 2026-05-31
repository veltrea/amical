import { useEffect, useMemo, useState } from "react";
import { Trash2, RefreshCw, RotateCcw, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

type DetectorDescriptor = {
  id: string;
  category: "rule" | "morph" | "statistical" | "phonetic" | "llm";
  labelKey: string;
  descriptionKey: string;
  requiresMorph: boolean;
  requiresMlx: boolean;
  estimatedDuration: "fast" | "medium" | "slow";
  defaultEnabled: boolean;
};

type Candidate = {
  id: number;
  word: string;
  normalizedKey: string;
  occurrenceCount: number;
  lastSeenAt: Date;
  detectorIds: string[];
};

const CATEGORY_ORDER: DetectorDescriptor["category"][] = [
  "rule",
  "morph",
  "statistical",
  "phonetic",
  "llm",
];

export default function MisrecognitionSettingsPage() {
  const { t } = useTranslation();
  const utils = api.useUtils();

  const [groupByReading, setGroupByReading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [draftReplacements, setDraftReplacements] = useState<
    Record<number, string>
  >({});
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkValue, setBulkValue] = useState("");
  const [selectedDetectors, setSelectedDetectors] = useState<Set<string>>(
    new Set(),
  );
  const [searchWord, setSearchWord] = useState("");
  const [searchReading, setSearchReading] = useState("");
  const [sortBy, setSortBy] = useState<
    "occurrenceCount" | "detectorCount" | "lastSeenAt" | "word"
  >("detectorCount");

  const detectorsQuery = api.misrecognition.listDetectors.useQuery();

  // Initialize selectedDetectors from defaultEnabled once detectors load.
  useEffect(() => {
    if (!detectorsQuery.data) return;
    setSelectedDetectors((prev) => {
      if (prev.size > 0) return prev;
      return new Set(
        detectorsQuery.data
          .filter((d) => d.defaultEnabled)
          .map((d) => d.id),
      );
    });
  }, [detectorsQuery.data]);

  const candidatesQuery = api.misrecognition.listCandidates.useQuery({
    limit: 100,
    offset: 0,
    sortBy,
    sortOrder: sortBy === "word" ? "asc" : "desc",
    groupByNormalizedKey: groupByReading,
    searchWord: searchWord.trim() || undefined,
    searchReading: searchReading.trim() || undefined,
  });

  const scanStatusQuery = api.misrecognition.getScanStatus.useQuery();

  const invalidateAll = () => {
    utils.misrecognition.listCandidates.invalidate();
    utils.misrecognition.getScanStatus.invalidate();
    utils.misrecognition.countCandidates.invalidate();
    utils.vocabulary.getVocabulary.invalidate();
  };

  const scanMutation = api.misrecognition.scanNow.useMutation({
    onSuccess: (res) => {
      invalidateAll();
      toast.success(
        t("settings.misrecognition.toast.scanComplete", {
          scanned: res.scannedTranscriptions,
          inserted: res.inserted,
          updated: res.updated,
        }),
      );
    },
    onError: (e) =>
      toast.error(
        t("settings.misrecognition.toast.scanFailed", { message: e.message }),
      ),
  });

  const triggerScan = (fullRescan: boolean) => {
    if (selectedDetectors.size === 0) {
      toast.error(t("settings.misrecognition.toast.noDetectorsSelected"));
      return;
    }
    scanMutation.mutate({
      fullRescan,
      detectorIds: [...selectedDetectors],
    });
  };

  const dismissMutation = api.misrecognition.dismissCandidates.useMutation({
    onSuccess: () => {
      invalidateAll();
      setSelectedIds(new Set());
    },
    onError: (e) =>
      toast.error(
        t("settings.misrecognition.toast.dismissFailed", {
          message: e.message,
        }),
      ),
  });

  const registerMutation = api.misrecognition.registerCandidate.useMutation({
    onSuccess: () => {
      invalidateAll();
      toast.success(t("settings.misrecognition.toast.registered"));
    },
    onError: (e) =>
      toast.error(
        t("settings.misrecognition.toast.registerFailed", {
          message: e.message,
        }),
      ),
  });

  const bulkMutation = api.misrecognition.bulkRegisterCandidates.useMutation({
    onSuccess: (res) => {
      invalidateAll();
      setSelectedIds(new Set());
      setBulkOpen(false);
      setBulkValue("");
      toast.success(
        t("settings.misrecognition.toast.bulkRegistered", {
          registered: res.registered,
          skipped: res.skipped,
        }),
      );
    },
    onError: (e) =>
      toast.error(
        t("settings.misrecognition.toast.registerFailed", {
          message: e.message,
        }),
      ),
  });

  const flatRows: Candidate[] = useMemo(() => {
    const data = candidatesQuery.data;
    if (!data) return [];
    if (data.mode === "flat") return data.rows as Candidate[];
    return data.groups.flatMap((g) => g.members as Candidate[]);
  }, [candidatesQuery.data]);

  const visibleIds = useMemo(() => flatRows.map((r) => r.id), [flatRows]);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));

  const toggleId = (id: number, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleAllVisible = (checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of visibleIds) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const toggleDetector = (id: string, checked: boolean) => {
    setSelectedDetectors((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const setAllDetectors = (mode: "all" | "default") => {
    if (!detectorsQuery.data) return;
    if (mode === "all") {
      setSelectedDetectors(new Set(detectorsQuery.data.map((d) => d.id)));
    } else {
      setSelectedDetectors(
        new Set(
          detectorsQuery.data
            .filter((d) => d.defaultEnabled)
            .map((d) => d.id),
        ),
      );
    }
  };

  const handleRegisterOne = (id: number) => {
    const v = (draftReplacements[id] ?? "").trim();
    if (!v) {
      toast.error(t("settings.misrecognition.toast.emptyReplacement"));
      return;
    }
    registerMutation.mutate({ id, replacementWord: v });
  };

  const handleDismissOne = (id: number) => {
    dismissMutation.mutate({ ids: [id] });
  };

  const handleBulkDismiss = () => {
    if (selectedIds.size === 0) return;
    dismissMutation.mutate({ ids: [...selectedIds] });
  };

  const handleOpenBulk = () => {
    if (selectedIds.size === 0) return;
    setBulkOpen(true);
  };

  const handleBulkSubmit = () => {
    const v = bulkValue.trim();
    if (!v) {
      toast.error(t("settings.misrecognition.toast.emptyReplacement"));
      return;
    }
    bulkMutation.mutate({ ids: [...selectedIds], replacementWord: v });
  };

  const lastScanAt = scanStatusQuery.data?.lastScanAt;
  const lastScanLabel = lastScanAt
    ? new Date(lastScanAt).toLocaleString()
    : t("settings.misrecognition.neverScanned");

  // Group detectors by category for the panel.
  const detectorsByCategory = useMemo(() => {
    const groups: Record<string, DetectorDescriptor[]> = {};
    for (const d of (detectorsQuery.data as DetectorDescriptor[] | undefined) ?? []) {
      const arr = groups[d.category] ?? [];
      arr.push(d);
      groups[d.category] = arr;
    }
    return groups;
  }, [detectorsQuery.data]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">
            {t("settings.misrecognition.title")}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t("settings.misrecognition.description")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => triggerScan(false)}
            disabled={scanMutation.isPending}
            className="flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            {t("settings.misrecognition.scan")}
          </Button>
          <Button
            variant="outline"
            onClick={() => triggerScan(true)}
            disabled={scanMutation.isPending}
            className="flex items-center gap-2"
          >
            <RotateCcw className="w-4 h-4" />
            {t("settings.misrecognition.scanAll")}
          </Button>
        </div>
      </div>

      <Card className="mb-4">
        <CardContent className="p-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h2 className="text-sm font-semibold">
                {t("settings.misrecognition.detectorPanel.title")}
              </h2>
              <p className="text-xs text-muted-foreground mt-1">
                {t("settings.misrecognition.detectorPanel.description")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setAllDetectors("all")}
              >
                {t("settings.misrecognition.detectorPanel.selectAll")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setAllDetectors("default")}
              >
                {t("settings.misrecognition.detectorPanel.resetDefaults")}
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
            {CATEGORY_ORDER.filter((cat) => detectorsByCategory[cat]).map(
              (cat) => (
                <div key={cat}>
                  <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                    {t(`settings.misrecognition.detectorCategory.${cat}`)}
                  </h3>
                  <div className="space-y-2">
                    {detectorsByCategory[cat].map((d) => (
                      <label
                        key={d.id}
                        className="flex items-start gap-2 cursor-pointer"
                      >
                        <Checkbox
                          checked={selectedDetectors.has(d.id)}
                          onCheckedChange={(c) =>
                            toggleDetector(d.id, c === true)
                          }
                          className="mt-0.5"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-sm">{t(d.labelKey)}</span>
                            <Badge variant="outline" className="text-xs">
                              {t(
                                `settings.misrecognition.detectorPanel.${d.estimatedDuration}`,
                              )}
                            </Badge>
                            {d.requiresMlx ? (
                              <Badge variant="secondary" className="text-xs">
                                {t(
                                  "settings.misrecognition.detectorPanel.requiresMlx",
                                )}
                              </Badge>
                            ) : null}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {t(d.descriptionKey)}
                          </p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              ),
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Input
          value={searchWord}
          onChange={(e) => setSearchWord(e.target.value)}
          placeholder={t("settings.misrecognition.search.wordPlaceholder")}
          className="max-w-xs"
        />
        <Input
          value={searchReading}
          onChange={(e) => setSearchReading(e.target.value)}
          placeholder={t("settings.misrecognition.search.readingPlaceholder")}
          className="max-w-xs"
        />
        <div className="flex items-center gap-2 ml-auto">
          <Label className="text-xs text-muted-foreground">
            {t("settings.misrecognition.sortBy.label")}
          </Label>
          <Select
            value={sortBy}
            onValueChange={(v) => setSortBy(v as typeof sortBy)}
          >
            <SelectTrigger className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="detectorCount">
                {t("settings.misrecognition.sortBy.detectorCount")}
              </SelectItem>
              <SelectItem value="occurrenceCount">
                {t("settings.misrecognition.sortBy.occurrenceCount")}
              </SelectItem>
              <SelectItem value="lastSeenAt">
                {t("settings.misrecognition.sortBy.lastSeenAt")}
              </SelectItem>
              <SelectItem value="word">
                {t("settings.misrecognition.sortBy.word")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center justify-between mb-3 text-sm">
        <div className="flex items-center gap-4">
          <Checkbox
            checked={allVisibleSelected}
            onCheckedChange={(c) => toggleAllVisible(c === true)}
            aria-label={t("settings.misrecognition.selectAll")}
          />
          <span className="text-muted-foreground">
            {t("settings.misrecognition.selectedCount", {
              count: selectedIds.size,
            })}
          </span>
          <div className="flex items-center gap-2">
            <Label htmlFor="group-by-reading" className="text-muted-foreground">
              {t("settings.misrecognition.groupByReading")}
            </Label>
            <Switch
              id="group-by-reading"
              checked={groupByReading}
              onCheckedChange={setGroupByReading}
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {t("settings.misrecognition.lastScan", { value: lastScanLabel })}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleBulkDismiss}
            disabled={selectedIds.size === 0 || dismissMutation.isPending}
          >
            <Trash2 className="w-4 h-4 mr-1" />
            {t("settings.misrecognition.dismissSelected")}
          </Button>
          <Button
            size="sm"
            onClick={handleOpenBulk}
            disabled={selectedIds.size === 0}
          >
            {t("settings.misrecognition.bulkRegister")}
          </Button>
        </div>
      </div>

      <Card className="p-0 overflow-clip">
        <CardContent className="p-0">
          {candidatesQuery.isLoading ? (
            <div className="p-8 text-center text-muted-foreground">
              {t("settings.misrecognition.loading")}
            </div>
          ) : flatRows.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              {t("settings.misrecognition.empty")}
            </div>
          ) : candidatesQuery.data?.mode === "grouped" ? (
            <div>
              {candidatesQuery.data.groups.map((group, gi) => (
                <div
                  key={group.normalizedKey}
                  className={gi > 0 ? "border-t border-border" : ""}
                >
                  <div className="px-4 py-2 bg-muted/40 text-xs text-muted-foreground">
                    {t("settings.misrecognition.readingGroup", {
                      key: group.normalizedKey,
                      total: group.totalOccurrences,
                    })}
                  </div>
                  {(group.members as Candidate[]).map((c) => (
                    <CandidateRow
                      key={c.id}
                      candidate={c}
                      checked={selectedIds.has(c.id)}
                      draft={draftReplacements[c.id] ?? ""}
                      onCheck={(b) => toggleId(c.id, b)}
                      onDraftChange={(v) =>
                        setDraftReplacements((p) => ({ ...p, [c.id]: v }))
                      }
                      onRegister={() => handleRegisterOne(c.id)}
                      onDismiss={() => handleDismissOne(c.id)}
                      busy={registerMutation.isPending}
                    />
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div>
              {flatRows.map((c, i) => (
                <div
                  key={c.id}
                  className={i > 0 ? "border-t border-border" : ""}
                >
                  <CandidateRow
                    candidate={c}
                    checked={selectedIds.has(c.id)}
                    draft={draftReplacements[c.id] ?? ""}
                    onCheck={(b) => toggleId(c.id, b)}
                    onDraftChange={(v) =>
                      setDraftReplacements((p) => ({ ...p, [c.id]: v }))
                    }
                    onRegister={() => handleRegisterOne(c.id)}
                    onDismiss={() => handleDismissOne(c.id)}
                    busy={registerMutation.isPending}
                  />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("settings.misrecognition.bulkDialog.title")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("settings.misrecognition.bulkDialog.description", {
                count: selectedIds.size,
              })}
            </p>
            <div>
              <Label htmlFor="bulk-replacement">
                {t("settings.misrecognition.bulkDialog.replacementLabel")}
              </Label>
              <Input
                id="bulk-replacement"
                value={bulkValue}
                onChange={(e) => setBulkValue(e.target.value)}
                placeholder={t(
                  "settings.misrecognition.bulkDialog.placeholder",
                )}
                className="mt-2"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)}>
              {t("settings.misrecognition.bulkDialog.cancel")}
            </Button>
            <Button
              onClick={handleBulkSubmit}
              disabled={bulkMutation.isPending || !bulkValue.trim()}
            >
              {t("settings.misrecognition.bulkDialog.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface RowProps {
  candidate: Candidate;
  checked: boolean;
  draft: string;
  onCheck: (b: boolean) => void;
  onDraftChange: (v: string) => void;
  onRegister: () => void;
  onDismiss: () => void;
  busy?: boolean;
}

function CandidateRow({
  candidate,
  checked,
  draft,
  onCheck,
  onDraftChange,
  onRegister,
  onDismiss,
  busy,
}: RowProps) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3 py-2 px-4 hover:bg-muted/50 transition-colors group">
      <Checkbox
        checked={checked}
        onCheckedChange={(c) => onCheck(c === true)}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm">{candidate.word}</span>
          <span className="text-xs text-muted-foreground">
            ×{candidate.occurrenceCount}
          </span>
          {candidate.detectorIds.map((id) => (
            <Badge key={id} variant="outline" className="text-[10px] py-0">
              {t(`settings.misrecognition.detector.${id}.label`, {
                defaultValue: id,
              })}
            </Badge>
          ))}
        </div>
      </div>
      <Input
        className="w-48"
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        placeholder={t("settings.misrecognition.replacementPlaceholder")}
        onKeyDown={(e) => {
          if (e.key === "Enter") onRegister();
        }}
      />
      <Button
        size="sm"
        variant="outline"
        onClick={onRegister}
        disabled={busy || !draft.trim()}
        title={t("settings.misrecognition.register")}
      >
        <Check className="w-4 h-4" />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={onDismiss}
        title={t("settings.misrecognition.dismiss")}
      >
        <Trash2 className="w-4 h-4 text-destructive" />
      </Button>
    </div>
  );
}
