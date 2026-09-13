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
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const configured = isContractConfigured();
  const walletAvailable = typeof window !== 'undefined' && !!window.ethereum;

  const switchNetwork = async () => {
    const chain = getChain(CONTRACT_CHAIN_ID);
    if (!chain) throw new Error('No chain metadata for chainId ' + CONTRACT_CHAIN_ID);

    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: chain.chainIdHex }],
      });
    } catch (switchErr) {
      if (switchErr.code === 4902 || switchErr.data?.originalError?.code === 4902) {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: chain.chainIdHex,
            chainName: chain.chainName,
            nativeCurrency: chain.nativeCurrency,
            rpcUrls: chain.rpcUrls,
            blockExplorerUrls: chain.blockExplorerUrls,
          }],
        });
      } else {
        throw switchErr;
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
