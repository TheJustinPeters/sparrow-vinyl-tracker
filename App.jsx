import { useState, useEffect, useRef } from "react";

const SUPABASE_URL = "https://epnioudjbmodukgayupl.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVwbmlvdWRqYm1vZHVrZ2F5dXBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwNTMxODksImV4cCI6MjA4OTYyOTE4OX0.ls19ACjUbyf_mANOd83PiszDgURnRVD1tskeJSkDw_w";

// ── Anthropic proxy (Supabase Edge Function) ──────────────────────────────────
// AI calls route through the Edge Function so the API key stays server-side.
const ANTHROPIC_PROXY_URL = `${SUPABASE_URL}/functions/v1/anthropic-proxy`;

// ── Auth ──────────────────────────────────────────────────────────
const authApi = {
  async signIn(email, password) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error_description || data.msg || "Sign in failed");
    return data;
  },
  async signOut(token) {
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    });
  },
  async refresh(refreshToken) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error("Session expired");
    return data;
  },
};

// ── DB ────────────────────────────────────────────────────────────
function makeDb(token) {
  const h = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  return {
    async get(table) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&order=created_at.asc`, { headers: h });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    async insert(table, row) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, { method: "POST", headers: { ...h, Prefer: "return=representation" }, body: JSON.stringify(row) });
      if (!res.ok) throw new Error(await res.text());
      return (await res.json())[0];
    },
    async update(table, id, row) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, { method: "PATCH", headers: { ...h, Prefer: "return=representation" }, body: JSON.stringify(row) });
      if (!res.ok) throw new Error(await res.text());
      return (await res.json())[0];
    },
    async remove(table, id) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, { method: "DELETE", headers: h });
      if (!res.ok) throw new Error(await res.text());
    },
    async uploadImage(file) {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const res = await fetch(`${SUPABASE_URL}/storage/v1/object/record-images/${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY, "Content-Type": file.type || "image/jpeg" },
        body: file,
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || "Upload failed"); }
      return `${SUPABASE_URL}/storage/v1/object/public/record-images/${path}`;
    },
  };
}

const GENRES = ["Jazz", "Soul", "R&B", "Blues", "Classical", "Rock", "Folk", "Bossa Nova", "Funk", "Electronic", "World", "Pop", "Country", "Other"];

// ── Shared UI ─────────────────────────────────────────────────────
function Badge({ children, color }) {
  const s = { home: { background: "#2d4a3e", color: "#a8d5b5" }, sparrow: { background: "#4a2d35", color: "#d5a8b5" }, recent: { background: "#2d3a4a", color: "#a8bcd5" } };
  return <span style={{ display: "inline-block", padding: "2px 10px", borderRadius: "20px", fontSize: "11px", fontWeight: "600", letterSpacing: "0.05em", textTransform: "uppercase", ...(s[color] || { background: "#333", color: "#ccc" }) }}>{children}</span>;
}
function b(bg, color, x = {}) { return { background: bg, color, border: "none", borderRadius: "6px", padding: "6px 12px", fontSize: "12px", fontWeight: "600", cursor: "pointer", ...x }; }
const inp = { width: "100%", background: "#111", border: "1px solid #2e2e2e", borderRadius: "8px", padding: "10px 12px", color: "#f0e6d3", fontSize: "14px", boxSizing: "border-box", outline: "none" };

