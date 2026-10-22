import { createContext, useContext } from "react";
import { type Runtime, type Health } from "./chain";
export type SiteState = {
  r: Runtime;
  client: any;
  health: Health | null;
  error: string;
  loading: boolean;
  refresh: () => Promise<void>;
  readRetry: number;
  rpcUrl: string;
  setRpcUrl: (s: string) => void;
  specs: any[];
  specError: string;
};
export const SiteContext = createContext<SiteState>(null as any);
export const useSite = () => useContext(SiteContext);
