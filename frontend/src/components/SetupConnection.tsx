import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { api, errorText } from "../api";
import type { AppMode } from "../types";

type Connection = {
  configured: boolean;
  url: string;
  setup_token?: string;
  mode?: string;
};
const connectionMode = (connection: Connection): AppMode =>
  connection.mode === "demo" || connection.mode === "emulator"
    ? connection.mode
    : "live";

export function SetupConnection({
  onConnected,
}: {
  onConnected: (mode: AppMode) => void;
}) {
  const [url, setUrl] = useState("https://tlgk.host");
  const [key, setKey] = useState("");
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<Connection>("/connection", {
      signal: controller.signal,
    })
      .then((connection) => {
        if (controller.signal.aborted) return;
        if (connection.configured) onConnected(connectionMode(connection));
        else {
          setUrl(connection.url);
          setToken(connection.setup_token || "");
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorText(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [onConnected, retry]);

  async function connect(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const connection = await api<Connection>("/connection", {
        method: "POST",
        headers: { "X-Setup-Token": token },
        body: JSON.stringify({ url, api_key: key }),
      });
      setKey("");
      onConnected(connectionMode(connection));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <strong>Adrobot</strong>
        <span>Keitaro campaign editor</span>
      </header>
      <main className="setup-page">
        <section className="setup-card" aria-labelledby="setup-heading">
          <div className="setup-icon">
            <KeyRound size={24} />
          </div>
          <h1 id="setup-heading">Connect to Keitaro</h1>
          <p className="muted">
            One quick setup, then you’re ready to edit campaigns.
          </p>
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          {loading ? (
            <p role="status">Checking connection…</p>
          ) : !token ? (
            <button
              className="button outline"
              onClick={() => setRetry((n) => n + 1)}
            >
              Retry
            </button>
          ) : (
            <form onSubmit={(e) => void connect(e)} className="setup-form">
              <label htmlFor="keitaro-url">Keitaro URL</label>
              <input
                id="keitaro-url"
                type="url"
                value={url}
                required
                disabled={busy}
                onChange={(e) => setUrl(e.target.value)}
                aria-describedby="url-help"
              />
              <p id="url-help" className="muted">
                <a
                  href="https://tlgk.host/admin/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Open test Keitaro ↗
                </a>
                . This address is already filled in. A full /admin/ URL also
                works.
              </p>
              <label htmlFor="keitaro-key">Admin API key</label>
              <input
                id="keitaro-key"
                type="password"
                value={key}
                required
                disabled={busy}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setKey(e.target.value)}
                aria-describedby="key-help"
              />
              <p id="key-help" className="muted">
                In Keitaro: account icon → Account → API keys. Copy the existing
                key here. This is not your login password.{" "}
                <a
                  href="https://docs.keitaro.io/en/team-management/admin-api-keys.html"
                  target="_blank"
                  rel="noreferrer"
                >
                  Show instructions ↗
                </a>
              </p>
              <button
                className="button primary"
                type="submit"
                disabled={busy || !key.trim()}
              >
                {busy ? "Connecting…" : "Connect"}
              </button>
              <p className="setup-footnote muted">
                Saved on this server. You won’t need to enter it again.
              </p>
            </form>
          )}
        </section>
      </main>
    </div>
  );
}
