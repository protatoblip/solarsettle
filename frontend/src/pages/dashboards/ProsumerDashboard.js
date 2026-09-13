import React, { useEffect, useState, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ethers } from 'ethers';
import { useWeb3 } from '../../context/Web3Context';
import useTx from '../../hooks/useTx';
import './BuyerDashboard.css';
import './ProsumerDashboard.css';
import { generateReading } from '../../lib/meterSimulator';
import { notifySimulationAlert } from '../../lib/alertMailer';

const DEMO_PROFILE = {
  subsidyID: 'PM-KUSUM-2025-031', panelCapacity: 8000, location: 'Ujjain, MP',
  pendingApproval: false, registered: true, trustScore: 96,
  totalEnergyGenerated: 8420, carbonCredits: 8420,
  totalConsumed: 5120, totalEarnings: 0.285
};

const DEMO_LISTINGS = [
  { id: 101, kWh: 12, priceDisplay: '0.0004', active: true },
  { id: 102, kWh: 6, priceDisplay: '0.0005', active: true },
];

export default function ProsumerDashboard() {
  const { isWalletConnected, account, contract, connectWallet, connecting, logout } = useWeb3();
  const { pending, toast, run, setToast } = useTx();
  const locationPath = useLocation().pathname;
  
  const [profile, setProfile] = useState(null);
  const [liveReading, setLiveReading] = useState(() => generateReading());
  const [readingHistory, setReadingHistory] = useState(() =>
    Array.from({ length: 12 }, () => generateReading()));
  const [form, setForm] = useState({ subsidyId: '', capacityKw: '', location: '' });
  const [listForm, setListForm] = useState({ kwh: '', price: '' });
  const [demoMode, setDemoMode] = useState(false);
  const [myListings, setMyListings] = useState([]);

  const loadProfile = useCallback(async () => {
    if (!contract || !isWalletConnected) {
      setProfile(DEMO_PROFILE); setDemoMode(true); setMyListings(DEMO_LISTINGS); return;
    }
    setDemoMode(false);
    try {
      const p = await contract.getProsumer(account);
      const count = Number(await contract.listingCount());
      const mine = [];
      let simulatedEarnings = 0;
      for (let i = 0; i < count; i++) {
        const l = await contract.listings(i);
        if (l.active && l.seller.toLowerCase() === account.toLowerCase()) {
          mine.push({ id: i, kWh: Number(l.kWh), pricePerUnit: l.pricePerUnit, priceDisplay: ethers.formatEther(l.pricePerUnit), active: true });
        } else if (!l.active && l.seller.toLowerCase() === account.toLowerCase()) {
          // Add closed listings as simulated earnings
          simulatedEarnings += Number(l.kWh) * Number(ethers.formatEther(l.pricePerUnit));
        }
      }
      setMyListings(mine);
      setProfile({ subsidyID: p.subsidyID, panelCapacity: Number(p.panelCapacity), location: p.location, pendingApproval: p.pendingApproval, registered: p.registered, trustScore: Number(p.trustScore), totalEnergyGenerated: Number(p.totalEnergyGenerated), carbonCredits: Number(p.carbonCredits), totalConsumed: Math.floor(Number(p.totalEnergyGenerated) * 0.65), totalEarnings: simulatedEarnings });
    } catch (e) { console.error(e); }
  }, [contract, account, isWalletConnected]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  useEffect(() => {
    const t = setInterval(() => {
      const r = generateReading();
      setLiveReading(r);
      setReadingHistory((cur) => [...cur.slice(-13), r]);
    }, 5000);
    return () => clearInterval(t);
  }, []);

  const maxDailyKwh = profile ? Math.floor((profile.panelCapacity * 24) / 1000) : 0;
  const maxBarKwh = Math.max(...readingHistory.map((r) => r.kWh), 1);
  const avgKwh = (readingHistory.reduce((s, r) => s + r.kWh, 0) / readingHistory.length).toFixed(1);

  const handleRegister = async (e) => {
    e.preventDefault();
    const capacityW = Math.round(parseFloat(form.capacityKw) * 1000);
    if (!form.subsidyId || !capacityW || !form.location) return;
    const ok = await run(() => contract.registerProsumer(form.subsidyId, capacityW, form.location), 'Registration submitted - awaiting government approval.');
    if (ok) { setForm({ subsidyId: '', capacityKw: '', location: '' }); await loadProfile(); }
  };

  const handleLogReading = async () => {
    if (demoMode) {
      const kwh = Math.round(liveReading.kWh);
      setProfile((c) => ({ ...c, totalEnergyGenerated: c.totalEnergyGenerated + kwh, carbonCredits: c.carbonCredits + kwh, trustScore: Math.min(100, c.trustScore + 2) }));
      setToast({ kind: 'ok', text: 'Demo meter reading logged - profile totals updated.' });
      notifySimulationAlert({ title: 'Simulated meter reading recorded', detail: `${kwh} kWh was added to the Ujjain demo prosumer profile.`, subject: DEMO_PROFILE.subsidyID, stats: { Location: DEMO_PROFILE.location, 'Reading added': `${kwh} kWh`, 'Total generated': `${profile.totalEnergyGenerated + kwh} kWh`, 'Trust score': `${Math.min(100, profile.trustScore + 2)}/100`, 'Carbon credits': String(profile.carbonCredits + kwh) } });
      return;
    }
    const kwh = Math.max(1, Math.round(liveReading.kWh));
    const ok = await run(() => contract.logEnergyGeneration(kwh), 'Logged ' + kwh + ' kWh on-chain - trust score and carbon credits updated.');
    if (ok) await loadProfile();
  };

  const handleList = async (e) => {
    e.preventDefault();
    if (demoMode) {
      setToast({ kind: 'ok', text: 'Demo surplus listing created.' });
      notifySimulationAlert({ title: 'Simulated energy listing created', detail: `${listForm.kwh || 'New'} kWh of demo surplus was listed for the marketplace.`, subject: DEMO_PROFILE.subsidyID });
      setListForm({ kwh: '', price: '' });
      return;
    }
    const kwh = parseInt(listForm.kwh, 10);
    if (!kwh || !listForm.price) return;
    const ok = await run(() => contract.listEnergy(kwh, ethers.parseEther(listForm.price)), 'Energy listed on the marketplace.');
    if (ok) { setListForm({ kwh: '', price: '' }); await loadProfile(); }
  };

  const handleCancel = async (listing) => {
    if (demoMode) {
      setMyListings((cur) => cur.filter((l) => l.id !== listing.id));
      setToast({ kind: 'ok', text: 'Demo listing #' + listing.id + ' removed.' });
      notifySimulationAlert({ title: 'Simulated energy listing cancelled', detail: `Demo listing #${listing.id} was removed from the marketplace.`, subject: DEMO_PROFILE.subsidyID });
      return;
    }
    const ok = await run(() => contract.cancelListing(listing.id), 'Listing #' + listing.id + ' cancelled.');
    if (ok) await loadProfile();
  };

  const short = (a) => a ? (a.slice(0, 6) + '...' + a.slice(-4)) : '';

  return (
    <div id="solarsettle-buyer-dashboard">
      <div className="ss-app">
        {/* Sidebar */}
        <aside className="ss-sidebar">
          <Link to="/" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="ss-brand">
              <div className="ss-brand-mark">☀</div>
              <div>
                <strong>SolarSettle</strong>
                <span>Clean energy. Trusted together.</span>
              </div>
            </div>
          </Link>

          <nav className="ss-nav">
            <Link to="/prosumer" style={{ textDecoration: 'none' }}>
              <button className="ss-nav-item active">
                <span className="ss-nav-icon">⌂</span>
                <span>Overview</span>
              </button>
            </Link>
            <Link to="/buyer" style={{ textDecoration: 'none' }}>
              <button className="ss-nav-item">
                <span className="ss-nav-icon">◫</span>
                <span>Marketplace</span>
              </button>
            </Link>
            <button className="ss-nav-item">
              <span className="ss-nav-icon">⌁</span>
              <span>Connections</span>
            </button>
            <button className="ss-nav-item">
              <span className="ss-nav-icon">◉</span>
              <span>My Energy</span>
            </button>
            <button className="ss-nav-item">
              <span className="ss-nav-icon">↔</span>
              <span>Transactions</span>
            </button>
            <button className="ss-nav-item">
              <span className="ss-nav-icon">⚙</span>
              <span>Settings</span>
            </button>
          </nav>

          <div className="ss-sidebar-help">
            <span>Need help?</span>
            <button>Support Center</button>
          </div>

          <button className="ss-logout" onClick={logout}>↪ Log Out</button>
        </aside>

        {/* Main Content Area */}
        <main className="ss-main">
          {/* Header */}
          <header className="ss-header">
            <div className="ss-mobile-menu">☰</div>
            <div className="ss-search">
              <span>⌕</span>
              <input placeholder="Search your listings, stats..." />
            </div>
            <div className="ss-header-actions">
              <button className="ss-icon-button">♢</button>
              <button className="ss-avatar">P</button>
            </div>
          </header>

          <div className="ss-content">
            
            <section className="ss-page-head">
              <div>
                <div className="ss-eyebrow">PROSUMER CONSOLE</div>
                <h1>My solar generation & trading</h1>
                <p>
                  {isWalletConnected
                    ? 'Connected: ' + short(account)
                    : 'Presentation preview with sample meter data.'}
                </p>
              </div>
              <div className="ss-location-pill">
                ⌖ {profile?.location || 'Select Location'}
                <button>Change</button>
              </div>
            </section>

            {demoMode && (
              <div className="demo-banner">
                <div>
                  <strong>Demo presentation mode</strong>
                  <span>Sample meter and prosumer values are shown for review. Connect MetaMask to use live contract actions.</span>
                </div>
              </div>
            )}

            {profile && !profile.registered && !demoMode && (
              <div className="ss-card" style={{ marginBottom: '24px' }}>
                <div className="ss-card-head">
                  <div>
                    <span className="ss-label">Getting started</span>
                    <h2>Register your solar panel</h2>
                  </div>
                </div>
                {profile.pendingApproval ? (
                  <span className="ss-badge warning" style={{ padding: '8px 12px', fontSize: '12px' }}>
                    <span className="ss-status-dot"></span>
                    Awaiting government approval — this page updates once approved.
                  </span>
                ) : (
                  <>
                    <p style={{ color: 'var(--ss-muted)', marginTop: '0', fontSize: '13px' }}>Submit your subsidy ID and panel details. The DISCOM approves registrations on-chain.</p>
                    <form onSubmit={handleRegister} className="form-row" style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
                      <input className="ss-text-input" placeholder="Subsidy ID (e.g. PMKUSUM-2024-0142)" value={form.subsidyId} onChange={(e) => setForm({ ...form, subsidyId: e.target.value })} style={{ flex: 1 }} />
                      <input className="ss-text-input" type="number" step="0.1" min="0.1" placeholder="Capacity (kW)" value={form.capacityKw} onChange={(e) => setForm({ ...form, capacityKw: e.target.value })} style={{ flex: 1 }} />
                      <input className="ss-text-input" placeholder="Location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} style={{ flex: 1 }} />
                      <button type="submit" className="ss-button primary" disabled={pending}>{pending ? '...' : 'Register'}</button>
                    </form>
                  </>
                )}
              </div>
            )}

            {/* Live meter hero - utilizing BuyerDashboard's ss-weather-card logic */}
            <div className="ss-card ss-weather-card" style={{ marginBottom: '24px' }}>
              <div className="ss-card-head">
                <div>
                  <span className="ss-label" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--ss-primary)' }}>
                    <span className="ss-status-dot" style={{ background: 'var(--ss-primary)' }}></span>
                    {demoMode ? 'Sample Meter Reading' : 'Live Meter Reading'}
                  </span>
                  <h2>Generation telemetry active</h2>
                </div>
                <button className="ss-button primary" onClick={handleLogReading} disabled={pending || (profile && !profile.registered && !demoMode)} style={{ minHeight: '32px' }}>
                  {demoMode ? 'Log sample reading' : pending ? 'Confirming...' : 'Log to Blockchain'}
                </button>
              </div>

              <div className="ss-weather-main">
                <div className="ss-weather-temp">
                  {liveReading.kWh} <span style={{ fontSize: '20px', color: 'var(--ss-muted)' }}>kWh</span>
                </div>
                <div>
                  <strong>Meter {liveReading.meterId}</strong>
                  <span>{new Date(liveReading.timestamp).toLocaleTimeString()}</span>
                </div>
              </div>

              <div className="ss-weather-stats">
                <div><span>Voltage</span><strong>{liveReading.voltage} V</strong></div>
                <div><span>Status</span><strong className="ss-positive">Healthy</strong></div>
                <div><span>Network</span><strong>Connected</strong></div>
                <div><span>Smart Meter</span><strong className="ss-positive">Verified</strong></div>
              </div>
            </div>

            {/* KPIs */}
            {profile && (
              <section className="ss-metrics-grid" style={{ marginBottom: '24px' }}>
                <div className="ss-card ss-metric-card">
                  <span className="ss-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                    Net Surplus 
                    <span style={{ fontSize: '11px', color: 'var(--ss-primary)', background: 'var(--ss-surface-2)', padding: '2px 6px', borderRadius: '4px' }}>SELLABLE</span>
                  </span>
                  <strong style={{ color: 'var(--ss-text)' }}>{(profile.totalEnergyGenerated - profile.totalConsumed).toLocaleString('en-IN')} kWh</strong>
                  <span className="ss-muted">Out: {profile.totalEnergyGenerated} • In: {profile.totalConsumed}</span>
                </div>
                <div className="ss-card ss-metric-card">
                  <span className="ss-label">Total Revenue</span>
                  <strong style={{ color: 'var(--ss-primary)' }}>{profile.totalEarnings.toFixed(3)} Ξ</strong>
                  <span className="ss-muted">From P2P energy sales</span>
                </div>
                <div className="ss-card ss-metric-card">
                  <span className="ss-label">Carbon Impact</span>
                  <strong style={{ color: 'var(--ss-green)' }}>{Math.floor(profile.carbonCredits / 20)} Trees</strong>
                  <span className="ss-muted">From {profile.carbonCredits.toLocaleString('en-IN')} offset credits</span>
                </div>
                <div className="ss-card ss-metric-card">
                  <span className="ss-label">Panel Capacity</span>
                  <strong style={{ color: 'var(--ss-orange)' }}>{(profile.panelCapacity / 1000).toFixed(1)} kW</strong>
                  <span className="ss-muted">Max {maxDailyKwh} kWh / round</span>
                </div>
              </section>
            )}

            <section className="ss-grid-two">
              {/* Generation activity */}
              <div className="ss-card">
                <div className="ss-card-head">
                  <div>
                    <span className="ss-label">Generation Activity</span>
                    <h2>Last 14 meter readings</h2>
                  </div>
                </div>
                <div className="ps-chart">
                  {readingHistory.map((r, i) => (
                    <div
                      key={r.timestamp}
                      className={'ps-bar' + (i === readingHistory.length - 1 ? ' latest' : '')}
                      style={{ height: Math.max(4, (r.kWh / maxBarKwh) * 100) + '%' }}
                      data-value={r.kWh + ' kWh'}
                    ></div>
                  ))}
                </div>
                <div className="ps-chart-meta"><span>14 readings ago</span><span>now</span></div>
              </div>

               {/* List surplus form */}
              {profile && profile.registered && (
                <div className="ss-card">
                  <div className="ss-card-head">
                    <div>
                      <span className="ss-label">Sell</span>
                      <h2>List surplus energy</h2>
                    </div>
                  </div>
                  <p style={{ color: 'var(--ss-muted)', fontSize: '13px', marginTop: 0 }}>Max plausible per reading: {maxDailyKwh} kWh (derived from capacity).</p>
                  <form onSubmit={handleList} style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '16px' }}>
                    <div>
                      <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--ss-muted)', marginBottom: '4px', display: 'block' }}>Energy (kWh)</label>
                      <input className="ss-text-input" style={{ width: '100%' }} type="number" step="1" min="1" placeholder="kWh to sell" value={listForm.kwh} onChange={(e) => setListForm({ ...listForm, kwh: e.target.value })} />
                    </div>
                    <div>
                      <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--ss-muted)', marginBottom: '4px', display: 'block' }}>Price per kWh (token)</label>
                      <input className="ss-text-input" style={{ width: '100%' }} type="number" step="0.0001" min="0" placeholder="0.00" value={listForm.price} onChange={(e) => setListForm({ ...listForm, price: e.target.value })} />
                    </div>
                    <button type="submit" className="ss-button primary" style={{ marginTop: '4px' }} disabled={pending}>{demoMode ? 'List sample surplus' : pending ? 'Confirming...' : 'List on Marketplace'}</button>
                  </form>
                </div>
              )}
            </section>

             {/* Connect wallet */}
            {!isWalletConnected && (
              <div className="ss-card" style={{ marginBottom: '24px' }}>
                <div className="ss-card-head">
                  <div>
                    <span className="ss-label">Blockchain</span>
                    <h2>Go live with MetaMask</h2>
                  </div>
                </div>
                <p style={{ color: 'var(--ss-muted)', fontSize: '13px', marginTop: 0, marginBottom: '16px' }}>Connect your wallet to register, log real readings, and trade on the marketplace.</p>
                <button className="ss-button primary" onClick={connectWallet} disabled={connecting}>{connecting ? 'Connecting...' : 'Connect MetaMask'}</button>
              </div>
            )}

            {/* Marketplace & Settlements */}
            <section className="ss-grid-two">
              {/* My listings */}
              <div className="ss-card">
                <div className="ss-card-head">
                  <div>
                    <span className="ss-label">Marketplace</span>
                    <h2>My active listings</h2>
                  </div>
                  <Link to="/buyer" style={{ textDecoration: 'none' }} className="ss-label">View market →</Link>
                </div>
                {myListings.length === 0 ? (
                  <p style={{ color: 'var(--ss-muted)', fontSize: '13px', margin: 0 }}>No active listings. List surplus energy to start selling.</p>
                ) : (
                  <div style={{ overflowX: 'auto', marginTop: '16px' }}>
                    <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse', fontSize: '13px' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--ss-border)' }}>
                          <th style={{ padding: '8px', color: 'var(--ss-muted)', fontWeight: 600 }}>Energy</th>
                          <th style={{ padding: '8px', color: 'var(--ss-muted)', fontWeight: 600 }}>Price</th>
                          <th style={{ padding: '8px', color: 'var(--ss-muted)', fontWeight: 600 }}>Total</th>
                          <th style={{ padding: '8px' }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {myListings.map((l) => (
                          <tr key={l.id} style={{ borderBottom: '1px solid var(--ss-border)' }}>
                            <td style={{ padding: '8px' }}><strong>{l.kWh}</strong> kWh</td>
                            <td style={{ padding: '8px' }}>{l.priceDisplay}</td>
                            <td style={{ padding: '8px' }}><strong>{(l.kWh * parseFloat(l.priceDisplay)).toFixed(4)}</strong></td>
                            <td style={{ padding: '8px', textAlign: 'right' }}>
                              <button className="ss-button" style={{ minHeight: '28px', fontSize: '11px', color: 'var(--ss-red)', border: 'none', background: 'transparent' }} onClick={() => handleCancel(l)} disabled={pending}>Cancel</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Recent Settlements */}
              <div className="ss-card">
                <div className="ss-card-head">
                  <div>
                    <span className="ss-label" style={{ color: 'var(--ss-green)' }}>Payments</span>
                    <h2>Recent Settlements</h2>
                  </div>
                </div>
                <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '14px', borderBottom: '1px solid var(--ss-border)' }}>
                    <div>
                      <strong style={{ display: 'block', fontSize: '14px' }}>+ 0.0048 Ξ</strong>
                      <span style={{ fontSize: '12px', color: 'var(--ss-muted)' }}>Sold 12 kWh to Grid Node #92</span>
                    </div>
                    <span style={{ fontSize: '11px', background: 'var(--ss-surface-2)', padding: '4px 8px', borderRadius: '4px', color: 'var(--ss-text)' }}>Today</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '14px', borderBottom: '1px solid var(--ss-border)' }}>
                    <div>
                      <strong style={{ display: 'block', fontSize: '14px' }}>+ 0.0090 Ξ</strong>
                      <span style={{ fontSize: '12px', color: 'var(--ss-muted)' }}>Sold 18 kWh to Buyer 0x7a...bc</span>
                    </div>
                    <span style={{ fontSize: '11px', background: 'var(--ss-surface-2)', padding: '4px 8px', borderRadius: '4px', color: 'var(--ss-text)' }}>Yesterday</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <strong style={{ display: 'block', fontSize: '14px' }}>+ 0.0025 Ξ</strong>
                      <span style={{ fontSize: '12px', color: 'var(--ss-muted)' }}>Sold 5 kWh to Commercial Sub A</span>
                    </div>
                    <span style={{ fontSize: '11px', background: 'var(--ss-surface-2)', padding: '4px 8px', borderRadius: '4px', color: 'var(--ss-text)' }}>Oct 12</span>
                  </div>
                </div>
              </div>
            </section>
            
          </div>
        </main>
      </div>
      {toast && (
        <div style={{ position: 'fixed', bottom: '24px', right: '24px', background: 'var(--ss-text)', color: 'white', padding: '12px 20px', borderRadius: '12px', zIndex: 9999, boxShadow: 'var(--ss-shadow)', fontSize: '14px', fontWeight: 500 }}>
          {toast.text}
        </div>
      )}
    </div>
  );
}
