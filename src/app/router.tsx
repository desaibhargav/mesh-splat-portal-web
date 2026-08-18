import { lazy, Suspense } from "react";
import { createBrowserRouter } from "react-router-dom";
import { AppLayout } from "./AppLayout";
import { CatalogPage } from "../pages/CatalogPage";

const ViewerPage = lazy(() => import("../pages/ViewerPage").then((module) => ({ default: module.ViewerPage })));

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { path: "/", element: <CatalogPage /> },
      {
        path: "/artifacts/:artifactId",
        element: <Suspense fallback={<p className="page" role="status">Loading 3D viewer…</p>}><ViewerPage /></Suspense>
      }
    ]
  }
]);
