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
