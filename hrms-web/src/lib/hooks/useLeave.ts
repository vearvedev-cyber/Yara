import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { leaveApi, leaveBalanceApi } from '@/api/services/leaveApi';
import type { LeavePolicy, LeaveType } from '@/api/services/leaveApi';

export const useLeaveRequests = () => {
  const workspaceId = localStorage.getItem('workspaceId');
  return useQuery({
    queryKey: ['leaveRequests', workspaceId],
    queryFn: () => leaveApi.getLeaveRequests(),
    enabled: !!workspaceId,
  });
};

export const useLeaveSummary = (employee?: number) => {
  const workspaceId = localStorage.getItem('workspaceId');
  return useQuery({
    queryKey: ['leaveSummary', workspaceId, employee],
    queryFn: () => leaveApi.getLeaveSummary(employee),
    enabled: !!workspaceId,
  });
};

export const useCreateLeaveRequest = () => {
  const qc = useQueryClient();
  const workspaceId = localStorage.getItem('workspaceId');
  return useMutation({
    mutationFn: (data: Parameters<typeof leaveApi.createLeaveRequest>[0]) => leaveApi.createLeaveRequest(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leaveRequests', workspaceId] });
      qc.invalidateQueries({ queryKey: ['leaveSummary', workspaceId] });
      qc.invalidateQueries({ queryKey: ['leaveBalances'] });
    },
  });
};

export const useApproveLeave = () => {
  const workspaceId = localStorage.getItem('workspaceId');
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => leaveApi.approveLeave(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leaveRequests', workspaceId] });
      qc.invalidateQueries({ queryKey: ['leaveSummary', workspaceId] });
      qc.invalidateQueries({ queryKey: ['leaveBalances'] });
    },
  });
};

export const useRejectLeave = () => {
  const workspaceId = localStorage.getItem('workspaceId');
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => leaveApi.rejectLeave(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leaveRequests', workspaceId] });
      qc.invalidateQueries({ queryKey: ['leaveSummary', workspaceId] });
      qc.invalidateQueries({ queryKey: ['leaveBalances'] });
    },
  });
};

export const useCancelLeave = () => {
  const workspaceId = localStorage.getItem('workspaceId');
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => leaveApi.cancelLeave(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leaveRequests', workspaceId] });
      qc.invalidateQueries({ queryKey: ['leaveSummary', workspaceId] });
      qc.invalidateQueries({ queryKey: ['leaveBalances'] });
    },
  });
};

export const useDeleteLeaveRequest = () => {
  const workspaceId = localStorage.getItem('workspaceId');
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => leaveApi.deleteLeaveRequest(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leaveRequests', workspaceId] });
      qc.invalidateQueries({ queryKey: ['leaveSummary', workspaceId] });
      qc.invalidateQueries({ queryKey: ['leaveBalances'] });
    },
  });
};

export const useDeleteSickNote = () => {
  const workspaceId = localStorage.getItem('workspaceId');
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => leaveApi.deleteSickNote(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sickNotes', workspaceId] });
      qc.invalidateQueries({ queryKey: ['sickNoteSummary', workspaceId] });
    },
  });
};

export const useDeleteDoubleTicket = () => {
  const workspaceId = localStorage.getItem('workspaceId');
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => leaveApi.deleteDoubleTicket(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doubleTickets', workspaceId] });
      qc.invalidateQueries({ queryKey: ['doubleTicketSummary', workspaceId] });
    },
  });
};

export const useSickNotes = () => {
  const workspaceId = localStorage.getItem('workspaceId');
  return useQuery({
    queryKey: ['sickNotes', workspaceId],
    queryFn: () => leaveApi.getSickNotes(),
    enabled: !!workspaceId,
  });
};

export const useSickNoteSummary = (employee?: number) => {
  const workspaceId = localStorage.getItem('workspaceId');
  return useQuery({
    queryKey: ['sickNoteSummary', workspaceId, employee],
    queryFn: () => leaveApi.getSickNoteSummary(employee),
    enabled: !!workspaceId,
  });
};

export const useCreateSickNote = () => {
  const workspaceId = localStorage.getItem('workspaceId');
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Parameters<typeof leaveApi.createSickNote>[0]) => leaveApi.createSickNote(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sickNotes', workspaceId] });
      qc.invalidateQueries({ queryKey: ['sickNoteSummary', workspaceId] });
    },
  });
};

export const useApproveSickNote = () => {
  const workspaceId = localStorage.getItem('workspaceId');
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => leaveApi.approveSickNote(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sickNotes', workspaceId] });
      qc.invalidateQueries({ queryKey: ['sickNoteSummary', workspaceId] });
    },
  });
};

