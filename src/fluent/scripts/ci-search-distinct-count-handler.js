var CiSearchDistinctCountHandler = Class.create(); // NOSONAR: ServiceNow Script Include class must use var (Class.create convention)
CiSearchDistinctCountHandler.prototype = {
  initialize: function () {},

  LOG_SOURCE: 'CLSA.CiSearchDistinctCount',

  CI_IN_CHUNK: 150,
  MAX_CI_FLAG_IDS: 500,

  INCIDENT_EXTRA: 'task.sys_class_name=incident^task.active=true',
  CHANGE_EXTRA:
    'task.sys_class_name=change_request^task.active=true^task.ref_change_request.start_date>=javascript:gs.beginningOfToday()',

  ALLOWED_TASK_TABLES: {
    incident: ['number', 'priority', 'state', 'short_description', 'opened_at'],
    change_request: ['number', 'type', 'state', 'short_description', 'start_date'],
  },

  MAX_SIDEBAR_PAGE_SIZE: 100,

  ALLOWED_TABLES: {
    task_ci: { field: 'task' },
  },

  logQuery: function (label, message) {
    gs.info('[CLSA CiSearchDistinctCount] ' + label + ' | ' + message, this.LOG_SOURCE);
  },

  jsonError: function (response, status, message) {
    response.setStatus(status);
    response.setContentType('application/json');
    response.setBody({ error: message });
  },

  jsonOk: function (response, body) {
    response.setContentType('application/json');
    response.setBody({ result: body });
  },

  scriptError: function (e) {
    if (!e) return 'Unknown server error';
    if (typeof e === 'string') return e;
    if (e.message) return String(e.message);
    return String(e);
  },

  readField: function (obj, name) {
    if (!obj) return '';
    let v = obj[name];
    if (v !== undefined && v !== null && String(v) !== '') return String(v);
    try {
      if (typeof obj.get === 'function') {
        v = obj.get(name);
        if (v !== undefined && v !== null && String(v) !== '') return String(v);
      }
    } catch (error) { gs.debug('ci-search readField obj.get probe failed: ' + error); }
    return '';
  },

  isValidSysId: function (id) {
    return /^[0-9a-f]{32}$/.test(String(id || ''));
  },

  readSysIdArray: function (obj, name) {
    if (!obj || typeof obj !== 'object') return [];
    let v = obj[name];
    if (!v && typeof obj.get === 'function') {
      try { v = obj.get(name); } catch (error) { gs.debug('ci-search readSysIdArray obj.get probe failed: ' + error); }
    }
    if (!Array.isArray(v)) return [];

    const seen = {};
    const out = [];
    for (const element of v) {
      const id = String(element || '').trim();
      if (!this.isValidSysId(id) || seen[id]) continue;
      seen[id] = true;
      out.push(id);
    }
    return out;
  },

  normalizeBody: function (raw) {
    if (!raw || typeof raw !== 'object') return {};
    return {
      incident_query: this.readField(raw, 'incident_query'),
      change_query: this.readField(raw, 'change_query'),
    };
  },

  normalizeFlagCountsBody: function (raw) {
    if (!raw || typeof raw !== 'object') return { ci_sys_ids: [] };
    return { ci_sys_ids: this.readSysIdArray(raw, 'ci_sys_ids') };
  },

  normalizeDistinctTasksBody: function (raw) {
    if (!raw || typeof raw !== 'object') return {};
    return {
      query: this.readField(raw, 'query'),
      task_table: this.readField(raw, 'task_table'),
      fields: this.readStringArray(raw, 'fields'),
      page: Number.parseInt(this.readField(raw, 'page'), 10) || 0,
      page_size: Number.parseInt(this.readField(raw, 'page_size'), 10) || 10,
    };
  },

  readStringArray: function (obj, name) {
    if (!obj || typeof obj !== 'object') return [];
    let v = obj[name];
    if (!v && typeof obj.get === 'function') {
      try { v = obj.get(name); } catch (error) { gs.debug('ci-search readStringArray obj.get probe failed: ' + error); }
    }
    if (!Array.isArray(v)) return [];
    const out = [];
    for (const element of v) {
      const s = String(element || '').trim();
      if (s) out.push(s);
    }
    return out;
  },

  parseBody: function (request) {
    try {
      const wrapper = request.body;
      if (!wrapper) return {};

      if (wrapper.data) {
        let data = wrapper.data;
        if (typeof data === 'string') {
          try {
            data = JSON.parse(data);
          } catch (error) {
            gs.debug('ci-search parseBody data JSON.parse failed: ' + error);
            return {};
          }
        }
        return this.normalizeBody(data);
      }

      if (typeof wrapper === 'string') {
        try {
          return this.normalizeBody(JSON.parse(wrapper));
        } catch (error) {
          gs.debug('ci-search parseBody wrapper JSON.parse failed: ' + error);
          return {};
        }
      }

      return this.normalizeBody(wrapper);
    } catch (error) {
      gs.debug('ci-search parseBody failed: ' + error);
      return {};
    }
  },

  parseFlagCountsBody: function (request) {
    try {
      const wrapper = request.body;
      if (!wrapper) return { ci_sys_ids: [] };

      if (wrapper.data) {
        let data = wrapper.data;
        if (typeof data === 'string') {
          try {
            data = JSON.parse(data);
          } catch (error) {
            gs.debug('ci-search parseFlagCountsBody data JSON.parse failed: ' + error);
            return { ci_sys_ids: [] };
          }
        }
        return this.normalizeFlagCountsBody(data);
      }

      if (typeof wrapper === 'string') {
        try {
          return this.normalizeFlagCountsBody(JSON.parse(wrapper));
        } catch (error) {
          gs.debug('ci-search parseFlagCountsBody wrapper JSON.parse failed: ' + error);
          return { ci_sys_ids: [] };
        }
      }

      return this.normalizeFlagCountsBody(wrapper);
    } catch (error) {
      gs.debug('ci-search parseFlagCountsBody failed: ' + error);
      return { ci_sys_ids: [] };
    }
  },

  parseDistinctTasksBody: function (request) {
    try {
      const wrapper = request.body;
      if (!wrapper) return {};

      if (wrapper.data) {
        let data = wrapper.data;
        if (typeof data === 'string') {
          try {
            data = JSON.parse(data);
          } catch (error) {
            gs.debug('ci-search parseDistinctTasksBody data JSON.parse failed: ' + error);
            return {};
          }
        }
        return this.normalizeDistinctTasksBody(data);
      }

      if (typeof wrapper === 'string') {
        try {
          return this.normalizeDistinctTasksBody(JSON.parse(wrapper));
        } catch (error) {
          gs.debug('ci-search parseDistinctTasksBody wrapper JSON.parse failed: ' + error);
          return {};
        }
      }

      return this.normalizeDistinctTasksBody(wrapper);
    } catch (error) {
      gs.debug('ci-search parseDistinctTasksBody failed: ' + error);
      return {};
    }
  },

  isAllowedSpec: function (table, field) {
    const spec = this.ALLOWED_TABLES[table];
    return spec && spec.field === field;
  },

  countDistinct: function (table, field, encodedQuery) {
    if (!this.isAllowedSpec(table, field)) {
      return { totalCount: 0, access: 'denied' };
    }
    if (!encodedQuery) {
      return { totalCount: 0, access: 'ok' };
    }

    try {
      const ga = new GlideAggregate(table);
      ga.addEncodedQuery(encodedQuery);
      ga.addAggregate('COUNT(DISTINCT', field);
      ga.setGroup(false);
      ga.query();

      if (!ga.next()) {
        return { totalCount: 0, access: 'ok' };
      }

      const count = Number.parseInt(ga.getAggregate('COUNT(DISTINCT', field), 10) || 0;
      return { totalCount: count, access: 'ok' };
    } catch (error) {
      this.logQuery('countDistinct_error', 'table=' + table + ' field=' + field + ' err=' + this.scriptError(error));
      return { totalCount: 0, access: 'error' };
    }
  },

  countDistinctTasksByCi: function (ciSysIds, extraQuery) {
    const counts = {};
    let i;
    for (i = 0; i < ciSysIds.length; i++) {
      counts[ciSysIds[i]] = 0;
    }

    if (!ciSysIds.length || !extraQuery) {
      return { counts: counts, access: 'ok' };
    }

    try {
      for (i = 0; i < ciSysIds.length; i += this.CI_IN_CHUNK) {
        const chunk = ciSysIds.slice(i, i + this.CI_IN_CHUNK);
        const idsQuery = chunk.join(',');
        const encodedQuery = 'ci_item.sys_idIN' + idsQuery + '^' + extraQuery;

        const ga = new GlideAggregate('task_ci');
        ga.addEncodedQuery(encodedQuery);
        ga.groupBy('ci_item');
        ga.addAggregate('COUNT(DISTINCT', 'task');
        ga.query();

        while (ga.next()) {
          const ciId = ga.getValue('ci_item');
          if (!ciId) continue;
          const count = Number.parseInt(ga.getAggregate('COUNT(DISTINCT', 'task'), 10) || 0;
          counts[ciId] = count;
        }
      }

      return { counts: counts, access: 'ok' };
    } catch (error) {
      this.logQuery(
        'countDistinctTasksByCi_error',
        'ids=' + ciSysIds.length + ' err=' + this.scriptError(error)
      );
      return { counts: counts, access: 'error' };
    }
  },

  sanitizeFields: function (requested, allowed) {
    const out = [];
    const seen = {};
    let i;
    for (i = 0; i < requested.length; i++) {
      const name = String(requested[i] || '').trim();
      if (!name || seen[name] || !allowed.includes(name)) continue;
      seen[name] = true;
      out.push(name);
    }
    if (!out.length) {
      for (i = 0; i < allowed.length; i++) out.push(allowed[i]);
    }
    return out;
  },

  clampPageSize: function (pageSize) {
    let size = Number.parseInt(pageSize, 10) || 10;
    if (size < 1) size = 10;
    if (size > this.MAX_SIDEBAR_PAGE_SIZE) size = this.MAX_SIDEBAR_PAGE_SIZE;
    return size;
  },

  fetchDistinctTaskPage: function (encodedQuery, taskTable, fields, page, pageSize) {
    const allowed = this.ALLOWED_TASK_TABLES[taskTable];
    if (!allowed) {
      return { rows: [], totalCount: 0, access: 'denied' };
    }
    if (!encodedQuery) {
      return { rows: [], totalCount: 0, access: 'ok' };
    }

    const safeFields = this.sanitizeFields(fields, allowed);
    const countRes = this.countDistinct('task_ci', 'task', encodedQuery);
    if (countRes.access === 'denied') {
      return { rows: [], totalCount: 0, access: 'denied' };
    }

    const totalCount = countRes.totalCount || 0;
    if (!totalCount) {
      return { rows: [], totalCount: 0, access: countRes.access };
    }

    page = Number.parseInt(page, 10) || 0;
    if (page < 0) page = 0;
    pageSize = this.clampPageSize(pageSize);
    const offset = page * pageSize;

    try {
      const ga = new GlideAggregate('task_ci');
      ga.addEncodedQuery(encodedQuery);
      ga.groupBy('task');
      ga.addAggregate('MIN', 'task.number');
      ga.orderByAggregate('MIN', 'task.number');
      ga.chooseWindow(offset, offset + pageSize);
      ga.query();

      const taskIds = [];
      while (ga.next()) {
        const taskId = ga.getValue('task');
        if (taskId) taskIds.push(String(taskId));
      }

      if (!taskIds.length) {
        return { rows: [], totalCount: totalCount, access: countRes.access };
      }

      const rows = [];
      const gr = new GlideRecord(taskTable);
      gr.addQuery('sys_id', 'IN', taskIds.join(','));
      gr.orderBy('number');
      gr.query();

      while (gr.next()) {
        const values = {};
        for (const fieldName of safeFields) {
          const display = gr.getDisplayValue(fieldName);
          values[fieldName] = display || String(gr.getValue(fieldName) || '');
        }
        rows.push({
          sys_id: String(gr.getUniqueValue()),
          values: values,
        });
      }

      return { rows: rows, totalCount: totalCount, access: 'ok' };
    } catch (error) {
      this.logQuery(
        'fetchDistinctTaskPage_error',
        'table=' + taskTable + ' err=' + this.scriptError(error)
      );
      return { rows: [], totalCount: 0, access: 'error' };
    }
  },

  handlePost: function (request, response) {
    const body = this.parseBody(request);
    const incidentQuery = body.incident_query || '';
    const changeQuery = body.change_query || '';

    this.logQuery(
      'request',
      'incident_len=' + incidentQuery.length + ' change_len=' + changeQuery.length
    );

    const incidentRes = this.countDistinct('task_ci', 'task', incidentQuery);
    const changeRes = this.countDistinct('task_ci', 'task', changeQuery);

    this.jsonOk(response, {
      incidents: incidentRes.totalCount,
      changes: changeRes.totalCount,
      access: {
        incidents: incidentRes.access,
        changes: changeRes.access,
      },
    });
  },

  handleFlagCountsPost: function (request, response) {
    const body = this.parseFlagCountsBody(request);
    const ciSysIds = body.ci_sys_ids || [];

    if (ciSysIds.length > this.MAX_CI_FLAG_IDS) {
      this.jsonError(response, 400, 'Too many ci_sys_ids (max ' + this.MAX_CI_FLAG_IDS + ')');
      return;
    }

    this.logQuery('flag_counts_request', 'ci_count=' + ciSysIds.length);

    if (!ciSysIds.length) {
      this.jsonOk(response, {
        counts: {},
        access: { incidents: 'ok', changes: 'ok' },
      });
      return;
    }

    const incidentRes = this.countDistinctTasksByCi(ciSysIds, this.INCIDENT_EXTRA);
    const changeRes = this.countDistinctTasksByCi(ciSysIds, this.CHANGE_EXTRA);

    const counts = {};
    let idx;
    for (idx = 0; idx < ciSysIds.length; idx++) {
      const id = ciSysIds[idx];
      counts[id] = {
        incidents: incidentRes.counts[id] || 0,
        changes: changeRes.counts[id] || 0,
      };
    }

    this.jsonOk(response, {
      counts: counts,
      access: {
        incidents: incidentRes.access,
        changes: changeRes.access,
      },
    });
  },

  handleDistinctTasksPost: function (request, response) {
    const body = this.parseDistinctTasksBody(request);
    const query = body.query || '';
    const taskTable = body.task_table || '';

    this.logQuery(
      'distinct_tasks_request',
      'table=' + taskTable + ' query_len=' + query.length + ' page=' + body.page
    );

    const result = this.fetchDistinctTaskPage(
      query,
      taskTable,
      body.fields || [],
      body.page,
      body.page_size
    );

    this.jsonOk(response, result);
  },
};
