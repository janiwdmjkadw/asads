import { create } from 'zustand';
import type { IngestionState } from '@/components/listen/IngestionStatus';

export type TradingConnectionState = 'connected' | 'syncing' | 'offline';
export type TradingAuthState = 'ready' | 'refreshing' | 'stale';

interface ConnectionState {
  ingestion: IngestionState;
  trading: TradingConnectionState;
  tradingAuth: TradingAuthState;
  inFlightOrders: number;
  setIngestion: (state: IngestionState) => void;
  setTrading: (state: TradingConnectionState) => void;
  setTradingAuth: (state: TradingAuthState) => void;
  setInFlightOrders: (count: number) => void;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  ingestion: 'warming',
  trading: 'offline',
  tradingAuth: 'stale',
  inFlightOrders: 0,
  setIngestion: (state) => set({ ingestion: state }),
  setTrading: (state) => set({ trading: state }),
  setTradingAuth: (state) => set({ tradingAuth: state }),
  setInFlightOrders: (count) => set({ inFlightOrders: count }),
}));
