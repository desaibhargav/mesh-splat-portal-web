import { NavLink, Outlet } from "react-router-dom";

export function AppLayout() {
  return (
    <div className="app-shell">
      <header className="site-header">
        <NavLink className="brand" to="/"><span>Digital Heritage</span> Mesh–Splat Portal</NavLink>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
