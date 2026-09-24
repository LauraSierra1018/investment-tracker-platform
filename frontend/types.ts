export type Criterion={key:string;name:string;category:string;value:number|string|null;formatted_value:string;status:'cumple'|'revisar'|'no_cumple'|'sin_dato';score:number;weight:number;explanation:string;rule:string};
export type DataProvenance = { provider?: string; source?: string; retrieved_at?: string; data_timestamp?: string; currency?: string; stale?: boolean; warning?: string | null; period_basis?: string };
export type FinancialStatement = { period_end: string; currency: string; period: string; [key: string]: string | number | null };
export type Stock={ticker:string;company:string;exchange?:string;currency:string;sector?:string;industry?:string;price?:number;target_price?:number;market_cap?:number;pe_ratio?:number;revenue?:number;free_float_percent?:number;volume?:number;average_volume?:number;score:number;classification:string;criteria:Criterion[];strengths:string[];risks:string[];missing_data:string[];updated_at:string|null;source:string;
  stale?: boolean; refreshing?: boolean; warning?: string | null; beta?: number | null; upside_percent?: number | null;
  provenance?: Record<string, DataProvenance>; statements?: Record<string, FinancialStatement[]>;
  period_basis?: string | null; calculation_notes?: string | null;
  valuation?: { price?: number | null; target_price?: number | null; upside_percent?: number | null; pe_ratio?: number | null; earnings_period?: string | null; formula?: string };
};
