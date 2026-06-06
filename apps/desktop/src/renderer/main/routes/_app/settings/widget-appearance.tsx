import { createFileRoute } from "@tanstack/react-router";
import WidgetAppearancePage from "../../../pages/settings/widget-appearance";

export const Route = createFileRoute("/_app/settings/widget-appearance")({
  component: WidgetAppearancePage,
});
