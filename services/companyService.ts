import { Company } from '../types';
import { apiFetch } from './apiClient';

export interface CreateCompanyInput {
  name: string;
  website?: string;
  location?: string;
  size?: Company['size'];
  remoteFriendly?: boolean;
  next40?: boolean;
  frenchTech120?: boolean;
  notes?: string;
}

export interface BulkCreateCompaniesResult {
  created: Company[];
  skipped: string[];
}

export async function listCompanies(q?: string): Promise<Company[]> {
  const qs = q ? `?q=${encodeURIComponent(q)}` : '';
  return apiFetch<Company[]>(`/companies${qs}`, undefined, 'Failed to list companies');
}

export async function createCompany(input: CreateCompanyInput): Promise<Company> {
  return apiFetch<Company>('/companies', { method: 'POST', body: JSON.stringify(input) }, 'Failed to create company');
}

export async function bulkCreateCompanies(names: string[]): Promise<BulkCreateCompaniesResult> {
  return apiFetch<BulkCreateCompaniesResult>(
    '/companies/bulk',
    { method: 'POST', body: JSON.stringify({ names }) },
    'Failed to create companies'
  );
}

export async function updateCompany(id: string, patch: Partial<Company>): Promise<Company> {
  return apiFetch<Company>(`/companies/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }, 'Failed to update company');
}

export async function deleteCompany(id: string): Promise<void> {
  await apiFetch<{ success: true }>(`/companies/${id}`, { method: 'DELETE' }, 'Failed to delete company');
}
