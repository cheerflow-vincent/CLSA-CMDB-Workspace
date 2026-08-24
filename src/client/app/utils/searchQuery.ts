/** Shared tokenized AND search helpers for encoded ServiceNow queries. */

const MIN_TOKEN_LENGTH = 2;
const MAX_SEARCH_TOKENS = 5;

/** Strip characters that break encoded-query syntax in LIKE values. */
export function escapeLikeTerm(term: string): string {
  return term.replace(/\^/g, '').replace(/=/g, '');
}

/** Split input on whitespace; dedupe; cap count; min length per token. */
export function tokenizeSearchTerms(input: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const raw of input.trim().split(/\s+/)) {
    const t = escapeLikeTerm(raw);
    if (t.length < MIN_TOKEN_LENGTH) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tokens.push(t);
    if (tokens.length >= MAX_SEARCH_TOKENS) break;
  }
  return tokens;
}

/** True when at least one searchable token is present. */
export function hasSearchableTokens(input: string): boolean {
  return tokenizeSearchTerms(input).length > 0;
}

/** fieldLIKEt1^fieldLIKEt2 — all tokens must match the same field (AND). */
export function buildFieldAndLikeQuery(field: string, tokens: string[]): string {
  if (!field || !tokens.length) return '';
  return tokens.map(t => `${field}LIKE${t}`).join('^');
}

/**
 * (f1 LIKE t1 OR f2 LIKE t1) AND (f1 LIKE t2 OR f2 LIKE t2) …
 * ServiceNow parses ^ as AND and ^OR as OR (AND binds tighter).
 */
export function buildMultiFieldAndLikeQuery(fields: string[], tokens: string[]): string {
  if (!fields.length || !tokens.length) return '';
  return tokens
    .map(token => {
      const likes = fields.map(f => `${f}LIKE${token}`);
      return likes.length > 1 ? likes.join('^OR') : likes[0];
    })
    .join('^');
}

const FIELD_OP_RE = /^([a-z0-9_]+)(LIKE|=|!=|IN|STARTSWITH|ENDSWITH|>=|<=|>|<|INSTANCEOF)/i;

function prefixQuerySegment(segment: string, prefix: string): string {
  if (!segment || segment.startsWith('ORDERBY')) return segment;

  if (segment.startsWith('sys_idIN')) {
    return `${prefix}.${segment}`;
  }

  const applyPrefix = (field: string, rest: string) =>
    field.includes('.') ? `${field}${rest}` : `${prefix}.${field}${rest}`;

  if (segment.startsWith('OR')) {
    const rest = segment.slice(2);
    const match = rest.match(FIELD_OP_RE);
    if (match) {
      return `OR${applyPrefix(match[1], rest.slice(match[1].length))}`;
    }
    return segment;
  }

  const match = segment.match(FIELD_OP_RE);
  if (match) {
    return applyPrefix(match[1], segment.slice(match[1].length));
  }

  return segment;
}

/** Join independent encoded-query groups with logical OR (^NQ). */
export function joinOrEncodedQueries(parts: string[]): string {
  return parts.filter(Boolean).join('^NQ');
}

/** Prefix bare field names in an encoded query for dot-walking (e.g. ci_item / ci). */
export function prefixEncodedQuery(query: string, prefix: string): string {
  if (!query.trim()) return '';
  return query.split('^').map(seg => prefixQuerySegment(seg, prefix)).join('^');
}

/** Reference columns where LIKE must dot-walk to display value (.name). */
const REFERENCE_FILTER_FIELDS = new Set([
  'location',
  'managed_by',
  'support_group',
  'model_id',
]);

function columnFilterField(element: string): string {
  return REFERENCE_FILTER_FIELDS.has(element) ? `${element}.name` : element;
}

export type SortDirection = 'asc' | 'desc';

export interface ColumnSort {
  field: string;
  direction: SortDirection;
}

export const DEFAULT_COLUMN_SORT: ColumnSort = { field: 'name', direction: 'asc' };

function columnSortField(element: string): string {
  return columnFilterField(element);
}

/** ServiceNow encoded-query ORDERBY segment for Table API queries. */
export function buildOrderByClause(sort: ColumnSort): string {
  const field = columnSortField(sort.field || 'name');
  return sort.direction === 'desc' ? `ORDERBYDESC${field}` : `ORDERBY${field}`;
}

/** Append sort to an encoded query (query must not already contain ORDERBY). */
export function appendOrderByToQuery(query: string, sort: ColumnSort): string {
  if (!query.trim()) return '';
  return `${query}^${buildOrderByClause(sort)}`;
}

/** Append an encoded-query segment when both parts are non-empty. */
export function appendEncodedQuery(base: string, extra: string): string {
  if (!extra.trim()) return base;
  if (!base.trim()) return extra;
  return `${base}^${extra}`;
}

/**
 * Build AND-combined fieldLIKE segments for column header filters.
 * Includes every filter in `allowedFields`, plus any filter key with a
 * non-empty value even if not in `allowedFields` (so filters applied before
 * columns finish loading are preserved).
 */
export function buildColumnFiltersQuery(
  filters: Record<string, string>,
  allowedFields: string[],
): string {
  const allowed = new Set(allowedFields);
  for (const [element, rawVal] of Object.entries(filters)) {
    if (rawVal.trim()) allowed.add(element);
  }
  const parts: string[] = [];
  for (const [element, rawVal] of Object.entries(filters)) {
    if (!allowed.has(element)) continue;
    const val = escapeLikeTerm(rawVal.trim());
    if (!val) continue;
    parts.push(`${columnFilterField(element)}LIKE${val}`);
  }
  return parts.join('^');
}
