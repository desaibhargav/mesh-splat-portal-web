import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";

export function AppLayout() {
  const auth = useAuth();
  return (
    <div className="app-shell">
      <header className="site-header">
        <NavLink className="brand" to="/"><span>Digital Heritage</span> Mesh–Splat Portal</NavLink>
        <nav aria-label="Account"><button className="text-button" onClick={() => void auth.logout()}>Sign out</button></nav>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
