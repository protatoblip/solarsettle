const endpoint = process.env.REACT_APP_ALERT_MAIL_API || 'http://localhost:8787/api/alerts/email';

export async function sendAlertEmail(alert, scope) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...alert, scope }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Unable to send alert email.');
  return payload;
}

// Delivery is deliberately best-effort: SMTP status must never block a wallet
// transaction or a local simulation from completing.
export function notifyAlert(alert, scope = 'All India') {
  return sendAlertEmail(alert, scope).catch((error) => {
    console.warn('SolarSettle alert email was not delivered:', error.message);
    return null;
  });
}

export function notifySimulationAlert({ title, detail, subject = 'Simulated data', tone = 'green', stats }) {
  return notifyAlert({ tone, title, detail, subject, stats, source: 'simulation' });
}
