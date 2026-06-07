import { createFileRoute } from "@tanstack/react-router";
import DictionaryDetailPage from "../../../pages/settings/dictionary-library/detail";

export const Route = createFileRoute(
  "/_app/settings/dictionary-library/$dictionaryId",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { dictionaryId } = Route.useParams();
  return <DictionaryDetailPage dictionaryId={dictionaryId} />;
}
