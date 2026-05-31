import { createFileRoute } from "@tanstack/react-router";
import MisrecognitionSettingsPage from "../../../pages/settings/misrecognition";

export const Route = createFileRoute("/_app/settings/misrecognition")({
  component: MisrecognitionSettingsPage,
});
