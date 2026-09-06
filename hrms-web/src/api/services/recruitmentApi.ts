import http from '../../lib/http';

export interface ATR {
  id: number;
  reference_number: string;
  department: number;
  department_name?: string;
  hiring_supervisor_name: string;
  position_title: string;
  roles_to_fill: number;
  due_date?: string;
  notes?: string;
  approval_status?: 'PENDING' | 'APPROVED' | 'REJECTED';
  hr_manager_signed_at?: string | null;
  ops_manager_signed_at?: string | null;
  director_signed_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Candidate {
  id: number;
  engaged_date: string;
  name: string;
  nrc?: string;
  phone_number?: string;
  position: string;
  agreed_net_pay?: string;
  accommodation?: string;
  interview_due_date?: string | null;
  interview_remarks?: string;
  knowledge_score?: number | null;
  experience_score?: number | null;
  qualification_score?: number | null;
  status: 'Pipeline' | 'Onboarded' | 'Rejected';
  atr?: number | null;
  atr_reference?: string;
  documents?: CandidateDocument[];
  created_at?: string;
  updated_at?: string;
}

export interface CandidateDocument {
  id: number;
  candidate: number;
  document: string;
  uploaded_at: string;
}

export const recruitmentApi = {
  // ATRs (Authorization to Recruit)
  async listATRs(params?: any): Promise<ATR[]> {
    const res = await http.get('/api/v1/recruitment/atrs/', { params });
    return res.data?.results || res.data || [];
  },

  async getATR(id: number): Promise<ATR> {
    const res = await http.get(`/api/v1/recruitment/atrs/${id}/`);
    return res.data;
  },

  async createATR(data: Partial<ATR>): Promise<ATR> {
    const res = await http.post('/api/v1/recruitment/atrs/', data);
    return res.data;
  },

  async updateATR(id: number, data: Partial<ATR>): Promise<ATR> {
    const res = await http.patch(`/api/v1/recruitment/atrs/${id}/`, data);
    return res.data;
  },

  async deleteATR(id: number): Promise<void> {
    await http.delete(`/api/v1/recruitment/atrs/${id}/`);
  },

  // Candidates
  async listCandidates(params?: any): Promise<Candidate[]> {
    const res = await http.get('/api/v1/recruitment/candidates/', { params });
    return res.data?.results || res.data || [];
  },

  async getCandidate(id: number): Promise<Candidate> {
    const res = await http.get(`/api/v1/recruitment/candidates/${id}/`);
    return res.data;
  },

  async createCandidate(data: any): Promise<Candidate> {
    const res = await http.post('/api/v1/recruitment/candidates/', data);
    return res.data;
  },

  async updateCandidate(id: number, data: any): Promise<Candidate> {
    const res = await http.patch(`/api/v1/recruitment/candidates/${id}/`, data);
    return res.data;
  },

  async deleteCandidate(id: number): Promise<void> {
    await http.delete(`/api/v1/recruitment/candidates/${id}/`);
  },
};
