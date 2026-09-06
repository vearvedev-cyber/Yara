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
