import { useState, useCallback } from 'react';
import { notifyAlert } from '../lib/alertMailer';

/**
 * Small wrapper around contract write transactions: pending state,
 * success/error messaging, and a toast that auto-dismisses.
 */
export default function useTx() {
  const [pending, setPending] = useState(false);
  const [toast, setToast] = useState(null);

  const run = useCallback(async (action, successMsg, metadata = {}) => {
    setPending(true);
    setToast({ kind: 'pending', text: '⏳ Waiting for confirmation in MetaMask…' });
    try {
      const tx = await action();
      setToast({ kind: 'pending', text: '⏳ Transaction submitted — waiting for confirmation…' });
      await tx.wait();
      setToast({ kind: 'ok', text: successMsg });
      notifyAlert({
        tone: 'green',
        title: 'MetaMask transaction confirmed',
        detail: `${successMsg}${tx.hash ? ` Transaction: ${tx.hash}` : ''}`,
        subject: metadata.subject || metadata.wallet || 'Wallet transaction',
        stats: { Status: 'Confirmed', Wallet: tx.from || metadata.wallet || 'Not reported by wallet', 'Transaction hash': tx.hash || 'Not available' },
        source: 'metamask',
      }, metadata.scope || 'Blockchain settlement');
      setTimeout(() => setToast(null), 6000);
      setPending(false);
      return true;
    } catch (e) {
      const reason = e?.info?.error?.message || e?.reason || e?.shortMessage || e?.message;
      notifyAlert({
        tone: e?.code === 4001 ? 'amber' : 'red',
        title: e?.code === 4001 ? 'MetaMask transaction rejected' : 'MetaMask transaction failed',
        detail: String(reason || 'Transaction failed').slice(0, 1000),
        subject: metadata.subject || metadata.wallet || 'Wallet transaction',
        stats: { Status: e?.code === 4001 ? 'Rejected in MetaMask' : 'Failed', Wallet: metadata.wallet || 'Not reported by wallet' },
        source: 'metamask',
      }, metadata.scope || 'Blockchain settlement');
      setToast({
        kind: 'err',
        text: `❌ ${e?.code === 4001 ? 'Transaction rejected in MetaMask.' : reason || 'Transaction failed'}`,
      });
      setTimeout(() => setToast(null), 8000);
      setPending(false);
      return false;
    }
  }, []);

  return { pending, toast, run, setToast };
}
