import { useState } from "react";
import { Copy, ExternalLink } from "lucide-react";

export function VisitorLink({
  url,
  emulator = false,
}: {
  url: string;
  emulator?: boolean;
}) {
  const [message, setMessage] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setMessage(
        emulator
          ? "Link copied. Open it on this computer and select a visitor country."
          : "Link copied. Open it on your phone or share it for testing.",
      );
    } catch {
      setMessage(
        "Could not copy automatically. Select and copy the link above.",
      );
    }
  }
  return (
    <section className="visitor-preview" aria-label="Preview as a visitor">
      <h2>Preview as a visitor</h2>
      <p>
        {emulator
          ? "Open the local preview and choose a visitor country. The emulator uses that choice, not your IP or VPN."
          : "Open this link on your phone to see where someone who clicked your ad lands. Your country or VPN determines which page opens."}
      </p>
      <div className="visitor-link-controls">
        <input
          aria-label="Visitor link"
          readOnly
          value={url}
          onFocus={(event) => event.currentTarget.select()}
        />
        <a
          className="button primary"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink size={17} /> Open as visitor
        </a>
        <button
          type="button"
          className="button outline"
          onClick={() => void copy()}
        >
          <Copy size={17} /> Copy link
        </button>
      </div>
      {message && <p role="status">{message}</p>}
      <small>
        {emulator
          ? "Emulator links work on this computer. Sample destinations use the published weights; no real ads or leads are sent."
          : "Test link uses your connected Keitaro address. Visits appear in campaign statistics. Your selected campaign domain must also work before you launch ads."}
      </small>
    </section>
  );
}
