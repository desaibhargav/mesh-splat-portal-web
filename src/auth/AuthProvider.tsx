import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useState, type FormEvent, type PropsWithChildren } from "react";
import { browserSessionAuthClient } from "./AuthClient";

interface AuthContextValue {
  subject: string;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const session = useQuery({
    queryKey: ["auth-session"],
    queryFn: () => browserSessionAuthClient.getSession(),
    retry: false,
    staleTime: 60_000
  });

  if (session.isPending) return <div className="auth-status" role="status">Checking secure session…</div>;
  if (session.isError) return <div className="auth-status" role="alert">The artifact service is unavailable.</div>;
  if (!session.data.authenticated) return <LoginPanel onAuthenticated={() => session.refetch()} />;

  return (
    <AuthContext.Provider
      value={{
        subject: session.data.subject,
        async logout() {
          await browserSessionAuthClient.logout();
          await session.refetch();
        }
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("useAuth must be used inside AuthProvider.");
  return auth;
}

function LoginPanel({ onAuthenticated }: { onAuthenticated(): Promise<unknown> }) {
  const [username, setUsername] = useState("professor");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    try {
      await browserSessionAuthClient.login(username, password);
      await onAuthenticated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign in failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="login-title">
        <p className="eyebrow">Demonstration</p>
        <h1 id="login-title">Mesh–Splat Portal</h1>
        <p>Sign in with the temporary credentials supplied for this demonstration.</p>
        <form onSubmit={submit}>
          <label>Username<input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} /></label>
          <label>Password<input autoComplete="current-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button disabled={submitting} type="submit">{submitting ? "Signing in…" : "Sign in"}</button>
        </form>
      </section>
    </main>
  );
}
