export interface AuthClient {
  getAccessToken(): Promise<string | null>;
  getSession(): Promise<{ authenticated: true; subject: string } | { authenticated: false }>;
  login(username: string, password: string): Promise<void>;
  logout(): Promise<void>;
}

export const browserSessionAuthClient: AuthClient = {
  async getAccessToken() {
    return null;
  },
  async getSession() {
    const response = await fetch("/api/v1/auth/session", { credentials: "same-origin" });
    if (response.status === 401) return { authenticated: false };
    if (!response.ok) throw new Error("Authentication status is unavailable.");
    return response.json();
  },
  async login(username, password) {
    const response = await fetch("/api/v1/auth/session", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    if (!response.ok) throw new Error("The username or password is incorrect.");
  },
  async logout() {
    const response = await fetch("/api/v1/auth/session", {
      method: "DELETE",
      credentials: "same-origin"
    });
    if (!response.ok) throw new Error("Sign out failed.");
  }
};
