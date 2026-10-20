import http from '@/lib/http';

export type LeaveType = 'ANNUAL' | 'SICK' | 'CASUAL' | 'UNPAID' | 'MATERNITY' | 'PATERNITY' | 'COMPASSIONATE' | 'STUDY' | 'BEREAVEMENT';
export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface LeaveChoiceOption {
  label: string;
  value: LeaveType;
}

export interface LeaveRequest {
  id: number;
  employee: number;
  employee_name: string;
  employee_code: string;
  leave_type: LeaveType;
  status: LeaveStatus;
  start_date: string;
  end_date: string;
  days: number;
  reason: string;
  doctor_note?: string | null;
  approved_by?: number | null;
  created_at: string;
  updated_at: string;
}

export interface LeaveSummaryItem {
  employee: number;
  employee_name: string;
  total_requests: number;
  pending: number;
  approved: number;
  rejected: number;
  cancelled: number;
  total_days: number;
  sick_days: number;
  annual_days: number;
}

export type SickNoteStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface SickNote {
  id: number;
  employee: number;
  employee_name: string;
  employee_code: string;
  issued_by?: number | null;
  status: SickNoteStatus;
  start_date: string;
  end_date: string;
  days: number;
  diagnosis: string;
  notes: string;
  document?: string | null;
  created_at: string;
  updated_at: string;
}

export type DoubleTicketStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAID';

export interface DoubleTicketRequest {
  id: number;
  employee: number;
  employee_name: string;
  employee_code: string;
  work_date: string;
  hours_worked: number;
  reason: string;
  status: DoubleTicketStatus;
  approved_by?: number | null;
  approved_by_name?: string | null;
  approved_at?: string | null;
  calculated_amount?: number | null;
  calculated_payment?: number | null;
  created_at: string;
  updated_at: string;
}

const buildFormData = (data: Record<string, any>): FormData => {
  const fd = new FormData();
  Object.entries(data).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (value instanceof File) {
      fd.append(key, value);
    } else {
      fd.append(key, String(value));
    }
  });
  return fd;
};