function Modal({ title, onClose, children }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "20px" }} onClick={onClose}>
      <div style={{ background: "#1a1a1a", border: "1px solid #333", borderRadius: "16px", padding: "28px", maxWidth: "540px", width: "100%", maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
          <h2 style={{ fontFamily: "'Playfair Display',serif", color: "#f0e6d3", margin: 0, fontSize: "20px" }}>{title}</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#555", fontSize: "20px", cursor: "pointer" }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return <div style={{ marginBottom: "14px" }}><label style={{ display: "block", fontSize: "11px", fontWeight: "600", color: "#5a4a3a", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "6px" }}>{label}</label>{children}</div>;
}

function Spinner({ message = "Loading..." }) {
  return <div style={{ textAlign: "center", padding: "60px 20px" }}><style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style><div style={{ fontSize: "36px", display: "inline-block", animation: "spin 2s linear infinite", marginBottom: "12px" }}>💿</div><div style={{ fontSize: "13px", color: "#c9a96e" }}>{message}</div></div>;
}

function ErrorBanner({ message, onRetry }) {
  return <div style={{ background: "#2a1818", border: "1px solid #4a2a2a", borderRadius: "10px", padding: "16px", margin: "16px 0", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}><div style={{ fontSize: "13px", color: "#d5a8a8" }}>⚠️ {message}</div>{onRetry && <button onClick={onRetry} style={b("#4a2a2a", "#d5a8a8")}>Retry</button>}</div>;
}

// ── Login ─────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const submit = async () => {
    if (!email || !password) return;
    setLoading(true); setError(null);
    try { onLogin(await authApi.signIn(email, password)); }
    catch (e) { setError(e.message); }
    setLoading(false);
  };
  return (
    <div style={{ minHeight: "100vh", background: "#111", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", fontFamily: "'DM Sans','Helvetica Neue',sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700;900&family=DM+Sans:wght@300;400;500;600&display=swap'); *{box-sizing:border-box;} input:focus{border-color:#c9a96e!important;}`}</style>
      <div style={{ width: "100%", maxWidth: "380px" }}>
        <div style={{ textAlign: "center", marginBottom: "40px" }}>
          <div style={{ fontSize: "48px", marginBottom: "12px" }}>🍷</div>
          <div style={{ fontSize: "11px", fontWeight: "600", color: "#c9a96e", letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: "6px" }}>Sparrow Wine Bar · Orlando</div>
          <h1 style={{ fontFamily: "'Playfair Display',serif", fontSize: "32px", fontWeight: "900", margin: 0, background: "linear-gradient(135deg,#f0e6d3,#c9a96e)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Vinyl Tracker</h1>
        </div>
        <div style={{ background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: "16px", padding: "28px" }}>
          <h2 style={{ fontFamily: "'Playfair Display',serif", color: "#f0e6d3", fontSize: "18px", margin: "0 0 20px" }}>Sign In</h2>
          {error && <div style={{ background: "#2a1818", border: "1px solid #4a2a2a", borderRadius: "8px", padding: "10px 12px", marginBottom: "16px", fontSize: "13px", color: "#d5a8a8" }}>{error}</div>}
          <Field label="Email"><input style={inp} type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} autoFocus /></Field>
          <Field label="Password"><input style={inp} type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} /></Field>
          <button onClick={submit} disabled={loading} style={{ width: "100%", padding: "13px", marginTop: "6px", background: "linear-gradient(135deg,#c9a96e,#b8924a)", color: "#1a1a1a", border: "none", borderRadius: "8px", fontWeight: "700", fontSize: "14px", cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1 }}>
            {loading ? "Signing in..." : "Sign In"}
          </button>
          <div style={{ marginTop: "16px", fontSize: "12px", color: "#3a3a3a", textAlign: "center", lineHeight: 1.5 }}>Accounts are managed by your administrator.<br />Contact them if you need access.</div>
        </div>
      </div>
    </div>
  );
}

// ── Profile Setup ─────────────────────────────────────────────────
// Shown as a full-screen overlay on first login when no profile row exists.
function ProfileSetup({ session, onSave }) {
  const [name, setName] = useState(session.user?.email?.split("@")[0] || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true); setError(null);
    try {
      const db = makeDb(session.access_token);
      const profile = await db.insert("profiles", { id: session.user.id, display_name: name.trim() });
      onSave(profile);
    } catch (e) {
      setError(e.message || "Failed to create profile.");
    }
    setSaving(false);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "#111", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", zIndex: 2000, fontFamily: "'DM Sans','Helvetica Neue',sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700;900&family=DM+Sans:wght@300;400;500;600&display=swap'); *{box-sizing:border-box;}`}</style>
      <div style={{ width: "100%", maxWidth: "400px" }}>
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <div style={{ fontSize: "48px", marginBottom: "12px" }}>👤</div>
          <h1 style={{ fontFamily: "'Playfair Display',serif", fontSize: "26px", fontWeight: "900", margin: "0 0 8px", background: "linear-gradient(135deg,#f0e6d3,#c9a96e)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Welcome to the Cellar</h1>
          <p style={{ fontSize: "13px", color: "#5a4a3a", margin: 0, lineHeight: 1.6 }}>Set your display name so the team knows whose records are whose.</p>
        </div>
        <div style={{ background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: "16px", padding: "28px" }}>
          {error && <div style={{ background: "#2a1818", border: "1px solid #4a2a2a", borderRadius: "8px", padding: "10px 12px", marginBottom: "16px", fontSize: "13px", color: "#d5a8a8" }}>{error}</div>}
          <Field label="Your Display Name">
            <input
              style={inp}
              placeholder="e.g. Justin, Sarah..."
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && save()}
              autoFocus
            />
          </Field>
          <div style={{ fontSize: "11px", color: "#3a3a3a", marginBottom: "20px" }}>Signed in as {session.user?.email}</div>
          <button onClick={save} disabled={saving || !name.trim()} style={{ width: "100%", padding: "13px", background: "linear-gradient(135deg,#c9a96e,#b8924a)", color: "#1a1a1a", border: "none", borderRadius: "8px", fontWeight: "700", fontSize: "14px", cursor: (saving || !name.trim()) ? "not-allowed" : "pointer", opacity: (saving || !name.trim()) ? 0.7 : 1 }}>
            {saving ? "Saving..." : "Enter the Cellar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Photo Scan ────────────────────────────────────────────────────
function PhotoScanModal({ onResult, onClose, session }) {
  const [image, setImage] = useState(null);
  const [b64, setB64] = useState(null);
  const [mediaType, setMediaType] = useState("image/jpeg");
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const fileRef = useRef(); const camRef = useRef();

  const load = file => {
    if (!file) return;
    const mime = file.type || "image/jpeg";
    const r = new FileReader();
    r.onload = e => { setImage(e.target.result); setB64(e.target.result.split(",")[1]); setMediaType(mime); setResult(null); setError(null); };
    r.readAsDataURL(file);
  };

  const scan = async () => {
    if (!b64) return;
    setScanning(true); setError(null); setResult(null);
    try {
      const res = await fetch(ANTHROPIC_PROXY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1000,
          messages: [{ role: "user", content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
            { type: "text", text: `Identify the vinyl record or album cover. Return ONLY JSON, no markdown:\n{"title":"","artist":"","year":"","genre":"one of: Jazz, Soul, R&B, Blues, Classical, Rock, Folk, Bossa Nova, Funk, Electronic, World, Pop, Country, Other","confidence":"high|medium|low","notes":""}` }
          ]}]
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "API error");
      setResult(JSON.parse(data.content?.find(x => x.type === "text")?.text.replace(/```json|```/g, "").trim()));
    } catch (e) {
      setError("Could not identify this record. Try a clearer photo, or check that your Edge Function is deployed.");
    }
    setScanning(false);
  };

  return (
    <Modal title="📷 Scan Album Cover" onClose={onClose}>
      <p style={{ fontSize: "13px", color: "#6a5a4a", margin: "0 0 16px", lineHeight: 1.5 }}>Point your camera at the album cover or record label. Claude will read it and pre-fill the form.</p>
      <div style={{ display: "flex", gap: "8px", marginBottom: "14px" }}>
        <button onClick={() => fileRef.current.click()} style={{ ...b("#1e1e1e", "#c9a96e"), flex: 1, padding: "10px", border: "1px solid #3a3a2a" }}>🖼 Choose Photo</button>
        <button onClick={() => camRef.current.click()} style={{ ...b("#1e1e1e", "#c9a96e"), flex: 1, padding: "10px", border: "1px solid #3a3a2a" }}>📷 Take Photo</button>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => load(e.target.files[0])} />
        <input ref={camRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={e => load(e.target.files[0])} />
      </div>
      {image && <div style={{ marginBottom: "14px", textAlign: "center" }}><img src={image} alt="" style={{ maxWidth: "100%", maxHeight: "220px", borderRadius: "8px", border: "1px solid #2a2a2a", objectFit: "contain" }} /></div>}
      {image && !scanning && !result && (
        <button onClick={scan} style={{ ...b("linear-gradient(135deg,#c9a96e,#b8924a)", "#1a1a1a"), width: "100%", padding: "12px", fontSize: "14px", marginBottom: "10px" }}>
          🔍 Identify This Record
        </button>
      )}
      {scanning && <Spinner message="Identifying record..." />}
      {error && <div style={{ background: "#2a1818", border: "1px solid #4a2a2a", borderRadius: "8px", padding: "12px", fontSize: "13px", color: "#d5a8a8", marginBottom: "12px" }}>{error}</div>}
      {result && (
        <div style={{ background: "#1e2218", border: "1px solid #3a4a2a", borderRadius: "10px", padding: "16px", marginBottom: "14px" }}>
          <div style={{ fontSize: "10px", color: "#6a8a4a", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: "600", marginBottom: "10px" }}>Match Found · Confidence: {result.confidence}</div>
          {result.title && <div style={{ fontFamily: "'Playfair Display',serif", fontSize: "16px", color: "#f0e6d3", fontWeight: "700", marginBottom: "2px" }}>{result.title}</div>}
          {result.artist && <div style={{ fontSize: "13px", color: "#9a8a7a", marginBottom: "8px" }}>{result.artist}</div>}
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {result.year && <span style={{ fontSize: "11px", color: "#6a5a4a", background: "#222", padding: "2px 8px", borderRadius: "10px" }}>{result.year}</span>}
            {result.genre && <span style={{ fontSize: "11px", color: "#6a5a4a", background: "#222", padding: "2px 8px", borderRadius: "10px" }}>{result.genre}</span>}
          </div>
          {result.notes && <div style={{ fontSize: "11px", color: "#5a4a3a", marginTop: "8px", fontStyle: "italic" }}>{result.notes}</div>}
          <div style={{ display: "flex", gap: "8px", marginTop: "14px" }}>
            <button onClick={() => onResult(result)} style={{ ...b("#a8d5b5", "#1a1a1a"), flex: 1, padding: "10px" }}>✓ Use This — Fill Form</button>
            <button onClick={() => { setResult(null); setImage(null); }} style={b("#252525", "#888")}>Try Again</button>
          </div>
        </div>
      )}
      <button onClick={onClose} style={{ ...b("#111", "#555"), width: "100%", padding: "10px", border: "1px solid #252525", marginTop: "4px" }}>Cancel</button>
    </Modal>
  );
}

// ── Add / Edit Modal ──────────────────────────────────────────────
function AddEditModal({ record, onSave, onClose, profiles, session }) {
  const [form, setForm] = useState(record
    ? { title: record.title || "", artist: record.artist || "", genre: record.genre || "", year: record.year || "", status: record.status || "home", notes: record.notes || "", image_url: record.image_url || "", owner_id: record.owner_id || "" }
    : { title: "", artist: "", genre: "", year: "", status: "home", notes: "", image_url: "", owner_id: session?.user?.id || "" }
  );
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(record?.image_url || null);
  const [dq, setDq] = useState(""); const [dr, setDr] = useState([]); const [dl, setDl] = useState(false);
  const [tab, setTab] = useState("manual"); const [showScan, setShowScan] = useState(false); const [saving, setSaving] = useState(false);
  const [autoFilled, setAutoFilled] = useState(false);
  const imgFileRef = useRef();

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const searchDiscogs = async () => {
    if (!dq.trim()) return; setDl(true); setDr([]);
    try { const res = await fetch(`https://api.discogs.com/database/search?q=${encodeURIComponent(dq)}&type=release&per_page=8`, { headers: { "User-Agent": "SparrowVinylTracker/1.0" } }); setDr((await res.json()).results || []); }
    catch { setDr([]); }
    setDl(false);
  };

  const pickDiscogs = r => {
    const p = r.title?.split(" - ") || [];
    const coverUrl = r.cover_image || r.thumb || "";
    setForm(f => ({ ...f, artist: p[0] || "", title: p.slice(1).join(" - ") || r.title || "", genre: r.genre?.[0] || r.style?.[0] || f.genre, year: r.year ? String(r.year) : f.year, image_url: coverUrl || f.image_url }));
    if (coverUrl) { setImagePreview(coverUrl); setImageFile(null); }
    setAutoFilled(true);
    setTab("manual"); setDr([]);
  };

  const applyScan = r => {
    setForm(f => ({ ...f, title: r.title || f.title, artist: r.artist || f.artist, genre: r.genre || f.genre, year: r.year || f.year }));
    setAutoFilled(true);
    setShowScan(false); setTab("manual");
    if (r.title || r.artist) setDq(`${r.artist} ${r.title}`.trim());
  };

  const loadImageFile = file => {
    if (!file) return;
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = e => setImagePreview(e.target.result);
    reader.readAsDataURL(file);
    // Clear the URL field since we're uploading a file instead
    set("image_url", "");
  };

  const save = async () => {
    if (!form.title || !form.artist) return;
    setSaving(true);
    await onSave({ ...form, _imageFile: imageFile });
    setSaving(false);
  };

  return (
    <>
      <Modal title={record ? "Edit Record" : "Add Record"} onClose={onClose}>
        <div style={{ display: "flex", gap: "6px", marginBottom: "18px" }}>
          {[{ key: "manual", label: "✏️ Manual" }, { key: "discogs", label: "🔍 Discogs" }].map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{ ...b(tab === t.key ? "#c9a96e" : "#1e1e1e", tab === t.key ? "#1a1a1a" : "#555"), flex: 1, padding: "8px", border: `1px solid ${tab === t.key ? "#c9a96e" : "#2a2a2a"}` }}>{t.label}</button>
          ))}
          <button onClick={() => setShowScan(true)} style={{ ...b("#1e1e1e", "#c9a96e"), flex: 1, padding: "8px", border: "1px solid #3a3a2a" }}>📷 Scan</button>
        </div>

        {tab === "discogs" && (
          <div style={{ marginBottom: "14px" }}>
            <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
              <input style={{ ...inp, flex: 1 }} placeholder="Artist, album, label..." value={dq} onChange={e => setDq(e.target.value)} onKeyDown={e => e.key === "Enter" && searchDiscogs()} />
              <button onClick={searchDiscogs} style={b("#c9a96e", "#1a1a1a")}>Search</button>
            </div>
            {dl && <div style={{ color: "#5a4a3a", fontSize: "13px", textAlign: "center", padding: "10px" }}>Searching Discogs...</div>}
            {dr.map(r => (
              <div key={r.id} onClick={() => pickDiscogs(r)} style={{ display: "flex", gap: "10px", alignItems: "center", background: "#111", border: "1px solid #252525", borderRadius: "8px", padding: "10px", marginBottom: "6px", cursor: "pointer", transition: "border-color 0.15s" }} onMouseEnter={e => e.currentTarget.style.borderColor = "#c9a96e"} onMouseLeave={e => e.currentTarget.style.borderColor = "#252525"}>
                {r.thumb ? <img src={r.thumb} alt="" style={{ width: "44px", height: "44px", borderRadius: "4px", objectFit: "cover", flexShrink: 0 }} /> : <div style={{ width: "44px", height: "44px", borderRadius: "4px", background: "#222", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "18px" }}>💿</div>}
                <div><div style={{ fontSize: "13px", color: "#f0e6d3", fontWeight: "600" }}>{r.title}</div><div style={{ fontSize: "11px", color: "#5a4a3a" }}>{r.year}{r.genre?.length ? ` · ${r.genre[0]}` : ""}{r.country ? ` · ${r.country}` : ""}</div></div>
              </div>
            ))}
            {dr.length > 0 && <div style={{ fontSize: "11px", color: "#4a3a2a", textAlign: "center" }}>Click a result to fill the form</div>}
          </div>
        )}

        {tab === "manual" && !record && autoFilled && (
          <div style={{ background: "#1e2218", border: "1px solid #3a4a2a", borderRadius: "8px", padding: "10px 12px", marginBottom: "14px", fontSize: "12px", color: "#8aaa6a" }}>✓ Pre-filled — review before saving</div>
        )}

        {/* Album Artwork */}
        <Field label="Album Artwork">
          <div style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
            {imagePreview
              ? <img src={imagePreview} alt="cover" style={{ width: "64px", height: "64px", borderRadius: "6px", objectFit: "cover", flexShrink: 0, border: "1px solid #2a2a2a" }} onError={() => setImagePreview(null)} />
              : <div style={{ width: "64px", height: "64px", borderRadius: "6px", background: "#1a1a1a", border: "1px dashed #2a2a2a", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "24px" }}>💿</div>
            }
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
              <button onClick={() => imgFileRef.current.click()} style={{ ...b("#1e1e1e", "#c9a96e"), border: "1px solid #3a3a2a", padding: "8px", fontSize: "12px", textAlign: "center" }}>📁 Upload from device</button>
              <input ref={imgFileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => loadImageFile(e.target.files[0])} />
              <input style={{ ...inp, fontSize: "12px", padding: "8px 10px" }} placeholder="Or paste image URL..." value={form.image_url} onChange={e => { set("image_url", e.target.value); setImagePreview(e.target.value || null); setImageFile(null); }} />
            </div>
          </div>
          {imageFile && <div style={{ fontSize: "11px", color: "#6a8a4a", marginTop: "6px" }}>📎 {imageFile.name} — will upload on save</div>}
        </Field>

        <Field label="Album Title *"><input style={inp} value={form.title} onChange={e => set("title", e.target.value)} placeholder="e.g. Kind of Blue" /></Field>
        <Field label="Artist *"><input style={inp} value={form.artist} onChange={e => set("artist", e.target.value)} placeholder="e.g. Miles Davis" /></Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <Field label="Genre"><select style={inp} value={form.genre} onChange={e => set("genre", e.target.value)}><option value="">Select...</option>{GENRES.map(g => <option key={g}>{g}</option>)}</select></Field>
          <Field label="Year"><input style={inp} value={form.year} onChange={e => set("year", e.target.value)} placeholder="e.g. 1959" maxLength={4} /></Field>
        </div>
        <Field label="Location">
          <div style={{ display: "flex", gap: "8px" }}>
            {[{ val: "home", label: "🏠 Home" }, { val: "at_sparrow", label: "🍷 At Sparrow" }].map(opt => (
              <button key={opt.val} onClick={() => set("status", opt.val)} style={{ ...b(form.status === opt.val ? (opt.val === "home" ? "#2d4a3e" : "#4a2d35") : "#1a1a1a", form.status === opt.val ? (opt.val === "home" ? "#a8d5b5" : "#d5a8b5") : "#555"), flex: 1, padding: "8px", fontSize: "11px", border: `1px solid ${form.status === opt.val ? "#3a3a3a" : "#2a2a2a"}` }}>{opt.label}</button>
            ))}
          </div>
        </Field>

        {/* Owner Picker */}
        {profiles && profiles.length > 0 && (
          <Field label="Owned By">
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {profiles.map(p => {
                const isMe = p.id === session?.user?.id;
                const isSparrow = p.display_name === "Sparrow Wine Bar";
                const selected = form.owner_id === p.id;
                return (
                  <button key={p.id} onClick={() => set("owner_id", p.id)} style={{ ...b(selected ? "#c9a96e" : "#1e1e1e", selected ? "#1a1a1a" : "#888"), border: `1px solid ${selected ? "#c9a96e" : "#2a2a2a"}`, padding: "7px 12px", fontSize: "12px" }}>
                    {isSparrow ? "🍷" : "👤"} {isMe ? `Me — ${p.display_name}` : p.display_name}
                  </button>
                );
              })}
            </div>
          </Field>
        )}

        <Field label="Notes"><textarea style={{ ...inp, minHeight: "70px", resize: "vertical" }} value={form.notes} onChange={e => set("notes", e.target.value)} placeholder="Condition, mood, listening hour notes..." /></Field>
        <div style={{ display: "flex", gap: "8px", marginTop: "6px" }}>
          <button onClick={save} disabled={saving || !form.title || !form.artist} style={{ ...b("linear-gradient(135deg,#c9a96e,#b8924a)", "#1a1a1a"), flex: 1, padding: "12px", fontSize: "14px", opacity: (saving || !form.title || !form.artist) ? 0.7 : 1, cursor: (saving || !form.title || !form.artist) ? "not-allowed" : "pointer" }}>{saving ? "Saving..." : record ? "Save Changes" : "Add to Collection"}</button>
          <button onClick={onClose} style={b("#1a1a1a", "#555")}>Cancel</button>
        </div>
      </Modal>
      {showScan && <PhotoScanModal onResult={applyScan} onClose={() => setShowScan(false)} session={session} />}
    </>
  );
}

// ── Record Card ───────────────────────────────────────────────────
function RecordCard({ record, onToggleLocation, onMarkPlayed, onEdit, onDelete, profiles }) {
  const [open, setOpen] = useState(false);
  const atSparrow = record.status === "at_sparrow";
  const ownerProfile = profiles?.find(p => p.id === record.owner_id);
  const ownerIsSparrow = ownerProfile?.display_name === "Sparrow Wine Bar";

  return (
    <div style={{ background: "linear-gradient(135deg,#1a1a1a,#202020)", border: "1px solid #2a2a2a", borderRadius: "12px", padding: "16px", cursor: "pointer", transition: "border-color 0.2s", position: "relative", overflow: "hidden" }} onClick={() => setOpen(!open)} onMouseEnter={e => e.currentTarget.style.borderColor = "#c9a96e"} onMouseLeave={e => e.currentTarget.style.borderColor = "#2a2a2a"}>
      <div style={{ position: "absolute", top: "-22px", right: "-22px", width: "84px", height: "84px", borderRadius: "50%", border: "1px solid #242424", pointerEvents: "none" }} />
      <div style={{ position: "absolute", top: "-6px", right: "-6px", width: "52px", height: "52px", borderRadius: "50%", border: "1px solid #242424", pointerEvents: "none" }} />

      <div style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
        {/* Thumbnail */}
        <div style={{ flexShrink: 0 }}>
          {record.image_url
            ? <img src={record.image_url} alt={record.title} style={{ width: "54px", height: "54px", borderRadius: "6px", objectFit: "cover", border: "1px solid #2a2a2a", display: "block" }} onError={e => { e.target.style.display = "none"; e.target.nextSibling.style.display = "flex"; }} />
            : null
          }
          <div style={{ width: "54px", height: "54px", borderRadius: "6px", background: "#1a1a1a", border: "1px solid #222", display: record.image_url ? "none" : "flex", alignItems: "center", justifyContent: "center", fontSize: "22px" }}>💿</div>
        </div>

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: "'Playfair Display',serif", fontSize: "16px", fontWeight: "700", color: "#f0e6d3", marginBottom: "2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{record.title}</div>
              <div style={{ fontSize: "13px", color: "#9a8a7a", marginBottom: "8px" }}>{record.artist}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" }}>
                <Badge color={atSparrow ? "sparrow" : "home"}>{atSparrow ? "At Sparrow 🍷" : "At Home 🏠"}</Badge>
                {record.genre && <span style={{ fontSize: "11px", color: "#6a5a4a", background: "#222", padding: "2px 8px", borderRadius: "20px" }}>{record.genre}</span>}
                {record.year && <span style={{ fontSize: "11px", color: "#6a5a4a", background: "#222", padding: "2px 8px", borderRadius: "20px" }}>{record.year}</span>}
                {record.last_played && <Badge color="recent">Played at Listening Hour</Badge>}
                {ownerProfile && <span style={{ fontSize: "11px", color: "#5a4a3a", background: "#1a1a1a", border: "1px solid #2a2a2a", padding: "2px 8px", borderRadius: "20px" }}>{ownerIsSparrow ? "🍷" : "👤"} {ownerProfile.display_name}</span>}
              </div>
            </div>
            <div style={{ fontSize: "20px", opacity: 0.55, flexShrink: 0 }}>{atSparrow ? "🍷" : "🏠"}</div>
          </div>
        </div>
      </div>

      {open && (
        <div style={{ marginTop: "14px", borderTop: "1px solid #222", paddingTop: "14px" }} onClick={e => e.stopPropagation()}>
          {record.added_by && <div style={{ fontSize: "12px", color: "#5a4a3a", marginBottom: "4px" }}>Added by: <span style={{ color: "#9a8a7a" }}>{record.added_by}</span></div>}
          {record.notes && <div style={{ fontSize: "12px", color: "#5a4a3a", marginBottom: "4px" }}>Notes: <span style={{ color: "#9a8a7a" }}>{record.notes}</span></div>}
          {record.last_moved && <div style={{ fontSize: "12px", color: "#5a4a3a", marginBottom: "4px" }}>Last moved: <span style={{ color: "#d5c4a8" }}>{new Date(record.last_moved).toLocaleDateString()}</span></div>}
          {record.last_played && <div style={{ fontSize: "12px", color: "#5a4a3a", marginBottom: "4px" }}>Last played: <span style={{ color: "#a8bcd5" }}>{new Date(record.last_played).toLocaleDateString()}</span></div>}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "12px" }}>
            <button onClick={() => onToggleLocation(record.id, record.status)} style={b(atSparrow ? "#2d4a3e" : "#4a2d35", atSparrow ? "#a8d5b5" : "#d5a8b5")}>
              {atSparrow ? "🏠 Move to Home" : "🍷 Move to Sparrow"}
            </button>
            <button onClick={() => onMarkPlayed(record.id)} style={b("#a8bcd5", "#1a1a1a")}>🎵 Mark Played</button>
            <button onClick={() => onEdit(record)} style={b("#2a2a2a", "#c9a96e")}>Edit</button>
            <button onClick={() => onDelete(record.id)} style={b("#2a1818", "#d5a8a8")}>Delete</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── History ───────────────────────────────────────────────────────
function History({ records, nights, onSave, onDelete }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), theme: "", notes: "", record_ids: "" });
  const [editing, setEditing] = useState(null); const [saving, setSaving] = useState(false);
  const selIds = form.record_ids ? form.record_ids.split(",").filter(Boolean).map(Number) : [];
  const toggle = id => { const ids = selIds.includes(id) ? selIds.filter(x => x !== id) : [...selIds, id]; setForm(f => ({ ...f, record_ids: ids.join(",") })); };
  const openNew = () => { setForm({ date: new Date().toISOString().slice(0, 10), theme: "", notes: "", record_ids: "" }); setEditing(null); setShowForm(true); };
  const openEdit = n => { setForm({ date: n.date, theme: n.theme || "", notes: n.notes || "", record_ids: n.record_ids || "" }); setEditing(n); setShowForm(true); };
  const save = async () => { if (!form.date) return; setSaving(true); await onSave({ ...form, id: editing?.id }); setSaving(false); setShowForm(false); setEditing(null); };
  const sorted = [...nights].sort((a, z) => new Date(z.date) - new Date(a.date));
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <div><h3 style={{ fontFamily: "'Playfair Display',serif", color: "#c9a96e", fontSize: "16px", margin: "0 0 2px" }}>Listening Hour History</h3><div style={{ fontSize: "12px", color: "#444" }}>{nights.length} session{nights.length !== 1 ? "s" : ""} recorded</div></div>
        <button onClick={openNew} style={{ background: "linear-gradient(135deg,#c9a96e,#b8924a)", color: "#1a1a1a", border: "none", borderRadius: "8px", padding: "8px 14px", fontWeight: "700", fontSize: "12px", cursor: "pointer" }}>+ Log a Session</button>
      </div>
      {sorted.length === 0 && <div style={{ textAlign: "center", padding: "50px 20px" }}><div style={{ fontSize: "40px", marginBottom: "10px" }}>🎶</div><div style={{ fontFamily: "'Playfair Display',serif", fontSize: "16px", color: "#444", marginBottom: "4px" }}>No sessions logged yet</div><div style={{ fontSize: "12px", color: "#333" }}>Log your first Sparrow Listening Hour</div></div>}
      <div style={{ display: "grid", gap: "12px" }}>
        {sorted.map(night => {
          const ids = night.record_ids ? night.record_ids.split(",").filter(Boolean).map(Number) : [];
          const played = records.filter(r => ids.includes(r.id));
          return (
            <div key={night.id} style={{ background: "linear-gradient(135deg,#1a1a1a,#1e1e1e)", border: "1px solid #252525", borderRadius: "12px", padding: "18px", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", bottom: "-30px", right: "-30px", width: "100px", height: "100px", borderRadius: "50%", border: "1px solid #202020", pointerEvents: "none" }} />
              <div style={{ position: "absolute", bottom: "-10px", right: "-10px", width: "60px", height: "60px", borderRadius: "50%", border: "1px solid #202020", pointerEvents: "none" }} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px", flexWrap: "wrap" }}>
                    <span style={{ fontFamily: "'Playfair Display',serif", fontSize: "15px", fontWeight: "700", color: "#f0e6d3" }}>{new Date(night.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "long", day: "numeric", year: "numeric" })}</span>
                    {night.theme && <span style={{ fontSize: "11px", background: "#2a2218", color: "#c9a96e", border: "1px solid #3a3218", padding: "2px 8px", borderRadius: "20px", fontWeight: "600" }}>{night.theme}</span>}
                  </div>
                  {played.length > 0
                    ? <><div style={{ fontSize: "10px", color: "#444", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "6px" }}>{played.length} Record{played.length !== 1 ? "s" : ""} Played</div><div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>{played.map(r => <div key={r.id} style={{ background: "#222", border: "1px solid #2a2a2a", borderRadius: "6px", padding: "4px 10px", fontSize: "12px" }}><span style={{ color: "#f0e6d3" }}>{r.title}</span><span style={{ color: "#444", marginLeft: "4px" }}>· {r.artist}</span></div>)}</div></>
                    : <div style={{ fontSize: "12px", color: "#333" }}>No records linked</div>}
                  {night.notes && <div style={{ marginTop: "10px", fontSize: "12px", color: "#7a6a5a", fontStyle: "italic", borderLeft: "2px solid #252525", paddingLeft: "10px" }}>{night.notes}</div>}
                </div>
                <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                  <button onClick={() => openEdit(night)} style={b("#252525", "#9a8a7a")}>Edit</button>
                  <button onClick={() => onDelete(night.id)} style={b("#2a1818", "#d5a8a8")}>✕</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {showForm && (
        <Modal title={editing ? "Edit Session" : "Log a Listening Hour"} onClose={() => setShowForm(false)}>
          <Field label="Date"><input type="date" style={inp} value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></Field>
          <Field label="Theme (optional)"><input style={inp} value={form.theme} onChange={e => setForm(f => ({ ...f, theme: e.target.value }))} placeholder="e.g. Italian Jazz, Bossa Nova Sunset..." /></Field>
          <Field label="Records Played">
            {records.length === 0
              ? <div style={{ fontSize: "12px", color: "#444", padding: "8px 0" }}>No records in collection yet.</div>
              : <div style={{ maxHeight: "220px", overflowY: "auto", border: "1px solid #252525", borderRadius: "8px", padding: "4px" }}>
                {records.map(r => { const sel = selIds.includes(r.id); return (
                  <div key={r.id} onClick={() => toggle(r.id)} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 10px", borderRadius: "6px", cursor: "pointer", background: sel ? "#1e2a1e" : "transparent", border: `1px solid ${sel ? "#3a5a3a" : "transparent"}`, marginBottom: "3px", transition: "all 0.15s" }}>
                    <div style={{ width: "16px", height: "16px", borderRadius: "4px", flexShrink: 0, border: `2px solid ${sel ? "#a8d5b5" : "#333"}`, background: sel ? "#a8d5b5" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>{sel && <span style={{ color: "#1a1a1a", fontSize: "10px", fontWeight: "700" }}>✓</span>}</div>
                    <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: "13px", color: "#f0e6d3", fontWeight: "500", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.title}</div><div style={{ fontSize: "11px", color: "#5a4a3a" }}>{r.artist}{r.genre ? ` · ${r.genre}` : ""}</div></div>
                  </div>
                ); })}
              </div>}
          </Field>
          <Field label="Notes (optional)"><textarea style={{ ...inp, minHeight: "70px", resize: "vertical" }} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Crowd vibe, standout records, wine pairings..." /></Field>
          <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
            <button onClick={save} disabled={saving} style={{ ...b("linear-gradient(135deg,#c9a96e,#b8924a)", "#1a1a1a"), flex: 1, padding: "12px", fontSize: "14px", opacity: saving ? 0.7 : 1 }}>{saving ? "Saving..." : editing ? "Save Changes" : "Save Session"}</button>
            <button onClick={() => setShowForm(false)} style={b("#1a1a1a", "#555")}>Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Theme Ideas ───────────────────────────────────────────────────
function ThemeIdeas({ records }) {
  const grouped = {};
  records.forEach(r => { const g = r.genre || "Other"; if (!grouped[g]) grouped[g] = []; grouped[g].push(r); });
  const themes = [
    { key: "Jazz", label: "Italian Jazz Aperitivo", emoji: "🎷", desc: "Smoky and sophisticated — pairs with Campari spritzes and charcuterie" },
    { key: "Bossa Nova", label: "Bossa Nova Sunset", emoji: "🌅", desc: "Warm Brazilian vibes for golden hour sipping" },
    { key: "Soul", label: "Soul & Soulvignons", emoji: "🎤", desc: "Deep cuts and natural wines — a match made in heaven" },
    { key: "Classical", label: "Classical Contemplation", emoji: "🎻", desc: "Elegant pours, serious listening — a refined session" },
    { key: "Folk", label: "Folk & Natural Wine", emoji: "🌿", desc: "Earthy, raw, unplugged — biodynamic pours to match" },
    { key: "Funk", label: "Funk & Fizz", emoji: "🕺", desc: "High energy, playful pours — pétillant naturel all night" },
  ];
  return (
    <div>
      <div style={{ marginBottom: "20px" }}>
        <h3 style={{ fontFamily: "'Playfair Display',serif", color: "#c9a96e", fontSize: "16px", margin: "0 0 10px" }}>Collection by Genre</h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {Object.entries(grouped).map(([g, recs]) => <div key={g} style={{ background: "#1a1a1a", border: "1px solid #252525", borderRadius: "8px", padding: "6px 12px", fontSize: "12px" }}><span style={{ color: "#9a8a7a" }}>{g}</span><span style={{ color: "#c9a96e", fontWeight: "700", marginLeft: "6px" }}>{recs.length}</span></div>)}
          {!Object.keys(grouped).length && <span style={{ color: "#444", fontSize: "13px" }}>Add records to see genre breakdown</span>}
        </div>
      </div>
      <h3 style={{ fontFamily: "'Playfair Display',serif", color: "#c9a96e", fontSize: "16px", margin: "0 0 12px" }}>Listening Hour Theme Ideas</h3>
      <div style={{ display: "grid", gap: "10px" }}>
        {themes.map(t => { const count = (grouped[t.key] || []).length; return (
          <div key={t.key} style={{ background: "linear-gradient(135deg,#1a1a1a,#1e1e1e)", border: `1px solid ${count > 0 ? "#3a3020" : "#202020"}`, borderRadius: "10px", padding: "14px", opacity: count === 0 ? 0.4 : 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div><div style={{ marginBottom: "4px" }}>{t.emoji} <span style={{ fontFamily: "'Playfair Display',serif", color: "#f0e6d3", fontSize: "15px", fontWeight: "700" }}>{t.label}</span></div><div style={{ fontSize: "12px", color: "#6a5a4a" }}>{t.desc}</div></div>
              <div style={{ textAlign: "right", flexShrink: 0, marginLeft: "12px" }}><div style={{ fontSize: "18px", fontWeight: "700", color: count > 0 ? "#c9a96e" : "#333" }}>{count}</div><div style={{ fontSize: "10px", color: "#444" }}>records</div></div>
            </div>
            {count > 0 && <div style={{ marginTop: "8px", fontSize: "11px", color: "#7a6a5a" }}>{(grouped[t.key] || []).slice(0, 3).map(r => r.title).join(", ")}{count > 3 ? ` +${count - 3} more` : ""}</div>}
          </div>
        ); })}
      </div>
    </div>
  );
}

// ── Vinyl Guru ────────────────────────────────────────────────────
function VinylGuru({ records, session }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const bottomRef = useRef();

  const starters = [
    "Build me a mellow Friday night playlist",
    "What genres should I add to round out the collection?",
    "Suggest a listening hour theme for tonight",
    "What wine pairs best with what's currently at Sparrow?",
  ];

  const send = async (text) => {
    if (!text.trim() || typing) return;
    const userMsg = { role: "user", content: text.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setTyping(true);

    const collectionLines = records.length > 0
      ? records.map(r => `• ${r.title} by ${r.artist}${r.year ? ` (${r.year})` : ""}${r.genre ? ` [${r.genre}]` : ""}${r.status === "at_sparrow" ? " — at Sparrow" : " — at home"}`).join("\n")
      : "No records in collection yet.";

    const systemPrompt = `You are the Vinyl Guru for Sparrow Wine Bar in Orlando — a knowledgeable, warm, and slightly poetic advisor for vinyl records and wine pairings. You help the staff curate playlists, plan listening hour themes, and decide what to spin next.

Current vinyl collection (${records.length} records):
${collectionLines}

Records marked "at Sparrow" are physically at the wine bar and available to play tonight. Records "at home" belong to staff members and need to be brought in.

Be conversational, enthusiastic about music and wine, and keep responses concise and practical. Occasionally weave in thoughtful wine pairing suggestions. When building playlists, reference the actual records in the collection.`;

    try {
      const res = await fetch(ANTHROPIC_PROXY_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
          apikey: SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1024,
          system: systemPrompt,
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "API error");
      const reply = data.content?.find(x => x.type === "text")?.text || "I couldn't come up with anything — try asking again!";
      setMessages(m => [...m, { role: "assistant", content: reply }]);
    } catch (e) {
      setMessages(m => [...m, { role: "assistant", content: `Something went wrong: ${e.message}. Check your API key and try again.` }]);
    }
    setTyping(false);
  };

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, typing]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 280px)", minHeight: "400px" }}>
      <style>{`@keyframes blink{0%,80%,100%{opacity:0.1}40%{opacity:1}}`}</style>
      <div style={{ marginBottom: "16px" }}>
        <h3 style={{ fontFamily: "'Playfair Display',serif", color: "#c9a96e", fontSize: "18px", margin: "0 0 4px" }}>🎵 Vinyl Guru</h3>
        <div style={{ fontSize: "12px", color: "#444" }}>Ask anything about your collection — playlists, themes, pairings, what to spin tonight.</div>
      </div>

      {/* Starter chips */}
      {messages.length === 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "16px" }}>
          {starters.map(s => (
            <button key={s} onClick={() => send(s)} style={{ ...b("#1e1e1e", "#c9a96e"), border: "1px solid #3a3020", padding: "8px 12px", fontSize: "12px", textAlign: "left" }}>{s}</button>
          ))}
        </div>
      )}

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "12px", marginBottom: "12px", paddingRight: "4px" }}>
        {messages.length === 0 && !typing && (
          <div style={{ textAlign: "center", padding: "40px 20px", color: "#333" }}>
            <div style={{ fontSize: "40px", marginBottom: "12px" }}>🎶</div>
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: "16px", color: "#3a3a3a", marginBottom: "6px" }}>The Guru is listening</div>
            <div style={{ fontSize: "12px" }}>Pick a prompt above or ask your own question</div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={{
              maxWidth: "82%",
              background: m.role === "user" ? "linear-gradient(135deg,#c9a96e,#b8924a)" : "#1e1e1e",
              color: m.role === "user" ? "#1a1a1a" : "#f0e6d3",
              border: m.role === "assistant" ? "1px solid #2a2a2a" : "none",
              borderRadius: m.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
              padding: "10px 14px",
              fontSize: "13px",
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
            }}>{m.content}</div>
          </div>
        ))}
        {typing && (
          <div style={{ display: "flex", justifyContent: "flex-start" }}>
            <div style={{ background: "#1e1e1e", border: "1px solid #2a2a2a", borderRadius: "16px 16px 16px 4px", padding: "12px 16px", display: "flex", alignItems: "center", gap: "4px" }}>
              {[0, 0.2, 0.4].map((delay, i) => (
                <span key={i} style={{ display: "inline-block", width: "6px", height: "6px", borderRadius: "50%", background: "#c9a96e", animation: `blink 1.4s ${delay}s infinite` }} />
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ display: "flex", gap: "8px" }}>
        <input
          style={{ ...inp, flex: 1 }}
          placeholder="Ask the Guru anything..."
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
          disabled={typing}
        />
        <button
          onClick={() => send(input)}
          disabled={typing || !input.trim()}
          style={{ ...b(input.trim() && !typing ? "linear-gradient(135deg,#c9a96e,#b8924a)" : "#1e1e1e", input.trim() && !typing ? "#1a1a1a" : "#444"), padding: "10px 18px", opacity: (!input.trim() || typing) ? 0.5 : 1 }}
        >
          {typing ? "..." : "Send"}
        </button>
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────
export default function App() {
  const [session, setSession] = useState(() => { try { const s = localStorage.getItem("sparrow_session"); return s ? JSON.parse(s) : null; } catch { return null; } });
  const [records, setRecords] = useState([]);
  const [nights, setNights] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("collection");
  const [showAdd, setShowAdd] = useState(false);
  const [editRec, setEditRec] = useState(null);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  const handleLogin = data => { localStorage.setItem("sparrow_session", JSON.stringify(data)); setSession(data); };
  const handleLogout = async () => { try { await authApi.signOut(session.access_token); } catch {} localStorage.removeItem("sparrow_session"); setSession(null); setRecords([]); setNights([]); setProfiles([]); };
  const getDb = (token) => makeDb(token || session.access_token);

  const loadData = async () => {
    setLoading(true); setError(null);
    try {
      const [r, s, p] = await Promise.all([getDb().get("records"), getDb().get("sessions"), getDb().get("profiles")]);
      setRecords(r); setNights(s); setProfiles(p);
    } catch {
      try {
        const refreshed = await authApi.refresh(session.refresh_token);
        const newSess = { ...session, access_token: refreshed.access_token, refresh_token: refreshed.refresh_token };
        handleLogin(newSess);
        const [r, s, p] = await Promise.all([getDb(refreshed.access_token).get("records"), getDb(refreshed.access_token).get("sessions"), getDb(refreshed.access_token).get("profiles")]);
        setRecords(r); setNights(s); setProfiles(p);
      } catch { handleLogout(); }
    }
    setLoading(false);
  };

  useEffect(() => { if (session) loadData(); }, [session?.access_token]);

  const myProfile = profiles.find(p => p.id === session?.user?.id);
  const needsProfileSetup = session && !loading && profiles.length >= 0 && !myProfile;

  const saveRecord = async form => {
    try {
      let imageUrl = form.image_url || null;
      // Upload file if one was selected
      if (form._imageFile) {
        imageUrl = await getDb().uploadImage(form._imageFile);
      }
      const payload = {
        title: form.title,
        artist: form.artist,
        genre: form.genre,
        year: form.year,
        status: form.status,
        notes: form.notes,
        image_url: imageUrl,
        owner_id: form.owner_id || myProfile?.id || null,
      };
      if (editRec) {
        const u = await getDb().update("records", editRec.id, payload);
        setRecords(p => p.map(r => r.id === editRec.id ? u : r));
      } else {
        const c = await getDb().insert("records", { ...payload, added_by: myProfile?.display_name || session.user?.email || null });
        setRecords(p => [...p, c]);
      }
      setShowAdd(false); setEditRec(null);
    } catch (e) { setError(`Failed to save record: ${e.message}`); }
  };

  const toggleLocation = async (id, currentStatus) => {
    const next = currentStatus === "at_sparrow" ? "home" : "at_sparrow";
    try { const u = await getDb().update("records", id, { status: next, last_moved: new Date().toISOString() }); setRecords(p => p.map(r => r.id === id ? u : r)); }
    catch { setError("Failed to update record."); }
  };

  const markPlayed = async id => {
    try { const u = await getDb().update("records", id, { last_played: new Date().toISOString() }); setRecords(p => p.map(r => r.id === id ? u : r)); }
    catch { setError("Failed to update record."); }
  };

  const deleteRecord = async id => {
    if (!window.confirm("Delete this record? This cannot be undone.")) return;
    try { await getDb().remove("records", id); setRecords(p => p.filter(r => r.id !== id)); }
    catch { setError("Failed to delete record."); }
  };

  const saveNight = async form => {
    try {
      if (form.id) {
        const u = await getDb().update("sessions", form.id, { date: form.date, theme: form.theme, notes: form.notes, record_ids: form.record_ids });
        setNights(p => p.map(n => n.id === form.id ? u : n));
      } else {
        const c = await getDb().insert("sessions", { date: form.date, theme: form.theme, notes: form.notes, record_ids: form.record_ids });
        setNights(p => [...p, c]);
      }
    } catch { setError("Failed to save session."); }
  };

  const deleteNight = async id => {
    if (!window.confirm("Delete this session? This cannot be undone.")) return;
    try { await getDb().remove("sessions", id); setNights(p => p.filter(n => n.id !== id)); }
    catch { setError("Failed to delete session."); }
  };

  const filtered = records.filter(r => {
    const ms = !search || r.title?.toLowerCase().includes(search.toLowerCase()) || r.artist?.toLowerCase().includes(search.toLowerCase());
    const mf = filter === "all" ? true : filter === "home" ? r.status === "home" : filter === "sparrow" ? r.status === "at_sparrow" : filter === "recent" ? !!r.last_played : true;
    return ms && mf;
  });

  const stats = {
    total: records.length,
    home: records.filter(r => r.status === "home").length,
    sparrow: records.filter(r => r.status === "at_sparrow").length,
  };

  if (!session) return <LoginScreen onLogin={handleLogin} />;
  if (needsProfileSetup) return <ProfileSetup session={session} onSave={p => setProfiles(prev => [...prev, p])} />;

  return (
    <div style={{ minHeight: "100vh", background: "#111", fontFamily: "'DM Sans','Helvetica Neue',sans-serif", color: "#f0e6d3" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700;900&family=DM+Sans:wght@300;400;500;600&display=swap'); *{box-sizing:border-box;} ::-webkit-scrollbar{width:4px;} ::-webkit-scrollbar-track{background:#111;} ::-webkit-scrollbar-thumb{background:#2e2e2e;border-radius:2px;} input:focus,select:focus,textarea:focus{border-color:#c9a96e!important;} input[type="date"]::-webkit-calendar-picker-indicator{filter:invert(0.4);}`}</style>
      <div style={{ borderBottom: "1px solid #1e1e1e", padding: "20px 24px 0", background: "linear-gradient(180deg,#151515,#111)" }}>
        <div style={{ maxWidth: "720px", margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "16px", flexWrap: "wrap", gap: "12px" }}>
            <div>
              <div style={{ fontSize: "11px", fontWeight: "600", color: "#c9a96e", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: "4px" }}>🍷 Sparrow Wine Bar · Orlando</div>
              <h1 style={{ fontFamily: "'Playfair Display',serif", fontSize: "28px", fontWeight: "900", margin: 0, background: "linear-gradient(135deg,#f0e6d3,#c9a96e)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", lineHeight: 1.1 }}>Vinyl Tracker</h1>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <button onClick={() => setShowAdd(true)} style={{ background: "linear-gradient(135deg,#c9a96e,#b8924a)", color: "#1a1a1a", border: "none", borderRadius: "8px", padding: "10px 16px", fontWeight: "700", fontSize: "13px", cursor: "pointer" }}>+ Add Record</button>
              <div style={{ borderLeft: "1px solid #2a2a2a", paddingLeft: "10px" }}>
                <div style={{ fontSize: "10px", color: "#3a3a3a", marginBottom: "2px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Signed in as</div>
                <div style={{ fontSize: "11px", color: "#6a5a4a", maxWidth: "140px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{myProfile?.display_name || session.user?.email}</div>
              </div>
              <button onClick={handleLogout} style={{ ...b("#1a1a1a", "#666"), border: "1px solid #252525", padding: "8px 12px" }}>Sign Out</button>
            </div>
          </div>
          <div style={{ display: "flex", gap: "24px", marginBottom: "16px", flexWrap: "wrap" }}>
            {[{ label: "Total", val: stats.total, icon: "💿" }, { label: "At Home", val: stats.home, icon: "🏠" }, { label: "At Sparrow", val: stats.sparrow, icon: "🍷" }].map(s => (
              <div key={s.label}><div style={{ fontSize: "20px", fontWeight: "700", color: "#c9a96e" }}>{s.val}</div><div style={{ fontSize: "10px", color: "#444", textTransform: "uppercase", letterSpacing: "0.08em" }}>{s.icon} {s.label}</div></div>
            ))}
          </div>
          <div style={{ display: "flex" }}>
            {[{ key: "collection", label: "Collection" }, { key: "history", label: "History" }, { key: "themes", label: "Theme Ideas" }, { key: "guru", label: "🎵 Vinyl Guru" }].map(t => (
              <button key={t.key} onClick={() => setTab(t.key)} style={{ background: "none", border: "none", borderBottom: `2px solid ${tab === t.key ? "#c9a96e" : "transparent"}`, color: tab === t.key ? "#c9a96e" : "#3e3e3e", padding: "10px 16px", cursor: "pointer", fontWeight: "600", fontSize: "13px", transition: "all 0.15s" }}>{t.label}</button>
            ))}
          </div>
        </div>
      </div>
      <div style={{ maxWidth: "720px", margin: "0 auto", padding: "20px 24px" }}>
        {error && <ErrorBanner message={error} onRetry={loadData} />}
        {loading ? <Spinner message="Loading your collection..." /> : (
          <>
            {tab === "collection" && (
              <>
                <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap", alignItems: "center" }}>
                  <input style={{ ...inp, flex: "1", minWidth: "150px", maxWidth: "200px" }} placeholder="Search records..." value={search} onChange={e => setSearch(e.target.value)} />
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    {[{ key: "all", label: "All" }, { key: "home", label: "🏠 Home" }, { key: "sparrow", label: "🍷 Sparrow" }, { key: "recent", label: "🎵 Played" }].map(f => (
                      <button key={f.key} onClick={() => setFilter(f.key)} style={{ ...b(filter === f.key ? "#c9a96e" : "#1a1a1a", filter === f.key ? "#1a1a1a" : "#555"), border: `1px solid ${filter === f.key ? "#c9a96e" : "#252525"}`, fontSize: "11px", padding: "6px 10px" }}>{f.label}</button>
                    ))}
                  </div>
                </div>
                {filtered.length === 0
                  ? <div style={{ textAlign: "center", padding: "60px 20px" }}><div style={{ fontSize: "48px", marginBottom: "12px" }}>💿</div><div style={{ fontFamily: "'Playfair Display',serif", fontSize: "18px", color: "#444", marginBottom: "6px" }}>{records.length === 0 ? "No records yet" : "No records match"}</div><div style={{ fontSize: "13px", color: "#333" }}>{records.length === 0 ? "Add your first record to get started" : "Try a different filter"}</div></div>
                  : <div style={{ display: "grid", gap: "10px" }}>
                    {filtered.map(r => (
                      <RecordCard key={r.id} record={r} onToggleLocation={toggleLocation} onMarkPlayed={markPlayed} onEdit={setEditRec} onDelete={deleteRecord} profiles={profiles} />
                    ))}
                  </div>
                }
              </>
            )}
            {tab === "history" && <History records={records} nights={nights} onSave={saveNight} onDelete={deleteNight} />}
            {tab === "themes" && <ThemeIdeas records={records} />}
            {tab === "guru" && <VinylGuru records={records} session={session} />}
          </>
        )}
      </div>
      {(showAdd || editRec) && (
        <AddEditModal
          record={editRec || null}
          onSave={saveRecord}
          onClose={() => { setShowAdd(false); setEditRec(null); }}
          profiles={profiles}
          session={session}
        />
      )}
    </div>
  );
}
