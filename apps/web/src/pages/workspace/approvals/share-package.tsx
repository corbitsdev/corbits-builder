/** The form that adds reviewers to an approval package's round. */
import {
  useSharePackage,
  type SharePackageProps,
} from "./share-package.model.ts";
import { SharePackageView } from "./share-package.view.tsx";

export function SharePackageDialog(props: SharePackageProps) {
  return <SharePackageView {...useSharePackage(props)} />;
}
