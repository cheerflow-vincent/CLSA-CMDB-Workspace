import {
  fetchRelationshipChangesForApp,
  type RelationshipChangeRequest,
  type RelationshipChangeState,
} from '../../api/servicenow';

export interface PollChangeOptions {
  intervalMs?: number;
  timeoutMs?: number;
  isSettled?: (row: RelationshipChangeRequest) => boolean;
  onTick?: (row: RelationshipChangeRequest | undefined) => void;
}

export interface PollChangeResult {
  settled: boolean;
  row?: RelationshipChangeRequest;
  timedOut: boolean;
}

const DEFAULT_INTERVAL_MS = 2000;
const DEFAULT_TIMEOUT_MS = 30000;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchChangeRow(
  appSysId: string,
  changeSysId: string,
): Promise<RelationshipChangeRequest | undefined> {
  const { result } = await fetchRelationshipChangesForApp(appSysId);
  return result.find(r => r.sys_id === changeSysId);
}

export async function pollChangeUntilSettled(
  appSysId: string,
  changeSysId: string,
  options: PollChangeOptions = {},
): Promise<PollChangeResult> {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const isSettled = options.isSettled ?? (row => row.state !== 'pending_approval');
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const row = await fetchChangeRow(appSysId, changeSysId);
    options.onTick?.(row);
    if (row && isSettled(row)) {
      return { settled: true, row, timedOut: false };
    }
    await sleep(intervalMs);
  }

  const row = await fetchChangeRow(appSysId, changeSysId);
  options.onTick?.(row);
  if (row && isSettled(row)) {
    return { settled: true, row, timedOut: false };
  }
  return { settled: false, row, timedOut: true };
}

export async function pollChangeUntilState(
  appSysId: string,
  changeSysId: string,
  targetState: RelationshipChangeState,
  options: Omit<PollChangeOptions, 'isSettled'> = {},
): Promise<PollChangeResult> {
  return pollChangeUntilSettled(appSysId, changeSysId, {
    ...options,
    isSettled: row => row.state === targetState,
  });
}
