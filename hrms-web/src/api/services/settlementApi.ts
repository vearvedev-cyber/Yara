import http from '@/lib/http';

// Amounts come back as strings with 2 decimals ("20092.80").

export type SettlementKind = 'EXIT' | 'CONTRACT_END';
export type SettlementStatus = 'DRAFT' | 'APPROVED' | 'PAID' | 'CANCELLED';
export type LineCategory = 'EARNING' | 'DEDUCTION' | 'EMPLOYER';

export interface SettlementLine {
  id: number;
  line_no: number;
  kind: string;
  category: LineCategory;
  description: string;
  basis: string;
  amount: string;
  is_manual: boolean;
  reason: string;
  paye: boolean;
  napsa: boolean;
  nhima: boolean;
  data: Record<string, unknown>;
}

export interface FinalSettlement {
  id: number;
  employee: number;
  employee_name: string;
  employee_code: string;
  department: string;
  hire_date: string;
  kind: SettlementKind;
  termination: number | null;
  termination_reason: string;
  contract: number | null;
  contract_number: string | null;
  last_working_day: string;
  status: SettlementStatus;
  payee_name: string;
  notes: string;
  total_earnings: string;
  total_deductions: string;
  net_payable: string;
  calculated_at: string | null;
  calculation_notes?: string[];
  prepared_by_name: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  paid_by_name: string | null;
  paid_at: string | null;
  payment_reference: string;
  created_at: string;
  lines?: SettlementLine[];
}

export interface LineKindOption {
  value: string;
  label: string;
}

export const settlementApi = {
  list: async (params: { status?: SettlementStatus; kind?: SettlementKind; employee?: number } = {}) => {
    const res = await http.get('/api/v1/payroll/settlements/', { params: { page_size: 500, ...params } });
    return (res.data?.results || res.data) as FinalSettlement[];
  },
  get: async (id: number): Promise<FinalSettlement> => {
    const res = await http.get(`/api/v1/payroll/settlements/${id}/`);
    return res.data;
  },
  create: async (data: { employee: number; kind?: SettlementKind; contract?: number; last_working_day?: string; payee_name?: string }) => {
    const res = await http.post('/api/v1/payroll/settlements/', data);
    return res.data as FinalSettlement;
  },
  update: async (id: number, data: { payee_name?: string; notes?: string; last_working_day?: string }) => {
    const res = await http.patch(`/api/v1/payroll/settlements/${id}/`, data);
    return res.data as FinalSettlement;
  },
  recalculate: async (id: number) => (await http.post(`/api/v1/payroll/settlements/${id}/recalculate/`)).data as FinalSettlement,
  addLine: async (id: number, data: { kind: string; amount: number; reason: string; description?: string; paye?: boolean; napsa?: boolean; nhima?: boolean }) =>
    (await http.post(`/api/v1/payroll/settlements/${id}/lines/`, data)).data as FinalSettlement,
  removeLine: async (id: number, lineId: number) =>
    (await http.delete(`/api/v1/payroll/settlements/${id}/lines/${lineId}/`)).data as FinalSettlement,
  approve: async (id: number) => (await http.post(`/api/v1/payroll/settlements/${id}/approve/`)).data as FinalSettlement,
  markPaid: async (id: number, data: { reference: string; paid_on?: string }) =>
    (await http.post(`/api/v1/payroll/settlements/${id}/mark-paid/`, data)).data as FinalSettlement,
  cancel: async (id: number) => (await http.post(`/api/v1/payroll/settlements/${id}/cancel/`)).data as FinalSettlement,
  downloadPdf: async (id: number, filename: string) => {
    const res = await http.get(`/api/v1/payroll/settlements/${id}/pdf/`, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data as Blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  },
  lineKinds: async () =>
    (await http.get('/api/v1/payroll/settlements/line-kinds/')).data as { manual_earnings: LineKindOption[]; manual_deductions: LineKindOption[] },
};

export const settlementStatusColor: Record<SettlementStatus, string> = {
  DRAFT: 'gold',
  APPROVED: 'blue',
  PAID: 'green',
  CANCELLED: 'default',
};

export const kwacha = (value: string | number) =>
  `K ${Number(value).toLocaleString('en-ZM', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Redundancy received before go-live or from another employer (counts against the
// K2,000,000 lifetime PAYE-free redundancy limit).
export interface PriorRedundancyPayment {
  id: number;
  employee: number;
  employee_name: string;
  employee_code: string;
  amount: string;
  paid_on: string;
  employer_name: string;
  note: string;
  created_at: string;
}

export const priorRedundancyApi = {
  list: async (): Promise<PriorRedundancyPayment[]> => {
    const res = await http.get('/api/v1/payroll/prior-redundancy/', { params: { page_size: 500 } });
    return res.data?.results || res.data;
  },
  create: async (data: { employee: number; amount: number; paid_on: string; employer_name: string; note?: string }) =>
    (await http.post('/api/v1/payroll/prior-redundancy/', data)).data as PriorRedundancyPayment,
  remove: async (id: number) => {
    await http.delete(`/api/v1/payroll/prior-redundancy/${id}/`);
  },
};
