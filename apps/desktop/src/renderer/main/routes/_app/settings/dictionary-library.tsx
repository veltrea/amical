import { createFileRoute } from "@tanstack/react-router";
import DictionaryLibrarySettingsPage from "../../../pages/settings/dictionary-library";

export const Route = createFileRoute("/_app/settings/dictionary-library")({
  component: DictionaryLibrarySettingsPage,
});
