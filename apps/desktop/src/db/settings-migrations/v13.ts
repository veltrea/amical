import type { AppSettingsData } from "../schema";
import {
  DEFAULT_DELETE_AUDIO_AFTER_TRANSCRIPTION,
  DEFAULT_HISTORY_RETENTION_PERIOD,
} from "../../constants/history-retention";

// v12 -> v13: add history.deleteAudioAfterTranscription with default "off"
export function migrateToV13(data: unknown): AppSettingsData {
  const oldData = data as AppSettingsData;
  const oldHistory = oldData.history;

  return {
    ...oldData,
    history: {
      retentionPeriod:
        oldHistory?.retentionPeriod ?? DEFAULT_HISTORY_RETENTION_PERIOD,
      deleteAudioAfterTranscription:
        oldHistory?.deleteAudioAfterTranscription ??
        DEFAULT_DELETE_AUDIO_AFTER_TRANSCRIPTION,
    },
  };
}
