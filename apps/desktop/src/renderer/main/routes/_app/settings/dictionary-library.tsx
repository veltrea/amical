import { createFileRoute, Outlet } from "@tanstack/react-router";

// Layout route for the dictionary library section. The list lives in
// `dictionary-library.index.tsx` and the detail/editor in
// `dictionary-library.$dictionaryId.tsx`; this parent just renders the matched
// child. Mirrors the notes.tsx / notes.index.tsx / notes.$noteId.tsx split.
export const Route = createFileRoute("/_app/settings/dictionary-library")({
  component: () => <Outlet />,
});
