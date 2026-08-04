export type ServiceType = 'platform' | 'infrastructure' | 'business';

const DEPT_PLATFORM = 'Platform Services';
const DEPT_INFRA = 'Infrastructure Services';

/** Map CMDB app department.description → diagram / table service legend bucket. */
export function serviceTypeFromDepartment(description: string): ServiceType {
  const d = description.trim();
  if (d === DEPT_PLATFORM) return 'platform';
  if (d === DEPT_INFRA) return 'infrastructure';
  return 'business';
}
