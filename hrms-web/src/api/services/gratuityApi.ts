import http from '@/lib/http';

// Amounts come back as strings with 2 decimals ("30000.00").

export type GratuityStatus = 'NOT_ELIGIBLE' | 'ACCRUING' | 'DUE' | 'PAID';
export type GratuityBenefit = 'GRATUITY' | 'SHORT_TERM_SEVERANCE';

export interface GratuityPolicy {
  rate_percent: string;
  eligible_contract_types: string;
  long_term_months: number;
  estimate_missing_months: boolean;
  is_default: boolean;
}

export interface ContractGratuity {
  contract: number;
  contract_number: string;
  employee: number;
  employee_name: string;
  employee_code: string;
  contract_type: string;
  start_date: string;
  end_date: string | null;
  contract_months: string | null;
  service_end: string | null;
  eligible: boolean;
  benefit: GratuityBenefit | null;
  legal_basis: string;
  reason: string;
  rate_percent: string;
  basic_earned: string;
  gratuity_earned: string;
  paid: string;
  outstanding: string;
  status: GratuityStatus;
  ended_early: boolean;
  employee_has_left: boolean;
  estimated_months: number;
  missing_months: number;
}

export interface GratuityMonth {
  year: number;
  month: number;
  days_covered: number;
  days_in_month: number;
  basic_salary: string;
  unpaid_leave_days: string;
  unpaid_leave_reduction: string;
  basic_earned: string;
  source: 'payslip' | 'estimate' | 'missing';
  payslip: number | null;
}

export interface GratuityPayment {
  id: number;
  amount: string;
  paid_on: string;
  covers_to: string;
  source_type: string;
  source_id: string;
  note: string;
  created_at: string;
}

export interface ContractGratuityDetail extends ContractGratuity {
  months: GratuityMonth[];
  payments: GratuityPayment[];
}

export const gratuityApi = {
  list: async (params: { status?: GratuityStatus; search?: string } = {}) => {
    const res = await http.get('/api/v1/payroll/gratuity/', { params });
    return res.data as { results: ContractGratuity[]; policy: GratuityPolicy };
  },
  detail: async (contractId: number): Promise<ContractGratuityDetail> => {
    const res = await http.get(`/api/v1/payroll/gratuity/${contractId}/`);
    return res.data;
  },
  getPolicy: async (): Promise<GratuityPolicy> => {
    const res = await http.get('/api/v1/payroll/gratuity/policy/');
    return res.data;
  },
  savePolicy: async (data: Partial<Omit<GratuityPolicy, 'is_default'>>): Promise<GratuityPolicy> => {
    const res = await http.put('/api/v1/payroll/gratuity/policy/', data);
    return res.data;
  },
};

export const gratuityStatusColor: Record<GratuityStatus, string> = {
  NOT_ELIGIBLE: 'default',
  ACCRUING: 'blue',
  DUE: 'gold',
  PAID: 'green',
};

export const gratuityStatusLabel: Record<GratuityStatus, string> = {
  NOT_ELIGIBLE: 'Not eligible',
  ACCRUING: 'Accruing',
  DUE: 'Due',
  PAID: 'Paid',
};

export const gratuityBenefitLabel: Record<GratuityBenefit, string> = {
  GRATUITY: 'Gratuity',
  SHORT_TERM_SEVERANCE: 'Short-term severance',
};