export const leaveApi = {
  getLeaveChoices: async (): Promise<LeaveChoiceOption[]> => {
    const res = await http.get('/api/v1/leave/requests/choices/');
    return res.data || [];
  },
  getLeaveRequests: async (): Promise<LeaveRequest[]> => {
    const res = await http.get('/api/v1/leave/requests/');
    return res.data?.results || res.data;
  },
  approveLeave: async (id: number): Promise<LeaveRequest> => {
    const res = await http.post(`/api/v1/leave/requests/${id}/approve/`, {});
    return res.data;
  },
  rejectLeave: async (id: number): Promise<LeaveRequest> => {
    const res = await http.post(`/api/v1/leave/requests/${id}/reject/`, {});
    return res.data;
  },
  cancelLeave: async (id: number): Promise<LeaveRequest> => {
    const res = await http.post(`/api/v1/leave/requests/${id}/cancel/`, {});
    return res.data;
  },
  createLeaveRequest: async (data: Omit<LeaveRequest, 'id' | 'employee_name' | 'employee_code' | 'status' | 'days' | 'created_at' | 'updated_at' | 'approved_by'> & { doctor_note?: File | null; status?: LeaveStatus }): Promise<LeaveRequest> => {
    const formData = buildFormData(data as any);
    const res = await http.post('/api/v1/leave/requests/', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return res.data;
  },
  getLeaveSummary: async (employee?: number): Promise<LeaveSummaryItem[]> => {
    const res = await http.get('/api/v1/leave/requests/summary', { params: employee ? { employee } : {} });
    return res.data?.results || res.data;
  },
  getSickNotes: async (): Promise<SickNote[]> => {
    const res = await http.get('/api/v1/leave/sick-notes/');
    return res.data?.results || res.data;
  },
  createSickNote: async (data: Omit<SickNote, 'id' | 'employee_name' | 'employee_code' | 'issued_by' | 'status' | 'days' | 'created_at' | 'updated_at'> & { document?: File | null; status?: SickNoteStatus }): Promise<SickNote> => {
    const formData = buildFormData(data as any);
    const res = await http.post('/api/v1/leave/sick-notes/', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return res.data;
  },
  getSickNoteSummary: async (employee?: number): Promise<any[]> => {
    const res = await http.get('/api/v1/leave/sick-notes/summary', { params: employee ? { employee } : {} });
    return res.data?.results || res.data;
  },
  approveSickNote: async (id: number): Promise<SickNote> => {
    const res = await http.post(`/api/v1/leave/sick-notes/${id}/approve/`, {});
    return res.data;
  },
  rejectSickNote: async (id: number): Promise<SickNote> => {
    const res = await http.post(`/api/v1/leave/sick-notes/${id}/reject/`, {});
    return res.data;
  },

  // Double Ticket API
  getDoubleTickets: async (): Promise<DoubleTicketRequest[]> => {
    const res = await http.get('/api/v1/leave/double-tickets/');
    return res.data?.results || res.data;
  },
  createDoubleTicket: async (data: Omit<DoubleTicketRequest, 'id' | 'employee_name' | 'employee_code' | 'status' | 'approved_by' | 'approved_by_name' | 'approved_at' | 'calculated_amount' | 'calculated_payment' | 'created_at' | 'updated_at'>): Promise<DoubleTicketRequest> => {
    const res = await http.post('/api/v1/leave/double-tickets/', data);
    return res.data;
  },
  approveDoubleTicket: async (id: number): Promise<DoubleTicketRequest> => {
    const res = await http.post(`/api/v1/leave/double-tickets/${id}/approve/`, {});
    return res.data;
  },
  rejectDoubleTicket: async (id: number): Promise<DoubleTicketRequest> => {
    const res = await http.post(`/api/v1/leave/double-tickets/${id}/reject/`, {});
    return res.data;
  },
  deleteLeaveRequest: async (id: number): Promise<void> => {
    await http.delete(`/api/v1/leave/requests/${id}/`);
  },
  deleteSickNote: async (id: number): Promise<void> => {
    await http.delete(`/api/v1/leave/sick-notes/${id}/`);
  },
  deleteDoubleTicket: async (id: number): Promise<void> => {
    await http.delete(`/api/v1/leave/double-tickets/${id}/`);
  },
  getDoubleTicketSummary: async (employee?: number): Promise<any[]> => {
    const res = await http.get('/api/v1/leave/double-tickets/summary', { params: employee ? { employee } : {} });
    return res.data?.results || res.data;
  },
};

// ---------------------------------------------------------------------------
// Leave balances, policy and public holidays
// Day amounts come back as strings with 2 decimals ("12.50").
// ---------------------------------------------------------------------------

/** First readable message from a DRF error response. */
export const apiErrorMessage = (err: unknown, fallback: string): string => {
  const data = (err as { response?: { data?: unknown } })?.response?.data;
  if (!data) return fallback;
  if (typeof data === 'string') return data;
  if (typeof data === 'object') {
    const record = data as Record<string, unknown>;
    const first = record.error ?? record.detail ?? Object.values(record)[0];
    if (Array.isArray(first)) return String(first[0]);
    if (first != null) return String(first);
  }
  return fallback;
};

export interface LeavePolicy {
  id?: number;
  leave_type: LeaveType;
  days_per_month: string;
  carry_forward_cap: string | null;
  leave_year_start_month: number;
  count_working_days: boolean;
  working_weekdays: string;
  allow_negative_balance: boolean;
  is_default?: boolean;
  has_balance?: boolean;
}

export interface LeaveBalanceRow {
  employee: number;
  employee_name: string;
  employee_code: string;
  department: string;
  employment_status: string;
  leave_type: LeaveType;
  opening: string;
  accrued: string;
  taken: string;
  adjustments: string;
  expired: string;
  paid_out: string;
  balance: string;
  accruing_this_month: string;
  available: string;
}

export interface LeaveLedgerEntry {
  id: number;
  leave_type: LeaveType;
  kind: 'OPENING' | 'ACCRUAL' | 'TAKEN' | 'ADJUSTMENT' | 'EXPIRY' | 'PAID_OUT';
  kind_display: string;
  date: string;
  period: string | null;
  days: string;
  source_type: string;
  source_id: string;
  note: string;
  created_by_name: string;
  created_at: string;
}

export interface LeaveBalanceDetail extends Omit<LeaveBalanceRow, 'department' | 'employment_status'> {
  hire_date: string;
  days_per_month: string;
  carry_forward_cap: string | null;
  entries: LeaveLedgerEntry[];
}

export interface WorkingDaysPreview {
  days: number;
  counts_working_days: boolean;
  available: string | null;
  available_after: string | null;
}

export interface PublicHoliday {
  id: number;
  date: string;
  name: string;
  is_national: boolean;
}

export const leaveBalanceApi = {
  getBalances: async (params: { leave_type?: LeaveType; search?: string; include_terminated?: boolean } = {}) => {
    const res = await http.get('/api/v1/leave/balances/', {
      params: { ...params, include_terminated: params.include_terminated ? 1 : undefined },
    });
    return res.data as { results: LeaveBalanceRow[]; policy: LeavePolicy | null };
  },
  getBalanceDetail: async (employeeId: number, leaveType: LeaveType = 'ANNUAL'): Promise<LeaveBalanceDetail> => {
    const res = await http.get(`/api/v1/leave/balances/${employeeId}/`, { params: { leave_type: leaveType } });
    return res.data;
  },
  adjustBalance: async (employeeId: number, data: { leave_type: LeaveType; days: number; note: string; date?: string }) => {
    const res = await http.post(`/api/v1/leave/balances/${employeeId}/adjust/`, data);
    return res.data as LeaveLedgerEntry;
  },
  previewWorkingDays: async (params: { employee: number; leave_type: LeaveType; start_date: string; end_date: string }) => {
    const res = await http.get('/api/v1/leave/requests/working-days/', { params });
    return res.data as WorkingDaysPreview;
  },
  getEffectivePolicy: async (leaveType: LeaveType = 'ANNUAL'): Promise<LeavePolicy> => {
    const res = await http.get('/api/v1/leave/policies/effective/', { params: { leave_type: leaveType } });
    return res.data;
  },
  savePolicy: async (policy: LeavePolicy): Promise<LeavePolicy> => {
    const data = {
      leave_type: policy.leave_type,
      days_per_month: policy.days_per_month,
      carry_forward_cap: policy.carry_forward_cap,
      leave_year_start_month: policy.leave_year_start_month,
      count_working_days: policy.count_working_days,
      working_weekdays: policy.working_weekdays,
      allow_negative_balance: policy.allow_negative_balance,
    };
    const res = policy.id
      ? await http.patch(`/api/v1/leave/policies/${policy.id}/`, data)
      : await http.post('/api/v1/leave/policies/', data);
    return res.data;
  },
  getHolidays: async (year: number): Promise<PublicHoliday[]> => {
    const res = await http.get('/api/v1/core/public-holidays/', { params: { year, page_size: 100 } });
    return res.data?.results || res.data;
  },
  addHoliday: async (data: { date: string; name: string }): Promise<PublicHoliday> => {
    const res = await http.post('/api/v1/core/public-holidays/', data);
    return res.data;
  },
  deleteHoliday: async (id: number): Promise<void> => {
    await http.delete(`/api/v1/core/public-holidays/${id}/`);
  },
  seedHolidays: async (year: number) => {
    const res = await http.post('/api/v1/core/public-holidays/seed/', { year });
    return res.data as { year: number; created: number };
  },
};
