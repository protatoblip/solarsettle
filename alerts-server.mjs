import 'dotenv/config';
import http from 'node:http';
import nodemailer from 'nodemailer';

const port = Number(process.env.ALERT_MAIL_PORT || 8787);
const recipients = (process.env.ALERT_RECIPIENTS || '').split(',').map((email) => email.trim()).filter(Boolean);
const allowedOrigin = process.env.ALERT_MAIL_ORIGIN || 'http://localhost:3000';
const validTones = new Set(['red', 'amber', 'green']);
const validSources = new Set(['simulation', 'metamask', 'monitoring']);
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': allowedOrigin });
  response.end(JSON.stringify(body));
}

function transporter() {
  const password = process.env.SMTP_PASS || '';
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !recipients.length || !password || password.includes('PASTE_YOUR') || password.includes('replace-with')) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

function isShortText(value, maxLength) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function alertStats(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value)
    .filter(([label, stat]) => isShortText(label, 60) && isShortText(String(stat), 240))
    .slice(0, 12);
}

http.createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, { 'Access-Control-Allow-Origin': allowedOrigin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    return response.end();
  }
  if (request.method !== 'POST' || request.url !== '/api/alerts/email') return sendJson(response, 404, { error: 'Not found' });
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  let alert;
  try { alert = JSON.parse(Buffer.concat(chunks).toString()); } catch { return sendJson(response, 400, { error: 'Invalid JSON body' }); }
  if (!isShortText(alert?.title, 160) || !isShortText(alert?.detail, 1200) || !validTones.has(alert.tone)) return sendJson(response, 400, { error: 'Invalid alert payload' });
  if (alert.source && !validSources.has(alert.source)) return sendJson(response, 400, { error: 'Invalid alert source' });
  if (alert.subject && !isShortText(alert.subject, 200)) return sendJson(response, 400, { error: 'Invalid alert reference' });
  if (alert.stats && (typeof alert.stats !== 'object' || Array.isArray(alert.stats))) return sendJson(response, 400, { error: 'Invalid alert statistics' });
  const mailer = transporter();
  if (!mailer) return sendJson(response, 503, { error: 'Mail service is not configured. Set SMTP_HOST, SMTP_USER, ALERT_RECIPIENTS, and a valid SMTP_PASS (for Gmail, use a Google App Password) in .env, then restart the alert server.' });
  const source = alert.source === 'metamask' ? 'MetaMask' : alert.source === 'simulation' ? 'Simulation' : 'Monitoring';
  const subject = `[SolarSettle] ${source} · ${alert.tone === 'red' ? 'Action required' : alert.tone === 'amber' ? 'Review required' : 'Update'}: ${alert.title}`;
  try {
    const severity = alert.tone === 'red' ? 'CRITICAL' : alert.tone === 'amber' ? 'WARNING' : 'INFO';
    const color = alert.tone === 'red' ? '#dc2626' : alert.tone === 'amber' ? '#b45309' : '#16a34a';
    const stats = alertStats(alert.stats);
    const textStats = stats.length ? `\n\nRelevant statistics:\n${stats.map(([label, value]) => `- ${label}: ${value}`).join('\n')}` : '';
    const htmlStats = stats.length ? `<table style="width:100%;border-collapse:collapse;margin-top:20px"><caption style="text-align:left;font-weight:700;margin-bottom:8px">Relevant statistics</caption><tbody>${stats.map(([label, value]) => `<tr><td style="padding:8px;border-top:1px solid #e5e7eb;color:#6b7280">${escapeHtml(label)}</td><td style="padding:8px;border-top:1px solid #e5e7eb;font-weight:600">${escapeHtml(value)}</td></tr>`).join('')}</tbody></table>` : '';
    const result = await mailer.sendMail({
      from: process.env.ALERT_MAIL_FROM || process.env.SMTP_USER,
      to: recipients.join(', '),
      subject: `[SolarSettle] ${severity} | ${source}: ${alert.title}`,
      text: `${severity} — ${alert.title}\n\n${alert.detail}\n\nSource: ${source}\nScope: ${alert.scope || 'All India'}\nReference: ${alert.subject || 'SolarSettle'}\nTimestamp: ${new Date().toISOString()}${textStats}`,
      html: `<main style="max-width:620px;font-family:Arial,sans-serif;color:#111827"><div style="padding:12px 16px;background:${color};color:#fff;font-weight:700;letter-spacing:.04em">${severity} · SOLARSETTLE ${escapeHtml(source).toUpperCase()} ALERT</div><div style="padding:20px;border:1px solid #e5e7eb"><h2 style="margin-top:0">${escapeHtml(alert.title)}</h2><p style="line-height:1.5">${escapeHtml(alert.detail)}</p><table style="width:100%;border-collapse:collapse"><tbody><tr><td style="padding:8px;border-top:1px solid #e5e7eb;color:#6b7280">Scope</td><td style="padding:8px;border-top:1px solid #e5e7eb;font-weight:600">${escapeHtml(alert.scope || 'All India')}</td></tr><tr><td style="padding:8px;border-top:1px solid #e5e7eb;color:#6b7280">Reference</td><td style="padding:8px;border-top:1px solid #e5e7eb;font-weight:600">${escapeHtml(alert.subject || 'SolarSettle')}</td></tr><tr><td style="padding:8px;border-top:1px solid #e5e7eb;color:#6b7280">Timestamp (UTC)</td><td style="padding:8px;border-top:1px solid #e5e7eb;font-weight:600">${new Date().toISOString()}</td></tr></tbody></table>${htmlStats}</div></main>`,
    });
    return sendJson(response, 202, { accepted: true, id: result.messageId, recipients });
  } catch (error) {
    console.error('Alert email failed:', error.message);
    return sendJson(response, 502, { error: 'SMTP delivery failed. Check the server logs and SMTP settings.' });
  }
}).listen(port, () => console.log(`SolarSettle alert mail service listening on http://localhost:${port}`));
