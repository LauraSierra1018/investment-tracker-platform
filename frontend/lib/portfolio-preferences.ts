export type PortfolioPreferences = {
  goal: 'preserve' | 'balanced' | 'growth' | 'aggressive' | 'income' | 'custom';
  risk_profile: 'conservative' | 'moderate' | 'aggressive';
  horizon: '<1' | '1-3' | '3-5' | '5+';
  priorities: string[];
};
export type ResearchCoverage = { evaluated: number; known: number; eligible?: number;
  refreshing: boolean; partial: boolean; as_of?: string | null; };
export const goalLabels = { preserve: 'Preservar capital', balanced: 'Balance', growth: 'Crecimiento',
  aggressive: 'Crecimiento agresivo', income: 'Ingresos', custom: 'Personalizado' };
export const riskLabels = { conservative: 'Bajo', moderate: 'Medio', aggressive: 'Alto' };
