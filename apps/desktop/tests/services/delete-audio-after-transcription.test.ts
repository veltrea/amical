import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { createTestDatabase, type TestDatabase } from "../helpers/test-db";
import { setTestDatabase } from "../setup";
import { createTranscription, getTranscriptionById } from "@db/transcriptions";
import { TranscriptionService } from "@services/transcription-service";
import type { DeleteAudioAfterTranscriptionMode } from "@/constants/history-retention";

// deleteAudioFile only removes files under <temp>/amical-audio, and the
// electron mock maps app.getPath("temp") to os.tmpdir().
const AUDIO_DIR = path.join(os.tmpdir(), "amical-audio");

// Build a TranscriptionService without running its heavy constructor (which
// spins up Whisper/cloud providers). maybeDeleteAudioAfterTranscription only
// depends on this.settingsService, so we stub just that, like the other
// service tests do for HistoryCleanupService.
function makeService(mode: DeleteAudioAfterTranscriptionMode) {
  const service = Object.create(TranscriptionService.prototype);
  service.settingsService = {
    getHistorySettings: async () => ({
      retentionPeriod: "never",
      deleteAudioAfterTranscription: mode,
    }),
  };
  return service as {
    maybeDeleteAudioAfterTranscription: (
      id: number | undefined,
      filePath: string | undefined,
      wasSuccessful: boolean,
    ) => Promise<void>;
  };
}

describe("Delete audio after transcription", () => {
  let testDb: TestDatabase;
  const createdFiles: string[] = [];

  beforeEach(async () => {
    testDb = await createTestDatabase({
      name: "delete-audio-after-transcription-test",
    });
    setTestDatabase(testDb.db);
  });

  afterEach(async () => {
    await Promise.all(
      createdFiles.map((f) => fs.rm(f, { force: true }).catch(() => {})),
    );
    createdFiles.length = 0;
    if (testDb) await testDb.close();
  });

  async function makeAudioFile(): Promise<string> {
    await fs.mkdir(AUDIO_DIR, { recursive: true });
    const filePath = path.join(
      AUDIO_DIR,
      `audio-test-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`,
    );
    await fs.writeFile(filePath, "fake-wav-bytes");
    createdFiles.push(filePath);
    return filePath;
  }

  async function fileExists(p: string): Promise<boolean> {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  }

  // Drives the real deletion path the transcription pipeline calls.
  async function runDeletion(
    mode: DeleteAudioAfterTranscriptionMode,
    wasSuccessful: boolean,
  ): Promise<{ id: number; filePath: string }> {
    const filePath = await makeAudioFile();
    const row = await createTranscription({
      text: wasSuccessful ? "hello world" : "",
      audioFile: filePath,
    });

    await makeService(mode).maybeDeleteAudioAfterTranscription(
      row.id,
      filePath,
      wasSuccessful,
    );

    return { id: row.id, filePath };
  }

  it("mode 'off' keeps the audio file and the DB reference", async () => {
    const { id, filePath } = await runDeletion("off", true);
    expect(await fileExists(filePath)).toBe(true);
    const row = await getTranscriptionById(id);
    expect(row?.audioFile).toBe(filePath);
  });

  it("mode 'success-only' deletes audio on success and nulls the DB reference", async () => {
    const { id, filePath } = await runDeletion("success-only", true);
    expect(await fileExists(filePath)).toBe(false);
    const row = await getTranscriptionById(id);
    expect(row?.audioFile).toBeNull();
  });

  it("mode 'success-only' keeps audio when the transcription failed", async () => {
    const { id, filePath } = await runDeletion("success-only", false);
    expect(await fileExists(filePath)).toBe(true);
    const row = await getTranscriptionById(id);
    expect(row?.audioFile).toBe(filePath);
  });

  it("mode 'always' deletes audio even when the transcription failed", async () => {
    const { id, filePath } = await runDeletion("always", false);
    expect(await fileExists(filePath)).toBe(false);
    const row = await getTranscriptionById(id);
    expect(row?.audioFile).toBeNull();
  });
});
