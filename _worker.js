/* Cloudflare Pages worker. Serves your site as normal and handles POST /api/intake.
   Settings → Variables and Secrets (Pages project):
     BREVO_API_KEY   (Secret)  your Brevo API key
     BREVO_LIST_ID             number of the Brevo list for Clarity Call intakes
     NOTIFY_EMAIL              where you want the full answers emailed
     SENDER_EMAIL              a sender you have verified in Brevo                    */

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const val = v => Array.isArray(v) ? v.join(', ') : String(v ?? '').trim();
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });

async function brevo(path, env, body) {
  return fetch('https://api.brevo.com/v3' + path, {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  });
}

async function handleIntake(request, env) {
  let d;
  try { d = await request.json(); } catch { return json({ ok: false }, 400); }
  if (d['bot-field']) return json({ ok: true });                       // spam trap

  const name = val(d.name), email = val(d.email).toLowerCase();
  if (!name || !/^\S+@\S+\.\S+$/.test(email)) return json({ ok: false, error: 'name and email required' }, 400);

  const [first, ...rest] = name.split(/\s+/);
  const listIds = env.BREVO_LIST_ID ? [Number(env.BREVO_LIST_ID)] : undefined;

  // 1) Create or update the contact in Brevo
  const full = { FIRSTNAME: first, LASTNAME: rest.join(' '), BUSINESS: val(d.business), LINKEDIN: val(d.linkedin),
                 WEBSITE: val(d.website), STARTING_POINT: val(d.starting_point) };
  let r = await brevo('/contacts', env, { email, attributes: full, listIds, updateEnabled: true });
  if (r.status === 400) {   // a custom attribute probably doesn't exist yet in Brevo: save the basics anyway
    r = await brevo('/contacts', env, { email, attributes: { FIRSTNAME: first, LASTNAME: rest.join(' ') }, listIds, updateEnabled: true });
  }
  const contactOk = r.ok;

  // 2) Email you the full answers
  const rows = [
    ['Name', name], ['Email', email], ['Business / brand', d.business], ['LinkedIn', d.linkedin], ['Website', d.website],
    ['Other link', d.other_link], ['Starting point', d.starting_point],
    ['1. What do you currently offer?', d.offer], ['2. Who are you trying to help?', d.audience],
    ['3. What problem do you help them solve?', d.problem], ['4. How do you currently explain what you do?', d.explain],
    ["5. What's happening right now?", d.happening], ['6. What have you tried?', d.tried], ['   What happened?', d.what_happened],
    ['7. What happens when someone becomes interested?', d.interest], ['8. What would make this call genuinely valuable?', d.valuable],
  ];
  const html = '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5">' +
    rows.map(([q, a]) => `<p><b>${esc(q)}</b><br>${esc(val(a)).replace(/\n/g, '<br>') || '<i>(blank)</i>'}</p>`).join('') + '</div>';
  const m = await brevo('/smtp/email', env, {
    sender: { email: env.SENDER_EMAIL, name: 'Clarity Call Intake' },
    to: [{ email: env.NOTIFY_EMAIL }],
    replyTo: { email, name },
    subject: `Clarity Call intake: ${name}`,
    htmlContent: html,
  });

  return (contactOk || m.ok) ? json({ ok: true }) : json({ ok: false }, 502);
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/intake') {
      return request.method === 'POST' ? handleIntake(request, env) : new Response('Method not allowed', { status: 405 });
    }
    return env.ASSETS.fetch(request);
  },
};
