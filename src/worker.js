// POST /api/intake  ->  saves the Diagnostic intake to Brevo and emails you a full copy.
// Written as a Cloudflare Pages Function. No secrets live in book.html; they live in environment variables.
//
// Environment variables to set (see brevo-intake-setup.md):
//   BREVO_API_KEY        your Brevo API key (v3)
//   BREVO_LIST_INTAKE    numeric ID of the list "Diagnostic - Intake Received"
//   BREVO_LIST_MARKETING numeric ID of your opted-in newsletter list (optional)
//   NOTIFY_EMAIL         where you want the full intake emailed (your inbox)
//   SENDER_EMAIL         a sender you have verified in Brevo
//   SENDER_NAME          optional, defaults to "Brenda Blanche"

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
const cut = (v, n = 1000) => String(v ?? "").trim().slice(0, n);
const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function onRequestPost({ request, env }) {
  let b;
  try { b = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const email = cut(b.email, 200).toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email) || b.consent !== true) return json({ error: "Missing email or consent" }, 400);
  if (!env.BREVO_API_KEY || !env.BREVO_LIST_INTAKE) return json({ error: "Server not configured" }, 500);

  const attributes = {
    FIRSTNAME: cut(b.name, 100),
    CITY_COUNTRY: cut(b.place, 200),
    ROLE: cut(b.role, 300),
    YEARS: cut(b.years, 60),
    SKILLS: cut(b.skills),
    EXPLAIN: cut(b.explain),
    BUYER: cut(b.buyer),
    SPOKE: cut(b.spoke, 60),
    STUCK: cut(b.stuck),
    TRIED: cut(b.tried),
    TRIED_NOTES: cut(b.triednotes),
    PROOF: cut(b.proof),
    PAID_BEFORE: cut(b.paid, 100),
    PRICE: cut(b.price, 200),
    LINKEDIN: cut(b.linkedin, 300),
    WEBSITE: cut(b.site, 300),
    OTHER_LINK: cut(b.other, 300),
    DECISION: cut(b.decision),
    EXTRA: cut(b.extra),
    INTAKE_DATE: new Date().toISOString().slice(0, 10),
    INTAKE_STATUS: "Received",
    BOOKING_STATUS: "Not booked yet",
    MARKETING_OPTIN: b.mkt === true,
  };

  const listIds = [Number(env.BREVO_LIST_INTAKE)];
  if (b.mkt === true && env.BREVO_LIST_MARKETING) listIds.push(Number(env.BREVO_LIST_MARKETING));

  const headers = { "api-key": env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" };

  // 1) Create or update the contact and add it to the list(s). 201 = created, 204 = updated.
  const c = await fetch("https://api.brevo.com/v3/contacts", {
    method: "POST", headers,
    body: JSON.stringify({ email, attributes, listIds, updateEnabled: true }),
  });
  if (!c.ok) {
    console.error("Brevo contact error", c.status, await c.text());
    return json({ error: "Could not save intake" }, 502);
  }

  // 2) Email you the full, untruncated intake. A failure here never blocks the visitor.
  if (env.NOTIFY_EMAIL && env.SENDER_EMAIL) {
    const rows = [
      ["Name", b.name], ["Email", email], ["Based in", b.place], ["Work", b.role], ["Years", b.years],
      ["Skills / work they could be hired for", b.skills], ["What they say today", b.explain],
      ["Who needs it", b.buyer], ["Spoken to buyers", b.spoke], ["Where it feels stuck", b.stuck],
      ["What they tried", b.tried], ["What happened", b.triednotes], ["Proof", b.proof],
      ["Paid before", b.paid], ["Price", b.price], ["LinkedIn", b.linkedin], ["Website", b.site],
      ["Other link", b.other], ["1 decision wanted", b.decision], ["Anything else", b.extra],
      ["Newsletter opt-in", b.mkt === true ? "Yes" : "No"],
    ];
    const html = "<h2>New Diagnostic intake</h2>" + rows.filter(r => r[1]).map(r => `<p><b>${esc(r[0])}</b><br>${esc(r[1]).replace(/\n/g, "<br>")}</p>`).join("");
    try {
      const m = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST", headers,
        body: JSON.stringify({
          sender: { email: env.SENDER_EMAIL, name: env.SENDER_NAME || "Brenda Blanche" },
          to: [{ email: env.NOTIFY_EMAIL }],
          replyTo: { email },
          subject: `New intake: ${cut(b.name, 60)} - Market Perception Diagnostic`,
          htmlContent: html,
        }),
      });
      if (!m.ok) console.error("Brevo email error", m.status, await m.text());
    } catch (e) { console.error("Brevo email exception", String(e)); }
  }
  return json({ ok: true });
}
