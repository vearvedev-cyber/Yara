/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type Candidate = {
    readonly id: number;
    readonly atr_reference: string;
    engaged_date: string;
    name: string;
    nrc?: string;
    phone_number?: string;
    position: string;
    agreed_net_pay?: string;
    accommodation?: string;
    docs_submitted?: boolean;
    recommendation_date?: string | null;
    interview_due_date?: string | null;
    interview_remarks?: string;
    knowledge_score?: number | null;
    silicosis_status?: string;
    medicals_status?: string;
    ibf_status?: string;
    initial_induction_status?: string;
    company_induction_status?: string;
    site_permit_status?: string;
    pit_permit_status?: string;
    pit_operation_permit_status?: string;
    ohs_status?: string;
    status?: string;
    readonly created_at: string;
    readonly updated_at: string;
    atr?: number | null;
};

