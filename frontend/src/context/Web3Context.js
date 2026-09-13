import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { ethers } from 'ethers';
import abiJson from '../SolarSettleABI.json';
import { CONTRACT_ADDRESS, CONTRACT_CHAIN_ID, getChain, isContractConfigured } from '../config';

const CONTRACT_ABI = abiJson.abi;
const ROLE_STORAGE_KEY = 'solarsettle.role';

const Web3Context = createContext(null);
export const useWeb3 = () => useContext(Web3Context);

export const ROLE_HOME = {
  government: '/govt',
  prosumer: '/prosumer',
  buyer: '/buyer',
};

const initialRole = () => {
  try {
    const stored = window.localStorage.getItem(ROLE_STORAGE_KEY);
    return ROLE_HOME[stored] ? stored : null;
  } catch {
    return null;
  }
};

export function Web3Provider({ children }) {
  const [selectedRole, setSelectedRole] = useState(initialRole);
  const [account, setAccount] = useState(null);
  const [contract, setContract] = useState(null);
  const [readProvider, setReadProvider] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [chainMismatch, setChainMismatch] = useState(false);
  const [currentChainName, setCurrentChainName] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const configured = isContractConfigured();
  const walletAvailable = typeof window !== 'undefined' && !!window.ethereum;

  // ------------------------------------------------------------------
  // Network awareness
  // ------------------------------------------------------------------
  /** True when MetaMask's connected chain differs from the chain the
   *  contract was deployed to. Drives the network-warning banners. */
  const networkMatches = () => !chainMismatch;

  /** The contract was deployed to this chainId. A wallet on a different
   *  chain produces a mismatch warning everywhere. */
  const deployedChainName = () => {
    const chain = getChain(CONTRACT_CHAIN_ID);
    return chain?.chainName || ('Chain ' + CONTRACT_CHAIN_ID);
  };

  // ------------------------------------------------------------------
  // Role resolution helpers
  // ------------------------------------------------------------------
  /** True when the connected wallet is the contract owner (government). */
  const isOwner = () => account != null && contract != null && account.toLowerCase() === contract.signer.address.toLowerCase();

  /** True when the connected wallet is a registered prosumer. */
  const isRegisteredProsumer = async () => {
    if (!account || !contract) return false;
    try {
      return (await contract.prosumers(account)).registered;
    } catch {
      return false;
    }
  };

  /** True when a wallet is connected and the role matches the connected
   *  wallet's authority (govt → owner, prosumer → registered). */
  const roleAuthorityMatches = async () => {
    if (!account || !contract) return false;
    if (selectedRole === 'government') return isOwner();
    if (selectedRole === 'prosumer' || selectedRole === 'pending-prosumer') {
      try { return (await contract.prosumers(account)).registered || (await contract.prosumers(account)).pendingApproval; }
      catch { return false; }
    }
    return true; // buyer has no wallet authority requirement
  };

  // ------------------------------------------------------------------
  // Wallet connect / disconnect
  // ------------------------------------------------------------------
  const connectWallet = useCallback(async () => {
    if (!walletAvailable) { setError('MetaMask not detected'); return false; }
    setConnecting(true); setError('');
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const acct = accounts[0];
      const prov = new ethers.BrowserProvider(window.ethereum);
      setAccount(acct);

      // Detect the currently connected chain and report mismatch.
      const currentChainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
      const curId = parseInt(currentChainIdHex, 16);
      setChainId(curId);
      const chain = getChain(curId);
      setCurrentChainName(chain?.chainName || 'Unknown chain (' + curId + ')');
      setChainMismatch(curId !== CONTRACT_CHAIN_ID);

      // Injected provider throws if the wallet is on a chain the ABIs
      // don't cover; keep read fallback safe.
      try {
        const signerContract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, prov.getSigner());
        setContract(signerContract);
      } catch (ce) {
        setError('Wallet connected — but contract call failed on this chain.');
        setContract(null);
      }

      // Read-only provider always from the deployed chain's RPC.
      const rpc = getChain(CONTRACT_CHAIN_ID);
      setReadProvider(new ethers.JsonRpcProvider(rpc?.rpcUrls?.[0]));

      return true;
    } catch (e) {
      if (e?.code === 4001) { setError('Wallet connection cancelled'); }
      else { setError('Could not connect wallet: ' + (e?.message || e)); }
      return false;
    } finally {
      setConnecting(false);
    }
  }, [walletAvailable]);

  const logout = useCallback(() => {
    setAccount(null);
    setContract(null);
    setReadProvider(null);
    setChainId(null);
    setChainMismatch(false);
    setCurrentChainName(null);
    setSelectedRole(null);
    try { window.localStorage.removeItem(ROLE_STORAGE_KEY); } catch {}
  }, []);

  // ... rest handled by effect below
      }
    }
  };

  const bindWallet = useCallback(async (requestedAccounts) => {
    if (!walletAvailable || !configured || !requestedAccounts?.length) return null;

    const provider = new ethers.BrowserProvider(window.ethereum);
    const net = await provider.getNetwork();
    if (Number(net.chainId) !== CONTRACT_CHAIN_ID) {
      await switchNetwork();
    }

    const refreshedProvider = new ethers.BrowserProvider(window.ethereum);
    const signer = await refreshedProvider.getSigner();
    const signerAddress = await signer.getAddress();
    const instance = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
    const finalNet = await refreshedProvider.getNetwork();

    setAccount(signerAddress);
    setContract(instance);
    setReadProvider(refreshedProvider);
    setChainId(Number(finalNet.chainId));
    return { address: signerAddress };
  }, [configured, walletAvailable]);

  const loginAs = useCallback((role) => {
    setSelectedRole(role);
    try {
      window.localStorage.setItem(ROLE_STORAGE_KEY, role);
    } catch {
      // localStorage can be unavailable in privacy modes; in-memory role still works.
    }
  }, []);

  const connectWallet = useCallback(async () => {
    if (!walletAvailable) {
      setError('MetaMask is not installed.');
      return null;
    }
    if (!configured) {
      setError('Contract not deployed yet. Run `npm run deploy:local` first.');
      return null;
    }

    setConnecting(true);
    setError('');
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      return await bindWallet(accounts);
    } catch (e) {
      setError(e.code === 4001 ? 'Connection rejected in MetaMask.' : 'Connect failed: ' + (e.shortMessage || e.message));
      return null;
    } finally {
      setConnecting(false);
    }
  }, [bindWallet, configured, walletAvailable]);

  const logout = useCallback(() => {
    setSelectedRole(null);
    setAccount(null);
    setContract(null);
    setReadProvider(null);
    setChainId(null);
    setError('');
    try {
      window.localStorage.removeItem(ROLE_STORAGE_KEY);
    } catch {
      // Ignore storage failures; logout still clears React state.
    }
  }, []);

  useEffect(() => {
    if (!walletAvailable || !configured) return undefined;
    let mounted = true;

    window.ethereum.request({ method: 'eth_accounts' })
      .then((accounts) => {
        if (mounted && accounts?.length) bindWallet(accounts).catch(() => {});
      })
      .catch(() => {});

    return () => { mounted = false; };
  }, [bindWallet, configured, walletAvailable]);

  useEffect(() => {
    if (!walletAvailable) return undefined;

    const onAccountsChanged = (accounts) => {
      if (!accounts || accounts.length === 0) {
        setAccount(null);
        setContract(null);
        return;
      }
      bindWallet(accounts).catch((e) => setError('Wallet refresh failed: ' + (e.shortMessage || e.message)));
    };

    const onChainChanged = () => {
      setAccount(null);
      setContract(null);
      setReadProvider(null);
      setChainId(null);
      setError('Network changed. Reconnect MetaMask to continue.');
    };

    window.ethereum.on?.('accountsChanged', onAccountsChanged);
    window.ethereum.on?.('chainChanged', onChainChanged);
    return () => {
      window.ethereum.removeListener?.('accountsChanged', onAccountsChanged);
      window.ethereum.removeListener?.('chainChanged', onChainChanged);
    };
  }, [bindWallet, walletAvailable]);

  const isWalletConnected = !!account;
  const chain = getChain(chainId || CONTRACT_CHAIN_ID);

  const value = {
    selectedRole,
    isWalletConnected,
    loginAs,
    logout,
    account,
    contract,
    readProvider,
    chainId,
    chain,
    connecting,
    error,
    configured,
    walletAvailable,
    setError,
    connectWallet,
    contractAbi: CONTRACT_ABI,
  };

  return <Web3Context.Provider value={value}>{children}</Web3Context.Provider>;
}
