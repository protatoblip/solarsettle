import nodemailer from 'nodemailer';

const account = await nodemailer.createTestAccount();
const mailer = nodemailer.createTransport({
  host: account.smtp.host,
  port: account.smtp.port,
  secure: account.smtp.secure,
  auth: { user: account.user, pass: account.pass },
});

const sendDemo = async ({ subject, heading, detail, color }) => {
  const result = await mailer.sendMail({
    from: 'SolarSettle Alerts <alerts@solarsettle.demo>',
    to: 'government-ops@example.com',
    subject: `[SolarSettle demo] ${subject}`,
    text: `${heading}\n\n${detail}`,
    html: `<main style="font-family:Arial,sans-serif;color:#111827"><p style="color:${color};font-weight:700;text-transform:uppercase">SolarSettle SMTP demo</p><h2>${heading}</h2><p>${detail}</p></main>`,
  });
  console.log(`${heading}: ${nodemailer.getTestMessageUrl(result)}`);
};

await sendDemo({
  subject: 'Simulation · action required',
  heading: 'Simulated meter inactivity',
  detail: 'Ujjain, MP: no simulated smart-meter reading for 13 days. Reference: PMKUSUM-FRAUD-8174.',
  color: '#dc2626',
});

await sendDemo({
  subject: 'MetaMask · transaction confirmed',
  heading: 'MetaMask transaction confirmed',
  detail: 'Demo wallet settled 42 kWh. Transaction: 0xdemo42kwhconfirmed.',
  color: '#16a34a',
});

console.log('\nOpen either URL in a browser to view the temporary Ethereal inbox messages.');