export const useRejectSickNote = () => {
  const workspaceId = localStorage.getItem('workspaceId');
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => leaveApi.rejectSickNote(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sickNotes', workspaceId] });
      qc.invalidateQueries({ queryKey: ['sickNoteSummary', workspaceId] });
    },
  });
};

// Double Ticket Hooks
export const useDoubleTickets = () => {
  const workspaceId = localStorage.getItem('workspaceId');
  return useQuery({
    queryKey: ['doubleTickets', workspaceId],
    queryFn: () => leaveApi.getDoubleTickets(),
    enabled: !!workspaceId,
  });
};

export const useCreateDoubleTicket = () => {
  const workspaceId = localStorage.getItem('workspaceId');
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Parameters<typeof leaveApi.createDoubleTicket>[0]) => leaveApi.createDoubleTicket(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doubleTickets', workspaceId] });
      qc.invalidateQueries({ queryKey: ['doubleTicketSummary', workspaceId] });
    },
  });
};

export const useApproveDoubleTicket = () => {
  const workspaceId = localStorage.getItem('workspaceId');
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => leaveApi.approveDoubleTicket(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doubleTickets', workspaceId] });
      qc.invalidateQueries({ queryKey: ['doubleTicketSummary', workspaceId] });
    },
  });
};

export const useRejectDoubleTicket = () => {
  const workspaceId = localStorage.getItem('workspaceId');
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => leaveApi.rejectDoubleTicket(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doubleTickets', workspaceId] });
      qc.invalidateQueries({ queryKey: ['doubleTicketSummary', workspaceId] });
    },
  });
};

export const useDoubleTicketSummary = (employee?: number) => {
  const workspaceId = localStorage.getItem('workspaceId');
  return useQuery({
    queryKey: ['doubleTicketSummary', workspaceId, employee],
    queryFn: () => leaveApi.getDoubleTicketSummary(employee),
    enabled: !!workspaceId,
  });
};

// ---------------------------------------------------------------------------
// Leave balances, policy and public holidays
// ---------------------------------------------------------------------------

export const useLeaveBalances = (params: { leave_type?: LeaveType; search?: string; include_terminated?: boolean } = {}) => {
  const workspaceId = localStorage.getItem('workspaceId');
  return useQuery({
    queryKey: ['leaveBalances', workspaceId, params],
    queryFn: () => leaveBalanceApi.getBalances(params),
    enabled: !!workspaceId,
  });
};

export const useLeaveBalanceDetail = (employeeId: number | null, leaveType: LeaveType = 'ANNUAL') => {
  const workspaceId = localStorage.getItem('workspaceId');
  return useQuery({
    queryKey: ['leaveBalances', workspaceId, 'detail', employeeId, leaveType],
    queryFn: () => leaveBalanceApi.getBalanceDetail(employeeId as number, leaveType),
    enabled: !!workspaceId && !!employeeId,
  });
};

export const useAdjustLeaveBalance = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ employeeId, ...data }: { employeeId: number; leave_type: LeaveType; days: number; note: string; date?: string }) =>
      leaveBalanceApi.adjustBalance(employeeId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leaveBalances'] }),
  });
};

export const useLeavePolicy = (leaveType: LeaveType = 'ANNUAL') => {
  const workspaceId = localStorage.getItem('workspaceId');
  return useQuery({
    queryKey: ['leavePolicy', workspaceId, leaveType],
    queryFn: () => leaveBalanceApi.getEffectivePolicy(leaveType),
    enabled: !!workspaceId,
  });
};

export const useSaveLeavePolicy = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (policy: LeavePolicy) => leaveBalanceApi.savePolicy(policy),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leavePolicy'] });
      qc.invalidateQueries({ queryKey: ['leaveBalances'] });
    },
  });
};

export const usePublicHolidays = (year: number) => {
  const workspaceId = localStorage.getItem('workspaceId');
  return useQuery({
    queryKey: ['publicHolidays', workspaceId, year],
    queryFn: () => leaveBalanceApi.getHolidays(year),
    enabled: !!workspaceId,
  });
};

const useHolidayMutation = <T, R>(fn: (arg: T) => Promise<R>) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['publicHolidays'] });
      qc.invalidateQueries({ queryKey: ['leaveBalances'] });
    },
  });
};

export const useAddHoliday = () => useHolidayMutation((data: { date: string; name: string }) => leaveBalanceApi.addHoliday(data));
export const useDeleteHoliday = () => useHolidayMutation((id: number) => leaveBalanceApi.deleteHoliday(id));
export const useSeedHolidays = () => useHolidayMutation((year: number) => leaveBalanceApi.seedHolidays(year));
